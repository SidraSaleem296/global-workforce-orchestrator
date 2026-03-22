import { type ApprovalRecord, type LogRecord } from "../notion/databases.js";
import { PlannerAgent } from "../agents/plannerAgent.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { ApprovalService } from "./approvalService.js";
import { AuditSyncService } from "./auditSyncService.js";
import { LoggingService } from "./loggingService.js";

const normalizeStatus = (value: string): string => value.trim().toLowerCase();
const HIDDEN_LOG_EVENT_TYPES = new Set(["TASK_STATE_SNAPSHOT"]);
const PENDING_APPROVAL_STATUSES = new Set(["pending", "awaiting approval", "needs approval"]);
const sortByRecentDate = <T extends { completedAt?: string; lastEditedAt?: string; createdAt?: string; requestedAt?: string; resolvedAt?: string; timestamp?: string }>(
  left: T,
  right: T,
): number => {
  const leftDate = new Date(
    left.completedAt
    || left.lastEditedAt
    || left.resolvedAt
    || left.requestedAt
    || left.timestamp
    || left.createdAt
    || 0,
  ).getTime();
  const rightDate = new Date(
    right.completedAt
    || right.lastEditedAt
    || right.resolvedAt
    || right.requestedAt
    || right.timestamp
    || right.createdAt
    || 0,
  ).getTime();

  return rightDate - leftDate;
};
const isPendingApproval = (status: string): boolean => PENDING_APPROVAL_STATUSES.has(normalizeStatus(status));
const isRejectedApproval = (status: string): boolean => ["rejected", "declined"].includes(normalizeStatus(status));

const dedupePendingApprovals = (approvals: ApprovalRecord[]): ApprovalRecord[] => {
  const latestPendingByTask = new Map<string, ApprovalRecord>();

  [...approvals]
    .filter((approval) => isPendingApproval(approval.status))
    .sort(sortByRecentDate)
    .forEach((approval) => {
      const key = approval.taskId || approval.id;

      if (!latestPendingByTask.has(key)) {
        latestPendingByTask.set(key, approval);
      }
    });

  return [...latestPendingByTask.values()].sort(sortByRecentDate);
};

const buildTaskHistorySummary = (taskId: string, approvals: ApprovalRecord[]): string | undefined => {
  const relevantApprovals = approvals
    .filter((approval) => approval.taskId === taskId)
    .sort(sortByRecentDate);

  if (relevantApprovals.length === 0) {
    return undefined;
  }

  return relevantApprovals
    .slice(0, 5)
    .map((approval) => {
      const status = approval.status || "Unknown";
      const worker = approval.workerName || approval.workerId || "Unknown worker";
      const reviewer = approval.reviewer ? ` by ${approval.reviewer}` : "";
      const notes = approval.notes ? ` Notes: ${approval.notes}` : "";
      return `${status} recommendation for ${worker}${reviewer}.${notes}`;
    })
    .join(" ");
};

export class WorkforceService {
  constructor(
    private readonly notionMcpAdapter: NotionMcpAdapter,
    private readonly plannerAgent: PlannerAgent,
    private readonly approvalService: ApprovalService,
    private readonly loggingService: LoggingService,
    private readonly auditSyncService: AuditSyncService,
  ) {}

  async listWorkers() {
    return this.notionMcpAdapter.getWorkers();
  }

  async listTasks() {
    return this.notionMcpAdapter.getTasks();
  }

  async listApprovals() {
    return this.notionMcpAdapter.getApprovals();
  }

  async listLogs() {
    await this.auditSyncService.reconcileTaskChanges();
    const logs = await this.notionMcpAdapter.getLogs();

    return this.getVisibleLogs(logs);
  }

