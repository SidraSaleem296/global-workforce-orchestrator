import { type TaskRecord, type WorkerRecord } from "../notion/databases.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { AuditSyncService } from "./auditSyncService.js";
import { LoggingService } from "./loggingService.js";

const buildHumanDecisionStory = (input: {
  approved: boolean;
  reviewer: string;
  taskTitle: string;
  workerName?: string;
  notes?: string;
  aiReasoning?: string;
}): string => {
  const targetWorker = input.workerName || "the suggested worker";
  const lines = [
    input.approved
      ? `${input.reviewer} approved assigning ${targetWorker} to "${input.taskTitle}".`
      : `${input.reviewer} rejected assigning ${targetWorker} to "${input.taskTitle}" and reopened the task for reassignment.`,
  ];

  if (input.notes) {
    lines.push(`Human decision notes: ${input.notes}`);
  }

  if (input.aiReasoning) {
    lines.push(`Original AI recommendation: ${input.aiReasoning}`);
  }

  return lines.join(" ");
};

export class ApprovalService {
  constructor(
    private readonly notionMcpAdapter: NotionMcpAdapter,
    private readonly loggingService: LoggingService,
    private readonly auditSyncService: AuditSyncService,
  ) {}

  async requestApproval(input: {
    task: TaskRecord;
    worker: WorkerRecord;
    confidence: number;
    reason: string;
    rankedWorkers: unknown[];
  }) {
    const updatedTask = await this.notionMcpAdapter.updateTaskApprovalState(input.task.id, {
      approvalStatus: "Pending",
      humanApprovalNeeded: true,
      status: "Pending Approval",
      selectionReason: input.reason,
      confidence: input.confidence,
    });

    const approval = await this.notionMcpAdapter.createApproval({
      taskId: input.task.id,
      taskTitle: input.task.title,
      workerId: input.worker.id,
      workerName: input.worker.name,
      confidence: input.confidence,
      reason: input.reason,
    });

    await this.loggingService.logEvent("APPROVAL_REQUESTED", {
      message: `Approval requested before assigning "${input.task.title}" to ${input.worker.name}.`,
      entityType: "task",
      entityId: input.task.id,
      payload: {
        taskId: input.task.id,
        approvalId: approval.id,
        candidateWorkerId: input.worker.id,
        candidateWorkerName: input.worker.name,
        confidence: input.confidence,
        rankedWorkers: input.rankedWorkers,
      },
    });
    await this.auditSyncService.recordTaskSnapshot(updatedTask, "app:request-approval");

    return {
      task: updatedTask,
      approval,
    };
  }

  async reviewApproval(input: {
    approvalId: string;
    approved: boolean;
    reviewer: string;
    notes?: string;
  }) {
    await this.auditSyncService.reconcileTaskChanges();

    const [approval, allApprovals] = await Promise.all([
      this.notionMcpAdapter.getApprovalById(input.approvalId),
      this.notionMcpAdapter.getApprovals(),
    ]);

    if (approval.status.toLowerCase() !== "pending") {
      throw new Error(`Approval ${input.approvalId} has already been reviewed.`);
    }

    const task = await this.notionMcpAdapter.getTaskById(approval.taskId);
    const siblingPendingApprovals = allApprovals.filter((candidate) =>
      candidate.id !== approval.id
      && candidate.taskId === approval.taskId
      && candidate.status.trim().toLowerCase() === "pending",
    );

    if (input.approved) {
      const worker = await this.notionMcpAdapter.getWorkerById(approval.workerId);
      const decisionStory = buildHumanDecisionStory({
        approved: true,
        reviewer: input.reviewer,
        taskTitle: task.title,
        workerName: worker.name,
        notes: input.notes,
        aiReasoning: approval.reason,
      });
      const updatedApproval = await this.notionMcpAdapter.resolveApproval(approval.id, {
        status: "Approved",
        reviewer: input.reviewer,
        notes: input.notes,
      });
      await Promise.all(
        siblingPendingApprovals.map((candidate) =>
          this.notionMcpAdapter.resolveApproval(candidate.id, {
            status: "Rejected",
            reviewer: input.reviewer,
            notes: `Superseded after approving assignment for "${task.title}".`,
          })),
      );
      const assignedTask = await this.notionMcpAdapter.assignWorker(task.id, {
        workerId: worker.id,
        workerName: worker.name,
        confidence: approval.confidence ?? 0.5,
        selectionReason: decisionStory,
        approvalStatus: "Approved",
        humanApprovalNeeded: false,
        status: "Assigned",
      });

      await this.loggingService.logEvent("APPROVAL_DECIDED", {
        message: `${input.reviewer} approved assignment of "${task.title}" to ${worker.name}.`,
        entityType: "approval",
        entityId: approval.id,
        payload: {
          approvalId: approval.id,
          approved: true,
          reviewer: input.reviewer,
          notes: input.notes,
          taskId: task.id,
          workerId: worker.id,
          workerName: worker.name,
          taskTitle: task.title,
          decisionStory,
          resolvedSiblingApprovalIds: siblingPendingApprovals.map((candidate) => candidate.id),
        },
      });

      await this.loggingService.logEvent("TASK_ASSIGNED", {
        message: `Task "${task.title}" was assigned to ${worker.name} after approval.`,
        entityType: "task",
        entityId: task.id,
        payload: {
          taskId: task.id,
          workerId: worker.id,
          approvalId: approval.id,
        },
      });
      await this.auditSyncService.recordTaskSnapshot(assignedTask, "app:approve-assignment");

      return {
        status: "approved",
        approval: updatedApproval,
        task: assignedTask,
        worker,
        resolvedApprovalIds: [updatedApproval.id, ...siblingPendingApprovals.map((candidate) => candidate.id)],
      };
    }

    const decisionStory = buildHumanDecisionStory({
      approved: false,
      reviewer: input.reviewer,
      taskTitle: task.title,
      workerName: approval.workerName,
      notes: input.notes,
      aiReasoning: approval.reason,
    });
    const updatedApproval = await this.notionMcpAdapter.resolveApproval(approval.id, {
      status: "Rejected",
      reviewer: input.reviewer,
      notes: input.notes,
    });
    await Promise.all(
      siblingPendingApprovals.map((candidate) =>
        this.notionMcpAdapter.resolveApproval(candidate.id, {
          status: "Rejected",
          reviewer: input.reviewer,
          notes: `Superseded duplicate approval rejected alongside "${task.title}".`,
        })),
    );
    const updatedTask = await this.notionMcpAdapter.updateTaskApprovalState(task.id, {
      approvalStatus: "Rejected",
      humanApprovalNeeded: false,
      status: "Open",
      selectionReason: decisionStory,
      confidence: approval.confidence,
    });

    await this.loggingService.logEvent("APPROVAL_DECIDED", {
      message: `${input.reviewer} rejected the AI recommendation for "${task.title}".`,
      entityType: "approval",
      entityId: approval.id,
      payload: {
        approvalId: approval.id,
        approved: false,
        reviewer: input.reviewer,
        notes: input.notes,
        taskId: task.id,
        workerId: approval.workerId,
        workerName: approval.workerName,
        taskTitle: task.title,
        decisionStory,
        resolvedSiblingApprovalIds: siblingPendingApprovals.map((candidate) => candidate.id),
      },
    });
    await this.auditSyncService.recordTaskSnapshot(updatedTask, "app:reject-assignment");

    return {
      status: "rejected",
      approval: updatedApproval,
      task: updatedTask,
      resolvedApprovalIds: [updatedApproval.id, ...siblingPendingApprovals.map((candidate) => candidate.id)],
    };
  }
}
