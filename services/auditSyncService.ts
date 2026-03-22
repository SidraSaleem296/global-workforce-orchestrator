import { createHash } from "node:crypto";

import { type LogRecord, type TaskRecord } from "../notion/databases.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { LoggingService } from "./loggingService.js";

type TaskSnapshot = ReturnType<typeof buildTaskSnapshot>;

type ParsedSnapshotPayload = {
  snapshotHash?: string;
  snapshot?: TaskSnapshot;
  source?: string;
  syncedAt?: string;
};

type ParsedManualUpdatePayload = {
  previousSnapshotHash?: string;
  currentSnapshotHash?: string;
  currentSnapshot?: TaskSnapshot;
  changedFields?: string[];
  changes?: Record<string, { previous: unknown; current: unknown }>;
  changeSummary?: string[];
  detectedAt?: string;
};

const TASK_FIELD_LABELS: Record<keyof TaskSnapshot, string> = {
  title: "Title",
  description: "Description",
  requiredSkill: "Required Skill",
  priority: "Priority",
  status: "Status",
  assignedWorkerId: "Assigned Worker ID",
  assignedWorkerName: "Assigned Worker",
  aiConfidence: "AI Confidence",
  selectionReason: "Selection Reason",
  humanApprovalNeeded: "Human Approval Needed",
  approvalStatus: "Approval Status",
  budget: "Budget",
  timezonePreference: "Timezone Preference",
  qualityScore: "Quality Score",
  humanReviewNeeded: "Human Review Needed",
  completionNotes: "Completion Notes",
  completedAt: "Completed At",
};

const buildTaskSnapshot = (task: TaskRecord) => ({
  title: task.title,
  description: task.description,
  requiredSkill: task.requiredSkill,
  priority: task.priority,
  status: task.status,
  assignedWorkerId: task.assignedWorkerId ?? "",
  assignedWorkerName: task.assignedWorkerName ?? "",
  aiConfidence: task.aiConfidence ?? null,
  selectionReason: task.selectionReason ?? "",
  humanApprovalNeeded: task.humanApprovalNeeded,
  approvalStatus: task.approvalStatus,
  budget: task.budget ?? null,
  timezonePreference: task.timezonePreference ?? "",
  qualityScore: task.qualityScore ?? null,
  humanReviewNeeded: task.humanReviewNeeded,
  completionNotes: task.completionNotes ?? "",
  completedAt: task.completedAt ?? "",
});

const buildSnapshotHash = (snapshot: TaskSnapshot): string =>
  createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");

const parseLogPayload = <T>(log: LogRecord): T | null => {
  if (!log.payload) {
    return null;
  }

  try {
    return JSON.parse(log.payload) as T;
  } catch {
    return null;
  }
};

const compareSnapshots = (
  previousSnapshot: TaskSnapshot,
  currentSnapshot: TaskSnapshot,
): Record<string, { previous: unknown; current: unknown }> => {
  const changes: Record<string, { previous: unknown; current: unknown }> = {};

  for (const key of Object.keys(currentSnapshot) as Array<keyof TaskSnapshot>) {
    if (previousSnapshot[key] !== currentSnapshot[key]) {
      changes[key] = {
        previous: previousSnapshot[key],
        current: currentSnapshot[key],
      };
    }
  }

  return changes;
};

