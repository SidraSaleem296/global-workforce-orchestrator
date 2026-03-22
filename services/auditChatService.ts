import { type ApprovalRecord, type LogRecord, type TaskRecord, type WorkerRecord } from "../notion/databases.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { type ChatMessage, generateChatNarrative } from "../utils/llmClient.js";
import { AuditSyncService } from "./auditSyncService.js";

type AuditLogPayload = {
  changeSummary?: string[];
};

type AuditChatTurn = {
  role: "user" | "assistant";
  content: string;
};

const HIDDEN_LOG_EVENT_TYPES = new Set(["TASK_STATE_SNAPSHOT"]);

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

const normalizeStatus = (value?: string): string => (value ?? "").trim().toLowerCase();

const parsePayload = <T>(payload?: string): T | null => {
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
};

const extractTaskTitleFromMessage = (message: string): string | null => {
  const match = message.match(/Task "([^"]+)"/i);
  return match?.[1] ?? null;
};

const formatTimestamp = (value?: string): string => {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const trimContent = (value: string, maxLength: number): string => {
  const compactValue = value.replace(/\s+/g, " ").trim();
  return compactValue.length > maxLength ? `${compactValue.slice(0, maxLength - 3)}...` : compactValue;
};

const AVAILABILITY_KEYWORDS = [
  "free",
  "available",
  "availability",
  "busy",
  "capacity",
  "load",
  "bandwidth",
  "can take",
  "open for",
];

const getVisibleLogs = (logs: LogRecord[]): LogRecord[] =>
  [...logs]
    .filter((log) => !HIDDEN_LOG_EVENT_TYPES.has(log.eventType))
    .sort(sortByRecentDate);

const isTaskActivelyAssigned = (task: TaskRecord): boolean => {
  const taskStatus = normalizeStatus(task.status);
  const approvalStatus = normalizeStatus(task.approvalStatus);

  if (task.completedAt || ["completed", "done", "closed", "delivered", "finished"].includes(taskStatus)) {
    return false;
  }

  if (["rejected", "declined", "blocked"].includes(taskStatus) || ["rejected", "declined"].includes(approvalStatus)) {
    return false;
  }

  if (task.humanApprovalNeeded || ["pending", "awaiting approval", "needs approval"].includes(approvalStatus)) {
    return false;
  }

  return Boolean(
    task.assignedWorkerId
    || task.assignedWorkerName
    || ["assigned", "in progress", "active", "working"].includes(taskStatus),
  );
};

const getWorkerAssignedTasks = (worker: WorkerRecord, tasks: TaskRecord[]): TaskRecord[] =>
  tasks.filter((task) =>
    isTaskActivelyAssigned(task)
    && (task.assignedWorkerId === worker.id || normalizeStatus(task.assignedWorkerName) === normalizeStatus(worker.name)),
  );

const workerLooksAvailable = (worker: WorkerRecord, tasks: TaskRecord[]): boolean => {
  const availability = normalizeStatus(worker.availability);
  const assignedTasks = getWorkerAssignedTasks(worker, tasks);
  const load = worker.activeTaskCount ?? assignedTasks.length;
  const capacity = worker.capacity;

  if (["busy", "unavailable", "offline", "inactive", "limited"].includes(availability)) {
    return false;
  }

  if (capacity !== undefined && capacity !== null && load >= capacity) {
    return false;
  }

  return true;
};

const buildWorkerSummary = (worker: WorkerRecord, tasks: TaskRecord[]): string => {
  const assignedTasks = getWorkerAssignedTasks(worker, tasks);
  const load = worker.activeTaskCount ?? assignedTasks.length;
  const capacity = worker.capacity ?? null;
  const pieces = [
    `Worker: ${worker.name}`,
    `Availability: ${worker.availability || "Unknown"}`,
    `Load: ${capacity !== null ? `${load}/${capacity}` : String(load)}`,
    `Timezone: ${worker.timezone || "Unknown"}`,
  ];

  if (worker.skills.length > 0) {
    pieces.push(`Skills: ${worker.skills.join(", ")}`);
  }

  if (assignedTasks.length > 0) {
    pieces.push(`Active tasks: ${assignedTasks.map((task) => task.title).join(", ")}`);
  }

  return pieces.join(" | ");
};

const findMatchingWorker = (question: string, workers: WorkerRecord[]): WorkerRecord | null => {
  const normalizedQuestion = normalizeStatus(question);
  const exactMatch = workers.find((worker) => normalizedQuestion.includes(normalizeStatus(worker.name)));

  if (exactMatch) {
    return exactMatch;
  }

  const tokenMatches = workers.filter((worker) => {
    const nameParts = worker.name
      .split(/\s+/)
      .map((part) => normalizeStatus(part))
      .filter(Boolean);

    return nameParts.some((part) => part.length >= 3 && normalizedQuestion.includes(part));
  });

  return tokenMatches.length === 1 ? tokenMatches[0] : null;
};

const isAvailabilityQuestion = (question: string): boolean => {
  const normalizedQuestion = normalizeStatus(question);
  return AVAILABILITY_KEYWORDS.some((keyword) => normalizedQuestion.includes(keyword));
};

const buildTaskSummary = (task: TaskRecord): string => {
  const pieces = [
    `Task: ${task.title}`,
    `Status: ${task.status || "Open"}`,
    `Worker: ${task.assignedWorkerName || "Unassigned"}`,
    `Approval: ${task.approvalStatus || "Not Required"}`,
  ];

  if (task.requiredSkill) {
    pieces.push(`Skill: ${task.requiredSkill}`);
  }

  if (typeof task.aiConfidence === "number") {
    pieces.push(`Confidence: ${task.aiConfidence.toFixed(2)}`);
  }

  return pieces.join(" | ");
};

const buildApprovalSummary = (approval: ApprovalRecord): string =>
  [
    `Task: ${approval.taskTitle || approval.taskId || "Unknown task"}`,
    `Suggested worker: ${approval.workerName || approval.workerId || "Unknown worker"}`,
    `Status: ${approval.status || "Pending"}`,
    `Requested: ${formatTimestamp(approval.requestedAt)}`,
    approval.reviewer ? `Reviewer: ${approval.reviewer}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

const buildLogSummary = (log: LogRecord): string => {
  const baseLine = `[${formatTimestamp(log.timestamp)}] ${log.eventType}: ${log.message}`;

  if (log.eventType !== "TASK_UPDATED_MANUALLY") {
    return baseLine;
  }

  const payload = parsePayload<AuditLogPayload>(log.payload);
  const changeSummary = Array.isArray(payload?.changeSummary) ? payload.changeSummary.slice(0, 6) : [];

  if (changeSummary.length === 0) {
    return baseLine;
  }

  return `${baseLine}\nChanges:\n- ${changeSummary.join("\n- ")}`;
};

const sanitizeHistory = (history?: AuditChatTurn[]): AuditChatTurn[] =>
  Array.isArray(history)
    ? history
      .filter((entry): entry is AuditChatTurn =>
        Boolean(entry)
        && (entry.role === "user" || entry.role === "assistant")
        && typeof entry.content === "string"
        && entry.content.trim() !== "",
      )
      .slice(-8)
      .map((entry) => ({
        role: entry.role,
        content: trimContent(entry.content, 1200),
      }))
    : [];

const buildContext = (tasks: TaskRecord[], workers: WorkerRecord[], approvals: ApprovalRecord[], logs: LogRecord[]): string => {
  const taskSection = tasks
    .sort(sortByRecentDate)
    .slice(0, 12)
    .map(buildTaskSummary)
    .join("\n");

  const workerSection = workers
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 12)
    .map((worker) => buildWorkerSummary(worker, tasks))
    .join("\n");

  const approvalSection = approvals
    .sort(sortByRecentDate)
    .slice(0, 8)
    .map(buildApprovalSummary)
    .join("\n");

  const logSection = logs
    .slice(0, 24)
    .map(buildLogSummary)
    .join("\n\n");

  return [
    "Current Tasks:",
    taskSection || "No tasks available.",
    "",
    "Workers:",
    workerSection || "No workers available.",
    "",
    "Approvals:",
    approvalSection || "No approvals available.",
    "",
    "Recent Audit Logs:",
    logSection || "No logs available.",
  ].join("\n");
};

const buildGenericAnswer = (logs: LogRecord[]): string => {
  const recentLogs = logs.slice(0, 5);

  if (recentLogs.length === 0) {
    return "I do not have any audit logs yet. Create or update a task first, then ask again.";
  }

  return [
    "Here is the latest audit activity I can see:",
    "",
    ...recentLogs.map((log) => `- ${buildLogSummary(log).replace(/\n/g, " ")}`),
  ].join("\n");
};

const buildManualChangeAnswer = (logs: LogRecord[]): string => {
  const manualLogs = logs.filter((log) => log.eventType === "TASK_UPDATED_MANUALLY").slice(0, 8);

  if (manualLogs.length === 0) {
    return "I could not find any recent manual Notion edits in the audit logs.";
  }

  const logsWithDetails = manualLogs.filter((log) => {
    const payload = parsePayload<AuditLogPayload>(log.payload);
    return Array.isArray(payload?.changeSummary) && payload.changeSummary.length > 0;
  });
  const legacyLogs = manualLogs.filter((log) => !logsWithDetails.includes(log));
  const legacyCounts = new Map<string, { count: number; latestTimestamp?: string }>();

  legacyLogs.forEach((log) => {
    const taskTitle = extractTaskTitleFromMessage(log.message) ?? "Unknown task";
    const existing = legacyCounts.get(taskTitle);

    legacyCounts.set(taskTitle, {
      count: (existing?.count ?? 0) + 1,
      latestTimestamp: existing?.latestTimestamp ?? log.timestamp,
    });
  });

  const lines = ["Here is the latest view of manual edits made directly in Notion:"];

  if (logsWithDetails.length > 0) {
    lines.push("", "**Field-level changes captured**");
    lines.push(
      ...logsWithDetails.slice(0, 4).flatMap((log) => {
        const payload = parsePayload<AuditLogPayload>(log.payload);
        const taskTitle = extractTaskTitleFromMessage(log.message) ?? "Unknown task";
        const changes = Array.isArray(payload?.changeSummary) ? payload.changeSummary.slice(0, 5) : [];

        return [
          `- **${taskTitle}** at ${formatTimestamp(log.timestamp)}`,
          ...changes.map((summary) => `  - ${summary}`),
        ];
      }),
    );
  }

  if (legacyCounts.size > 0) {
    lines.push(
      "",
      "**Older manual-edit entries**",
      "I also found older audit records that confirm a direct Notion edit happened, but those entries were created before field-level diff capture was added.",
      ...[...legacyCounts.entries()].map(([taskTitle, record]) =>
        `- **${taskTitle}** had ${record.count} older manual update${record.count === 1 ? "" : "s"}${record.latestTimestamp ? `, most recently at ${formatTimestamp(record.latestTimestamp)}` : ""}.`,
      ),
    );
  }

  return lines.join("\n");
};

const buildApprovalAnswer = (approvals: ApprovalRecord[], logs: LogRecord[]): string => {
  const pendingApprovals = approvals.filter((approval) => ["pending", "awaiting approval", "needs approval"].includes(normalizeStatus(approval.status)));
  const recentApprovalLogs = logs
    .filter((log) => log.eventType === "APPROVAL_REQUESTED" || log.eventType === "APPROVAL_DECIDED")
    .slice(0, 5);

  const lines = [];

  if (pendingApprovals.length > 0) {
    lines.push(`I found ${pendingApprovals.length} approval item${pendingApprovals.length === 1 ? "" : "s"} that still need human attention.`);
    lines.push("", "**Pending approvals**");
    lines.push(...pendingApprovals.slice(0, 5).map((approval) => `- ${buildApprovalSummary(approval)}`));
  }

  if (recentApprovalLogs.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push("**Recent approval events**");
    lines.push(...recentApprovalLogs.map((log) => `- ${buildLogSummary(log).replace(/\n/g, " ")}`));
  }

  return lines.length > 0 ? lines.join("\n") : "There are no recent approval events in the audit trail.";
};

const buildWorkerAvailabilityAnswer = (worker: WorkerRecord, tasks: TaskRecord[]): string => {
  const assignedTasks = getWorkerAssignedTasks(worker, tasks);
  const load = worker.activeTaskCount ?? assignedTasks.length;
  const capacity = worker.capacity;
  const availability = worker.availability || "Unknown";
  const hasCapacity = capacity === undefined || capacity === null || load < capacity;
  const isAvailable = workerLooksAvailable(worker, tasks);

  let summary = `**${worker.name}** does not look free for another task right now.`;

  if (isAvailable) {
    if (capacity !== undefined && capacity !== null) {
      const remainingCapacity = Math.max(capacity - load, 0);
      summary = remainingCapacity > 0
        ? `Yes, **${worker.name}** looks available and appears to have capacity for ${remainingCapacity} more task${remainingCapacity === 1 ? "" : "s"}.`
        : `**${worker.name}** looks available, but I do not see any remaining capacity recorded in Notion.`;
    } else {
      summary = `Yes, **${worker.name}** looks available for another task right now.`;
    }
  } else if (!hasCapacity && capacity !== undefined && capacity !== null) {
    summary = `**${worker.name}** is already at capacity in Notion, so I would not treat them as free for a new task.`;
  } else if (normalizeStatus(availability) === "limited") {
    summary = `**${worker.name}** is marked as Limited, so I would treat them as only partially available right now.`;
  } else if (["busy", "unavailable", "offline", "inactive"].includes(normalizeStatus(availability))) {
    summary = `**${worker.name}** is marked as ${availability}, so they do not look available for new work right now.`;
  }

  const lines = [
    summary,
    "",
    "**Current worker state**",
    `- Availability in Notion: ${availability}`,
    `- Load: ${capacity !== undefined && capacity !== null ? `${load}/${capacity}` : String(load)}`,
    `- Timezone: ${worker.timezone || "Unknown"}`,
  ];

  if (typeof worker.hourlyRate === "number") {
    lines.push(`- Hourly rate: $${worker.hourlyRate}/hr`);
  }

  if (worker.skills.length > 0) {
    lines.push(`- Skills: ${worker.skills.join(", ")}`);
  }

  if (assignedTasks.length > 0) {
    lines.push(`- Active assignments: ${assignedTasks.map((task) => task.title).join(", ")}`);
  } else {
    lines.push("- Active assignments: none visible in current task data");
  }

  return lines.join("\n");
};

const buildWorkerOverviewAnswer = (worker: WorkerRecord, tasks: TaskRecord[]): string => {
  const assignedTasks = getWorkerAssignedTasks(worker, tasks);
  const load = worker.activeTaskCount ?? assignedTasks.length;
  const capacity = worker.capacity;

  const lines = [
    `Here is the current worker snapshot for **${worker.name}**:`,
    "",
    `- Availability: ${worker.availability || "Unknown"}`,
    `- Load: ${capacity !== undefined && capacity !== null ? `${load}/${capacity}` : String(load)}`,
    `- Timezone: ${worker.timezone || "Unknown"}`,
  ];

  if (typeof worker.hourlyRate === "number") {
    lines.push(`- Hourly rate: $${worker.hourlyRate}/hr`);
  }

  if (typeof worker.reputation === "number") {
    lines.push(`- Reputation: ${worker.reputation}`);
  }

  if (worker.skills.length > 0) {
    lines.push(`- Skills: ${worker.skills.join(", ")}`);
  }

  if (assignedTasks.length > 0) {
    lines.push(`- Active assignments: ${assignedTasks.map((task) => task.title).join(", ")}`);
  }

  return lines.join("\n");
};

const buildAvailableWorkersAnswer = (workers: WorkerRecord[], tasks: TaskRecord[]): string => {
  const availableWorkers = workers.filter((worker) => workerLooksAvailable(worker, tasks));

  if (availableWorkers.length === 0) {
    return "I do not see any workers who look fully free for new work right now based on the current Notion availability and load data.";
  }

  return [
    `I found ${availableWorkers.length} worker${availableWorkers.length === 1 ? "" : "s"} who currently look available for another task:`,
    "",
    "**Available workers**",
    ...availableWorkers.slice(0, 8).map((worker) => {
      const assignedTasks = getWorkerAssignedTasks(worker, tasks);
      const load = worker.activeTaskCount ?? assignedTasks.length;
      const capacity = worker.capacity;
      return `- **${worker.name}** — ${worker.availability || "Unknown"} | Load ${capacity !== undefined && capacity !== null ? `${load}/${capacity}` : String(load)} | Timezone ${worker.timezone || "Unknown"}`;
    }),
  ].join("\n");
};

const buildTaskSpecificAnswer = (task: TaskRecord, logs: LogRecord[]): string => {
  const relatedLogs = logs
    .filter((log) => log.entityId === task.id || log.message.toLowerCase().includes(`"${task.title.toLowerCase()}"`))
    .slice(0, 6);

  const lines = [
    `Here is the current audit view for **${task.title}**:`,
    "",
    `- Status: ${task.status || "Open"}`,
    `- Assigned worker: ${task.assignedWorkerName || "Unassigned"}`,
    `- Approval status: ${task.approvalStatus || "Not Required"}`,
  ];

  if (typeof task.aiConfidence === "number") {
    lines.push(`- AI confidence: ${task.aiConfidence.toFixed(2)}`);
  }

  if (task.completedAt) {
    lines.push(`- Completed at: ${formatTimestamp(task.completedAt)}`);
  }

  const latestManualLog = relatedLogs.find((log) => log.eventType === "TASK_UPDATED_MANUALLY");
  const manualPayload = latestManualLog ? parsePayload<AuditLogPayload>(latestManualLog.payload) : null;

  if (Array.isArray(manualPayload?.changeSummary) && manualPayload.changeSummary.length > 0) {
    lines.push("", "**Latest direct Notion changes**");
    lines.push(...manualPayload.changeSummary.map((summary) => `- ${summary}`));
  }

  if (relatedLogs.length > 0) {
    lines.push("", "**Recent audit events**");
    lines.push(...relatedLogs.map((log) => `- ${buildLogSummary(log).replace(/\n/g, " ")}`));
  }

  return lines.join("\n");
};

const buildHeuristicAnswer = (input: {
  message: string;
  tasks: TaskRecord[];
  workers: WorkerRecord[];
  approvals: ApprovalRecord[];
  logs: LogRecord[];
}): { answer: string; matched: boolean } => {
  const question = input.message.toLowerCase();
  const matchingTask = input.tasks.find((task) => question.includes(task.title.toLowerCase()));
  const matchingWorker = findMatchingWorker(question, input.workers);

  if (matchingWorker && isAvailabilityQuestion(question)) {
    return {
      answer: buildWorkerAvailabilityAnswer(matchingWorker, input.tasks),
      matched: true,
    };
  }

  if (!matchingWorker && isAvailabilityQuestion(question) && (question.includes("who") || question.includes("which"))) {
    return {
      answer: buildAvailableWorkersAnswer(input.workers, input.tasks),
      matched: true,
    };
  }

  if (matchingTask) {
    return {
      answer: buildTaskSpecificAnswer(matchingTask, input.logs),
      matched: true,
    };
  }

  if (matchingWorker) {
    return {
      answer: buildWorkerOverviewAnswer(matchingWorker, input.tasks),
      matched: true,
    };
  }

  if (question.includes("change") || question.includes("notion") || question.includes("manual")) {
    return {
      answer: buildManualChangeAnswer(input.logs),
      matched: true,
    };
  }

  if (question.includes("approval") || question.includes("approve") || question.includes("reject")) {
    return {
      answer: buildApprovalAnswer(input.approvals, input.logs),
      matched: true,
    };
  }

  return {
    answer: buildGenericAnswer(input.logs),
    matched: false,
  };
};

export class AuditChatService {
  constructor(
    private readonly notionMcpAdapter: NotionMcpAdapter,
    private readonly auditSyncService: AuditSyncService,
  ) {}

  async answerQuestion(input: {
    message: string;
    history?: AuditChatTurn[];
  }): Promise<{ answer: string; mode: "llm" | "heuristic" }> {
    const message = input.message.trim();

    if (!message) {
      throw new Error("message is required.");
    }

    await this.auditSyncService.reconcileTaskChanges();

    const [tasks, workers, approvals, logs] = await Promise.all([
      this.notionMcpAdapter.getTasks(),
      this.notionMcpAdapter.getWorkers(),
      this.notionMcpAdapter.getApprovals(),
      this.notionMcpAdapter.getLogs(),
    ]);
    const visibleLogs = getVisibleLogs(logs);
    const context = buildContext(tasks, workers, approvals, visibleLogs);
    const chatHistory = sanitizeHistory(input.history);
    const heuristicAnswer = buildHeuristicAnswer({
      message,
      tasks,
      workers,
      approvals,
      logs: visibleLogs,
    });

    if (heuristicAnswer.matched) {
      return {
        answer: heuristicAnswer.answer,
        mode: "heuristic",
      };
    }

    const llmMessages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You are the audit log assistant for the Global Human Workforce Orchestrator.",
          "Answer only from the provided audit, task, worker, and approval context.",
          "When asked about TASK_UPDATED_MANUALLY events, explain the exact Notion field changes clearly.",
          "When asked whether a worker is free or available, answer directly from worker availability, task load, capacity, and active assignment context.",
          "Write in natural language, not like a raw log dump.",
          "Use light Markdown formatting with short headings and bullets when it improves readability.",
          "Summarize repeated older legacy manual-update entries instead of repeating the same sentence over and over.",
          "If the context is insufficient, say so instead of guessing.",
          "Keep answers concise but specific.",
        ].join(" "),
      },
      {
        role: "system",
        content: context,
      },
      ...chatHistory,
      {
        role: "user",
        content: message,
      },
    ];

    const llmAnswer = await generateChatNarrative({
      messages: llmMessages,
      temperature: 0.1,
      warningLabel: "Audit chat assistant response failed",
    });

    if (llmAnswer) {
      return {
        answer: llmAnswer,
        mode: "llm",
      };
    }

    return {
      answer: heuristicAnswer.answer,
      mode: "heuristic",
    };
  }
}