  async assignTask(taskId: string) {
    await this.auditSyncService.reconcileTaskChanges();

    const [context, approvals] = await Promise.all([
      this.notionMcpAdapter.getStructuredContext(),
      this.notionMcpAdapter.getApprovals(),
    ]);
    const tasks = context.resources[0].records;
    const workers = context.resources[1].records;
    const task = tasks.find((candidate) => candidate.id === taskId || candidate.pageId === taskId)
      ?? await this.notionMcpAdapter.getTaskById(taskId);
    const latestPendingApproval = dedupePendingApprovals(approvals).find((approval) => approval.taskId === task.id);

    if (normalizeStatus(task.status) === "completed") {
      throw new Error(`Task "${task.title}" is already completed and cannot be assigned.`);
    }

    if (latestPendingApproval) {
      return {
        status: "pending_approval",
        task,
        approval: latestPendingApproval,
        reusedExistingApproval: true,
      };
    }

    const rejectedApprovals = approvals.filter((approval) => approval.taskId === task.id && isRejectedApproval(approval.status));
    const rejectedWorkerIds = [...new Set(rejectedApprovals.map((approval) => approval.workerId).filter(Boolean))];
    const rejectedWorkerNames = [...new Set(rejectedApprovals.map((approval) => approval.workerName).filter(Boolean))] as string[];
    const decision = await this.plannerAgent.planTaskAssignment(task, workers, {
      rejectedWorkerIds,
      rejectedWorkerNames,
      historySummary: buildTaskHistorySummary(task.id, approvals),
    });

    await this.loggingService.logEvent("WORKER_SELECTED", {
      message: `Planner selected ${decision.selectedWorker.name} for "${task.title}" with confidence ${decision.confidence}.`,
      entityType: "task",
      entityId: task.id,
      payload: {
        taskId: task.id,
        selectedWorkerId: decision.selectedWorker.id,
        selectedWorkerName: decision.selectedWorker.name,
        confidence: decision.confidence,
        approvalRequired: decision.approvalRequired,
        rankedWorkers: decision.rankedWorkers,
      },
    });

    if (decision.approvalRequired) {
      const approvalBundle = await this.approvalService.requestApproval({
        task,
        worker: decision.selectedWorker,
        confidence: decision.confidence,
        reason: decision.reasoning,
        rankedWorkers: decision.rankedWorkers,
      });

      return {
        status: "pending_approval",
        task: approvalBundle.task,
        approval: approvalBundle.approval,
        decision,
      };
    }

    const assignedTask = await this.notionMcpAdapter.assignWorker(task.id, {
      workerId: decision.selectedWorker.id,
      workerName: decision.selectedWorker.name,
      confidence: decision.confidence,
      selectionReason: decision.reasoning,
      approvalStatus: "Not Required",
      humanApprovalNeeded: false,
      status: "Assigned",
    });

    await this.loggingService.logEvent("TASK_ASSIGNED", {
      message: `Task "${task.title}" assigned to ${decision.selectedWorker.name}.`,
      entityType: "task",
      entityId: task.id,
      payload: {
        taskId: task.id,
        workerId: decision.selectedWorker.id,
        confidence: decision.confidence,
      },
    });
    await this.auditSyncService.recordTaskSnapshot(assignedTask, "app:assign-task");

    return {
      status: "assigned",
      task: assignedTask,
      decision,
    };
  }

  async getDashboard() {
    await this.auditSyncService.reconcileTaskChanges();

    const [stats, tasks, workers, approvals] = await Promise.all([
      this.notionMcpAdapter.getDashboardStats(),
      this.notionMcpAdapter.getTasks(),
      this.notionMcpAdapter.getWorkers(),
      this.notionMcpAdapter.getApprovals(),
    ]);
    const pendingApprovals = dedupePendingApprovals(approvals);

    return {
      stats,
      pendingApprovals,
      activeAssignments: tasks.filter((task) => normalizeStatus(task.status) === "assigned"),
      workers: workers.map((worker) => ({
        id: worker.id,
        name: worker.name,
        availability: worker.availability,
        timezone: worker.timezone,
        hourlyRate: worker.hourlyRate,
        activeTaskCount: worker.activeTaskCount ?? 0,
      })),
    };
  }

  async getWorkspaceSnapshot() {
    await this.auditSyncService.reconcileTaskChanges();

    const [stats, tasks, workers, approvals, logs] = await Promise.all([
      this.notionMcpAdapter.getDashboardStats(),
      this.notionMcpAdapter.getTasks(),
      this.notionMcpAdapter.getWorkers(),
      this.notionMcpAdapter.getApprovals(),
      this.notionMcpAdapter.getLogs(),
    ]);
    const pendingApprovals = dedupePendingApprovals(approvals);

    return {
      stats,
      tasks: [...tasks].sort(sortByRecentDate),
      workers: [...workers].sort((left, right) => left.name.localeCompare(right.name)),
      approvals: pendingApprovals,
      logs: this.getVisibleLogs(logs).slice(0, 24),
    };
  }

  private getVisibleLogs(logs: LogRecord[]): LogRecord[] {
    return [...logs]
      .filter((log) => !HIDDEN_LOG_EVENT_TYPES.has(log.eventType))
      .sort(sortByRecentDate);
  }
}