const toTimestamp = (log: LogRecord): number => {
  const rawValue = log.timestamp ?? "";
  const timestamp = new Date(rawValue).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const isEmptyAuditValue = (value: unknown): boolean =>
  value === null || value === undefined || value === "";

const formatAuditValue = (value: unknown): string => {
  if (isEmptyAuditValue(value)) {
    return "empty";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  return `"${text.length > 100 ? `${text.slice(0, 97)}...` : text}"`;
};

const describeChange = (
  field: keyof TaskSnapshot,
  value: { previous: unknown; current: unknown },
): string => {
  const label = TASK_FIELD_LABELS[field] ?? field;
  const previousEmpty = isEmptyAuditValue(value.previous);
  const currentEmpty = isEmptyAuditValue(value.current);

  if (previousEmpty && !currentEmpty) {
    return `${label} set to ${formatAuditValue(value.current)}`;
  }

  if (!previousEmpty && currentEmpty) {
    return `${label} cleared`;
  }

  return `${label} ${formatAuditValue(value.previous)} -> ${formatAuditValue(value.current)}`;
};

const buildChangeSummary = (
  changes: Record<string, { previous: unknown; current: unknown }>,
): string[] =>
  Object.entries(changes).map(([field, value]) =>
    describeChange(field as keyof TaskSnapshot, value),
  );

const buildChangeMessage = (taskTitle: string, changeSummary: string[]): string => {
  const summaryPreview = changeSummary.slice(0, 3).join("; ");
  const remainingCount = changeSummary.length - 3;
  const suffix = remainingCount > 0 ? `; +${remainingCount} more change${remainingCount === 1 ? "" : "s"}` : "";

  return `Task "${taskTitle}" changed in Notion: ${summaryPreview}${suffix}.`;
};

export class AuditSyncService {
  private reconciliationPromise: Promise<void> | null = null;

  constructor(
    private readonly notionMcpAdapter: NotionMcpAdapter,
    private readonly loggingService: LoggingService,
  ) {}

  async recordTaskSnapshot(task: TaskRecord, source: string): Promise<void> {
    const snapshot = buildTaskSnapshot(task);
    const snapshotHash = buildSnapshotHash(snapshot);

    await this.loggingService.logEvent("TASK_STATE_SNAPSHOT", {
      message: `Snapshot recorded for "${task.title}".`,
      entityType: "task",
      entityId: task.id,
      payload: {
        taskId: task.id,
        source,
        snapshotHash,
        snapshot,
        syncedAt: new Date().toISOString(),
      },
    });
  }

  async reconcileTaskChanges(): Promise<void> {
    if (this.reconciliationPromise) {
      return this.reconciliationPromise;
    }

    this.reconciliationPromise = this.runReconciliation().finally(() => {
      this.reconciliationPromise = null;
    });

    return this.reconciliationPromise;
  }

  private async runReconciliation(): Promise<void> {
    const [tasks, logs] = await Promise.all([
      this.notionMcpAdapter.getTasks(),
      this.notionMcpAdapter.getLogs(),
    ]);
    const latestSnapshotByTaskId = new Map<string, { snapshotHash: string; snapshot: TaskSnapshot }>();

    [...logs]
      .filter((log) => ["TASK_STATE_SNAPSHOT", "TASK_UPDATED_MANUALLY"].includes(log.eventType) && log.entityId)
      .sort((left, right) => toTimestamp(right) - toTimestamp(left))
      .forEach((log) => {
        if (latestSnapshotByTaskId.has(log.entityId ?? "")) {
          return;
        }

        if (log.eventType === "TASK_STATE_SNAPSHOT") {
          const payload = parseLogPayload<ParsedSnapshotPayload>(log);

          if (!payload?.snapshotHash || !payload.snapshot) {
            return;
          }

          latestSnapshotByTaskId.set(log.entityId ?? "", {
            snapshotHash: payload.snapshotHash,
            snapshot: payload.snapshot,
          });
          return;
        }

        const payload = parseLogPayload<ParsedManualUpdatePayload>(log);

        if (!payload?.currentSnapshotHash || !payload.currentSnapshot) {
          return;
        }

        latestSnapshotByTaskId.set(log.entityId ?? "", {
          snapshotHash: payload.currentSnapshotHash,
          snapshot: payload.currentSnapshot,
        });
      });

    for (const task of tasks) {
      const currentSnapshot = buildTaskSnapshot(task);
      const currentHash = buildSnapshotHash(currentSnapshot);
      const previousSnapshotRecord = latestSnapshotByTaskId.get(task.id);

      if (!previousSnapshotRecord) {
        await this.recordTaskSnapshot(task, "reconcile:baseline");
        continue;
      }

      if (previousSnapshotRecord.snapshotHash === currentHash) {
        continue;
      }

      const changes = compareSnapshots(previousSnapshotRecord.snapshot, currentSnapshot);
      const changeSummary = buildChangeSummary(changes);

      await this.loggingService.logEvent("TASK_UPDATED_MANUALLY", {
        message: buildChangeMessage(task.title, changeSummary),
        severity: "WARN",
        entityType: "task",
        entityId: task.id,
        payload: {
          taskId: task.id,
          changedFields: Object.keys(changes),
          changes,
          changeSummary,
          previousSnapshotHash: previousSnapshotRecord.snapshotHash,
          currentSnapshotHash: currentHash,
          currentSnapshot,
          detectedAt: new Date().toISOString(),
        },
      });

      await this.recordTaskSnapshot(task, "reconcile:manual-update");
    }
  }
}
