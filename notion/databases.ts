import { env } from "../config/env.js";
import { notionClient } from "./notionClient.js";

type NotionPropertySchema = {
  type: string;
  [key: string]: unknown;
};

type NotionSchemaMap = Record<string, NotionPropertySchema>;

type PropertyAssignment = {
  candidates: readonly string[];
  value: unknown;
};

export type LogEventType =
  | "TASK_CREATED"
  | "WORKER_SELECTED"
  | "APPROVAL_REQUESTED"
  | "TASK_ASSIGNED"
  | "TASK_COMPLETED"
  | "TASK_EVALUATED"
  | "APPROVAL_DECIDED"
  | "TASK_UPDATED_MANUALLY"
  | "TASK_STATE_SNAPSHOT";

export interface TaskRecord {
  id: string;
  pageId: string;
  notionUrl?: string;
  title: string;
  description: string;
  requiredSkill: string;
  priority: string;
  status: string;
  assignedWorkerId?: string;
  assignedWorkerName?: string;
  aiConfidence?: number;
  selectionReason?: string;
  humanApprovalNeeded: boolean;
  approvalStatus: string;
  budget?: number;
  timezonePreference?: string;
  qualityScore?: number;
  humanReviewNeeded: boolean;
  completionNotes?: string;
  createdAt?: string;
  completedAt?: string;
  lastEditedAt?: string;
}

export interface WorkerRecord {
  id: string;
  pageId: string;
  notionUrl?: string;
  name: string;
  skills: string[];
  availability: string;
  timezone: string;
  hourlyRate?: number;
  reputation?: number;
  capacity?: number;
  activeTaskCount?: number;
  notes?: string;
  slackHandle?: string;
}

export interface ApprovalRecord {
  id: string;
  pageId: string;
  notionUrl?: string;
  taskId: string;
  taskTitle?: string;
  workerId: string;
  workerName?: string;
  status: string;
  confidence?: number;
  reviewer?: string;
  notes?: string;
  reason?: string;
  requestedAt?: string;
  resolvedAt?: string;
}

export interface LogRecord {
  id: string;
  eventType: string;
  message: string;
  severity: string;
  entityType?: string;
  entityId?: string;
  payload?: string;
  timestamp?: string;
}

export interface DashboardStats {
  totalTasks: number;
  openTasks: number;
  assignedTasks: number;
  completedTasks: number;
  pendingApprovals: number;
  activeWorkers: number;
  averageConfidence: number;
  averageQualityScore: number;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  requiredSkill: string;
  priority: string;
  budget?: number;
  timezonePreference?: string;
  createdBy?: string;
}

export interface CreateWorkerInput {
  name: string;
  skills: string[];
  availability: string;
  timezone: string;
  hourlyRate?: number;
  reputation?: number;
  capacity?: number;
  activeTaskCount?: number;
  notes?: string;
  slackHandle?: string;
}

export interface AssignWorkerInput {
  workerId: string;
  workerName: string;
  confidence: number;
  selectionReason: string;
  approvalStatus?: string;
  humanApprovalNeeded?: boolean;
  status?: string;
}

export interface TaskApprovalStateInput {
  approvalStatus: string;
  humanApprovalNeeded: boolean;
  status?: string;
  selectionReason?: string;
  confidence?: number;
}

export interface CreateApprovalInput {
  taskId: string;
  taskTitle: string;
  workerId: string;
  workerName: string;
  confidence: number;
  reason: string;
}

export interface ApprovalDecisionInput {
  status: string;
  reviewer?: string;
  notes?: string;
}

export interface TaskCompletionInput {
  completionNotes: string;
  completedAt?: string;
}

export interface TaskEvaluationInput {
  qualityScore: number;
  humanReviewNeeded: boolean;
  selectionReason?: string;
}

export interface CreateLogInput {
  eventType: LogEventType;
  message: string;
  severity?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

const schemaCache = new Map<string, NotionSchemaMap>();
const dataSourceIdCache = new Map<string, string>();
const databaseReferenceCache = new Map<string, string>();

const normalizeNotionReference = (value: string): string => {
  const trimmedValue = value.trim();
  const hyphenatedMatch = trimmedValue.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  if (hyphenatedMatch) {
    return hyphenatedMatch[0].replace(/-/g, "");
  }

  const compactMatch = trimmedValue.match(/[0-9a-f]{32}/i);
  return compactMatch ? compactMatch[0].toLowerCase() : trimmedValue;
};

const resolveDatabaseEnvName = (databaseId: string): string => {
  if (databaseId === env.tasksDbId) {
    return "TASKS_DB_ID";
  }

  if (databaseId === env.workersDbId) {
    return "WORKERS_DB_ID";
  }

  if (databaseId === env.approvalsDbId) {
    return "APPROVALS_DB_ID";
  }

  if (databaseId === env.logsDbId) {
    return "LOGS_DB_ID";
  }

  return "database_id";
};

const TASK_FIELDS = {
  title: ["Task", "Title", "Name"],
  description: ["Description", "Task Description"],
  requiredSkill: ["Required Skill", "Skill"],
  priority: ["Priority"],
  status: ["Status"],
  assignedWorker: ["Assigned Worker", "Worker"],
  assignedWorkerName: ["Assigned Worker Name", "Worker Name"],
  aiConfidence: ["AI Confidence", "Confidence"],
  selectionReason: ["Selection Reason", "Assignment Reason", "Reason"],
  humanApprovalNeeded: ["Human Approval Needed", "Needs Approval"],
  approvalStatus: ["Approval Status"],
  budget: ["Budget", "Max Cost"],
  timezonePreference: ["Timezone Preference", "Preferred Timezone", "Time Zone"],
  qualityScore: ["Quality Score"],
  humanReviewNeeded: ["Human Review Needed", "Needs Human Review"],
  completionNotes: ["Completion Notes", "Completion Summary"],
  completedAt: ["Completed At"],
  createdBy: ["Created By", "Requester"],
} as const;

const WORKER_FIELDS = {
  name: ["Worker", "Name", "Full Name"],
  skills: ["Skills", "Skill Set"],
  availability: ["Availability", "Status"],
  timezone: ["Timezone", "Time Zone"],
  hourlyRate: ["Hourly Rate", "Cost", "Rate"],
  reputation: ["Reputation", "Worker Score"],
  capacity: ["Capacity", "Max Parallel Tasks"],
  activeTaskCount: ["Active Task Count", "Current Load", "Open Tasks"],
  notes: ["Notes", "Profile"],
  slackHandle: ["Slack", "Slack Handle"],
} as const;

const APPROVAL_FIELDS = {
  name: ["Approval", "Name", "Request"],
  task: ["Task", "Task Page"],
  taskTitle: ["Task Title", "Task Name"],
  worker: ["Worker", "Worker Page"],
  workerName: ["Worker Name"],
  status: ["Status", "Approval Status"],
  reviewer: ["Reviewer", "Approved By"],
  notes: ["Notes", "Decision Notes"],
  confidence: ["Confidence", "AI Confidence"],
  reason: ["Reason", "Recommendation"],
  requestedAt: ["Requested At", "Created At"],
  resolvedAt: ["Resolved At", "Decision At"],
} as const;

const LOG_FIELDS = {
  title: ["Log", "Name", "Event"],
  eventType: ["Event Type", "Type"],
  message: ["Message", "Summary"],
  severity: ["Severity", "Level"],
  entityType: ["Entity Type"],
  entityId: ["Entity ID", "Entity Id", "Reference"],
  payload: ["Payload", "Metadata", "Details"],
  timestamp: ["Timestamp", "Occurred At", "Created At"],
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const toChunks = (value: string, size = 1800): string[] => {
  const safeValue = value.trim();

  if (!safeValue) {
    return [];
  }

  const chunks: string[] = [];

  for (let index = 0; index < safeValue.length; index += size) {
    chunks.push(safeValue.slice(index, index + size));
  }

  return chunks;
};

const toRichTextArray = (value: string): Array<{ type: "text"; text: { content: string } }> =>
  toChunks(value).map((chunk) => ({
    type: "text",
    text: {
      content: chunk,
    },
  }));

const normalizeId = (value?: string): string => (value ?? "").replace(/-/g, "").toLowerCase();

const serializePayload = (payload?: Record<string, unknown>): string => {
  if (!payload) {
    return "";
  }

  return JSON.stringify(payload, null, 2).slice(0, 6000);
};

const parseOffsetFromString = (value: string): number | null => {
  const match = value.match(/(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?/i);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");

  return (hours * 60) + (hours >= 0 ? minutes : -minutes);
};

export const resolveTimezoneOffset = (timezone: string): number | null => {
  if (!timezone) {
    return null;
  }

  const directOffset = parseOffsetFromString(timezone);

  if (directOffset !== null) {
    return directOffset;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });

    const offsetPart = formatter
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;

    return offsetPart ? parseOffsetFromString(offsetPart) : null;
  } catch {
    return null;
  }
};

const getSchema = async (databaseId: string): Promise<NotionSchemaMap> => {
  const cachedSchema = schemaCache.get(databaseId);

  if (cachedSchema) {
    return cachedSchema;
  }

  const dataSourceId = await getDataSourceId(databaseId);
  const dataSource = await notionClient.dataSources.retrieve({
    data_source_id: dataSourceId,
  });

  const properties = ((dataSource as { properties?: NotionSchemaMap }).properties ?? {}) as NotionSchemaMap;
  schemaCache.set(databaseId, properties);

  return properties;
};

const retrieveDatabaseWithFallback = async (databaseId: string) => {
  const envName = resolveDatabaseEnvName(databaseId);

  try {
    return await notionClient.databases.retrieve({
      database_id: databaseId,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("is a page, not a database")) {
      throw error;
    }

    const resolvedDatabaseId = await resolveDatabaseIdFromPage(databaseId, envName);
    databaseReferenceCache.set(databaseId, resolvedDatabaseId);

    return notionClient.databases.retrieve({
      database_id: resolvedDatabaseId,
    });
  }
};

const resolveDatabaseIdFromPage = async (pageId: string, envName: string): Promise<string> => {
  const response = await notionClient.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  const blocks = response.results as Array<Record<string, unknown>>;

  for (const block of blocks) {
    if (block.type === "link_to_page") {
      const linkedPage = (block.link_to_page as Record<string, unknown> | undefined) ?? {};

      if (linkedPage.type === "database_id" && typeof linkedPage.database_id === "string") {
        return normalizeNotionReference(linkedPage.database_id);
      }
    }

    if (block.type === "child_database" && typeof block.id === "string") {
      return normalizeNotionReference(block.id);
    }
  }

  throw new Error(
    `${envName} points to a page, not a database, and no inline or linked database was found on that page. Open the real source database in Notion and copy that URL/ID instead.`,
  );
};

const getDataSourceId = async (databaseId: string): Promise<string> => {
  const normalizedReference = normalizeNotionReference(databaseId);
  const resolvedReference = databaseReferenceCache.get(normalizedReference) ?? normalizedReference;
  const cachedDataSourceId = dataSourceIdCache.get(resolvedReference) ?? dataSourceIdCache.get(normalizedReference);

  if (cachedDataSourceId) {
    return cachedDataSourceId;
  }

  const envName = resolveDatabaseEnvName(databaseId);
  const database = await retrieveDatabaseWithFallback(resolvedReference);
  const resolvedDatabaseId = normalizeNotionReference(String(database.id ?? resolvedReference));

  const dataSourceId = (database as { data_sources?: Array<{ id?: string }> }).data_sources?.[0]?.id;

  if (!dataSourceId) {
    throw new Error(`${envName} does not expose a queryable data source. Make sure it points to a real Notion database, not a page or unsupported view.`);
  }

  databaseReferenceCache.set(normalizedReference, resolvedDatabaseId);
  dataSourceIdCache.set(normalizedReference, dataSourceId);
  dataSourceIdCache.set(resolvedDatabaseId, dataSourceId);
  return dataSourceId;
};

const getPageProperty = (properties: Record<string, unknown>, candidates: readonly string[]): unknown => {
  for (const candidate of candidates) {
    if (candidate in properties) {
      return properties[candidate];
    }

    const match = Object.entries(properties).find(([propertyName]) => propertyName.toLowerCase() === candidate.toLowerCase());

    if (match) {
      return match[1];
    }
  }

  return undefined;
};

const getSchemaProperty = (schema: NotionSchemaMap, candidates: readonly string[]): { name: string; schema: NotionPropertySchema } | null => {
  for (const candidate of candidates) {
    if (candidate in schema) {
      return {
        name: candidate,
        schema: schema[candidate],
      };
    }

    const match = Object.entries(schema).find(([propertyName]) => propertyName.toLowerCase() === candidate.toLowerCase());

    if (match) {
      return {
        name: match[0],
        schema: match[1],
      };
    }
  }

  return null;
};

const extractText = (property: unknown): string => {
  if (!property || typeof property !== "object") {
    return "";
  }

  const typedProperty = property as Record<string, unknown>;
  const propertyType = String(typedProperty.type ?? "");

  if (propertyType === "title") {
    return ((typedProperty.title as Array<{ plain_text?: string }>) ?? []).map((item) => item.plain_text ?? "").join("");
  }

  if (propertyType === "rich_text") {
    return ((typedProperty.rich_text as Array<{ plain_text?: string }>) ?? []).map((item) => item.plain_text ?? "").join("");
  }

  if (propertyType === "select") {
    return ((typedProperty.select as { name?: string } | null) ?? {}).name ?? "";
  }

  if (propertyType === "status") {
    return ((typedProperty.status as { name?: string } | null) ?? {}).name ?? "";
  }

  if (propertyType === "number") {
    return typedProperty.number === null || typedProperty.number === undefined ? "" : String(typedProperty.number);
  }

  if (propertyType === "checkbox") {
    return String(Boolean(typedProperty.checkbox));
  }

  if (propertyType === "date") {
    return ((typedProperty.date as { start?: string } | null) ?? {}).start ?? "";
  }

  if (propertyType === "formula") {
    const formula = (typedProperty.formula as Record<string, unknown> | null) ?? {};

    if (formula.type === "string") {
      return String(formula.string ?? "");
    }

    if (formula.type === "number") {
      return formula.number === null || formula.number === undefined ? "" : String(formula.number);
    }
  }

  return "";
};

const extractNumber = (property: unknown): number | undefined => {
  if (!property || typeof property !== "object") {
    return undefined;
  }

  const typedProperty = property as Record<string, unknown>;
  const propertyType = String(typedProperty.type ?? "");

  if (propertyType === "number") {
    return typeof typedProperty.number === "number" ? typedProperty.number : undefined;
  }

  if (propertyType === "formula") {
    const formula = (typedProperty.formula as Record<string, unknown> | null) ?? {};
    return typeof formula.number === "number" ? formula.number : undefined;
  }

  const fromText = Number(extractText(property));
  return Number.isFinite(fromText) ? fromText : undefined;
};

const extractBoolean = (property: unknown): boolean => {
  if (!property || typeof property !== "object") {
    return false;
  }

  const typedProperty = property as Record<string, unknown>;
  const propertyType = String(typedProperty.type ?? "");

  if (propertyType === "checkbox") {
    return Boolean(typedProperty.checkbox);
  }

  const text = extractText(property).toLowerCase();
  return text === "true" || text === "yes";
};

const extractMultiSelect = (property: unknown): string[] => {
  if (!property || typeof property !== "object") {
    return [];
  }

  const typedProperty = property as Record<string, unknown>;
  const propertyType = String(typedProperty.type ?? "");

  if (propertyType === "multi_select") {
    return ((typedProperty.multi_select as Array<{ name?: string }>) ?? [])
      .map((option) => option.name?.trim() ?? "")
      .filter(Boolean);
  }

  return extractText(property)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
};

const extractRelations = (property: unknown): string[] => {
  if (!property || typeof property !== "object") {
    return [];
  }

  const typedProperty = property as Record<string, unknown>;

  if (typedProperty.type !== "relation") {
    const value = extractText(property).trim();
    return value ? [value] : [];
  }

  return ((typedProperty.relation as Array<{ id?: string }>) ?? [])
    .map((relation) => relation.id?.trim() ?? "")
    .filter(Boolean);
};

const applyAssignment = (schema: NotionSchemaMap, properties: Record<string, unknown>, assignment: PropertyAssignment): void => {
  const propertyDefinition = getSchemaProperty(schema, assignment.candidates);

  if (!propertyDefinition || assignment.value === undefined || assignment.value === null) {
    return;
  }

  const { name, schema: propertySchema } = propertyDefinition;
  const propertyType = propertySchema.type;

  if (typeof assignment.value === "string" && assignment.value.trim() === "") {
    return;
  }

  if (Array.isArray(assignment.value) && assignment.value.length === 0) {
    return;
  }

  if (propertyType === "title" && typeof assignment.value === "string") {
    properties[name] = { title: toRichTextArray(assignment.value) };
    return;
  }

  if (propertyType === "rich_text") {
    properties[name] = {
      rich_text: toRichTextArray(Array.isArray(assignment.value) ? assignment.value.join(", ") : String(assignment.value)),
    };
    return;
  }

  if (propertyType === "number") {
    const numericValue = Number(assignment.value);

    if (Number.isFinite(numericValue)) {
      properties[name] = { number: numericValue };
    }

    return;
  }

  if (propertyType === "checkbox") {
    properties[name] = { checkbox: Boolean(assignment.value) };
    return;
  }

  if ((propertyType === "select" || propertyType === "status") && typeof assignment.value === "string") {
    properties[name] = {
      [propertyType]: {
        name: assignment.value,
      },
    };
    return;
  }

  if (propertyType === "multi_select") {
    const values = Array.isArray(assignment.value) ? assignment.value : [assignment.value];
    const uniqueValues = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];

    properties[name] = {
      multi_select: uniqueValues.map((value) => ({ name: value })),
    };
    return;
  }

  if (propertyType === "relation") {
    const relationIds = Array.isArray(assignment.value) ? assignment.value : [assignment.value];

    properties[name] = {
      relation: relationIds.map((relationId) => ({
        id: String(relationId),
      })),
    };
    return;
  }

  if (propertyType === "date") {
    const dateValue = assignment.value instanceof Date ? assignment.value.toISOString() : String(assignment.value);
    properties[name] = {
      date: {
        start: dateValue,
      },
    };
  }
};

const buildProperties = async (databaseId: string, assignments: PropertyAssignment[]): Promise<Record<string, unknown>> => {
  const schema = await getSchema(databaseId);
  const properties: Record<string, unknown> = {};

  assignments.forEach((assignment) => applyAssignment(schema, properties, assignment));

  return properties;
};

const queryAllPages = async (databaseId: string): Promise<Array<Record<string, unknown>>> => {
  const pages: Array<Record<string, unknown>> = [];
  const dataSourceId = await getDataSourceId(databaseId);
  let nextCursor: string | undefined;

  do {
    const response = await notionClient.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: nextCursor,
    });

    pages.push(
      ...response.results
        .filter((result: Record<string, unknown>) => "properties" in result)
        .map((result: Record<string, unknown>) => result),
    );

    nextCursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (nextCursor);

  return pages;
};

const findPageInDatabase = async (databaseId: string, pageId: string): Promise<Record<string, unknown>> => {
  const pages = await queryAllPages(databaseId);
  const match = pages.find((page) => normalizeId(String(page.id ?? "")) === normalizeId(pageId));

  if (!match) {
    throw new Error(`Could not find page ${pageId} in database ${databaseId}.`);
  }

  return match;
};

const mapTaskPage = (page: Record<string, unknown>): TaskRecord => {
  const properties = (page.properties as Record<string, unknown>) ?? {};
  const assignedWorkerId = extractRelations(getPageProperty(properties, TASK_FIELDS.assignedWorker))[0];

  return {
    id: String(page.id),
    pageId: String(page.id),
    notionUrl: String(page.url ?? ""),
    title: extractText(getPageProperty(properties, TASK_FIELDS.title)) || `Task ${String(page.id).slice(0, 8)}`,
    description: extractText(getPageProperty(properties, TASK_FIELDS.description)),
    requiredSkill: extractText(getPageProperty(properties, TASK_FIELDS.requiredSkill)),
    priority: extractText(getPageProperty(properties, TASK_FIELDS.priority)) || "Medium",
    status: extractText(getPageProperty(properties, TASK_FIELDS.status)) || "Open",
    assignedWorkerId,
    assignedWorkerName: extractText(getPageProperty(properties, TASK_FIELDS.assignedWorkerName)),
    aiConfidence: extractNumber(getPageProperty(properties, TASK_FIELDS.aiConfidence)),
    selectionReason: extractText(getPageProperty(properties, TASK_FIELDS.selectionReason)),
    humanApprovalNeeded: extractBoolean(getPageProperty(properties, TASK_FIELDS.humanApprovalNeeded)),
    approvalStatus: extractText(getPageProperty(properties, TASK_FIELDS.approvalStatus)) || "Not Required",
    budget: extractNumber(getPageProperty(properties, TASK_FIELDS.budget)),
    timezonePreference: extractText(getPageProperty(properties, TASK_FIELDS.timezonePreference)),
    qualityScore: extractNumber(getPageProperty(properties, TASK_FIELDS.qualityScore)),
    humanReviewNeeded: extractBoolean(getPageProperty(properties, TASK_FIELDS.humanReviewNeeded)),
    completionNotes: extractText(getPageProperty(properties, TASK_FIELDS.completionNotes)),
    createdAt: String(page.created_time ?? ""),
    completedAt: extractText(getPageProperty(properties, TASK_FIELDS.completedAt)),
    lastEditedAt: String(page.last_edited_time ?? ""),
  };
};

const mapWorkerPage = (page: Record<string, unknown>): WorkerRecord => {
  const properties = (page.properties as Record<string, unknown>) ?? {};

  return {
    id: String(page.id),
    pageId: String(page.id),
    notionUrl: String(page.url ?? ""),
    name: extractText(getPageProperty(properties, WORKER_FIELDS.name)) || `Worker ${String(page.id).slice(0, 8)}`,
    skills: extractMultiSelect(getPageProperty(properties, WORKER_FIELDS.skills)),
    availability: extractText(getPageProperty(properties, WORKER_FIELDS.availability)) || "Available",
    timezone: extractText(getPageProperty(properties, WORKER_FIELDS.timezone)),
    hourlyRate: extractNumber(getPageProperty(properties, WORKER_FIELDS.hourlyRate)),
    reputation: extractNumber(getPageProperty(properties, WORKER_FIELDS.reputation)),
    capacity: extractNumber(getPageProperty(properties, WORKER_FIELDS.capacity)),
    activeTaskCount: extractNumber(getPageProperty(properties, WORKER_FIELDS.activeTaskCount)),
    notes: extractText(getPageProperty(properties, WORKER_FIELDS.notes)),
    slackHandle: extractText(getPageProperty(properties, WORKER_FIELDS.slackHandle)),
  };
};

const mapApprovalPage = (page: Record<string, unknown>): ApprovalRecord => {
  const properties = (page.properties as Record<string, unknown>) ?? {};

  return {
    id: String(page.id),
    pageId: String(page.id),
    notionUrl: String(page.url ?? ""),
    taskId: extractRelations(getPageProperty(properties, APPROVAL_FIELDS.task))[0] ?? "",
    taskTitle: extractText(getPageProperty(properties, APPROVAL_FIELDS.taskTitle)),
    workerId: extractRelations(getPageProperty(properties, APPROVAL_FIELDS.worker))[0] ?? "",
    workerName: extractText(getPageProperty(properties, APPROVAL_FIELDS.workerName)),
    status: extractText(getPageProperty(properties, APPROVAL_FIELDS.status)) || "Pending",
    confidence: extractNumber(getPageProperty(properties, APPROVAL_FIELDS.confidence)),
    reviewer: extractText(getPageProperty(properties, APPROVAL_FIELDS.reviewer)),
    notes: extractText(getPageProperty(properties, APPROVAL_FIELDS.notes)),
    reason: extractText(getPageProperty(properties, APPROVAL_FIELDS.reason)),
    requestedAt: extractText(getPageProperty(properties, APPROVAL_FIELDS.requestedAt)) || String(page.created_time ?? ""),
    resolvedAt: extractText(getPageProperty(properties, APPROVAL_FIELDS.resolvedAt)),
  };
};

const mapLogPage = (page: Record<string, unknown>): LogRecord => {
  const properties = (page.properties as Record<string, unknown>) ?? {};

  return {
    id: String(page.id),
    eventType: extractText(getPageProperty(properties, LOG_FIELDS.eventType)),
    message: extractText(getPageProperty(properties, LOG_FIELDS.message)),
    severity: extractText(getPageProperty(properties, LOG_FIELDS.severity)) || "INFO",
    entityType: extractText(getPageProperty(properties, LOG_FIELDS.entityType)),
    entityId: extractText(getPageProperty(properties, LOG_FIELDS.entityId)),
    payload: extractText(getPageProperty(properties, LOG_FIELDS.payload)),
    timestamp: extractText(getPageProperty(properties, LOG_FIELDS.timestamp)) || String(page.created_time ?? ""),
  };
};

export const listTasks = async (): Promise<TaskRecord[]> => {
  const pages = await queryAllPages(env.tasksDbId);
  return pages.map(mapTaskPage);
};

export const listWorkers = async (): Promise<WorkerRecord[]> => {
  const pages = await queryAllPages(env.workersDbId);
  return pages.map(mapWorkerPage);
};

export const listApprovals = async (): Promise<ApprovalRecord[]> => {
  const pages = await queryAllPages(env.approvalsDbId);
  return pages.map(mapApprovalPage);
};

export const listLogs = async (): Promise<LogRecord[]> => {
  const pages = await queryAllPages(env.logsDbId);
  return pages.map(mapLogPage);
};

export const findTaskById = async (taskId: string): Promise<TaskRecord> => {
  const page = await findPageInDatabase(env.tasksDbId, taskId);
  return mapTaskPage(page);
};

export const findWorkerById = async (workerId: string): Promise<WorkerRecord> => {
  const page = await findPageInDatabase(env.workersDbId, workerId);
  return mapWorkerPage(page);
};

export const findApprovalById = async (approvalId: string): Promise<ApprovalRecord> => {
  const page = await findPageInDatabase(env.approvalsDbId, approvalId);
  return mapApprovalPage(page);
};

export const createTaskPage = async (input: CreateTaskInput): Promise<TaskRecord> => {
  const dataSourceId = await getDataSourceId(env.tasksDbId);
  const properties = await buildProperties(env.tasksDbId, [
    { candidates: TASK_FIELDS.title, value: input.title },
    { candidates: TASK_FIELDS.description, value: input.description },
    { candidates: TASK_FIELDS.requiredSkill, value: input.requiredSkill },
    { candidates: TASK_FIELDS.priority, value: input.priority },
    { candidates: TASK_FIELDS.status, value: "Open" },
    { candidates: TASK_FIELDS.approvalStatus, value: "Not Required" },
    { candidates: TASK_FIELDS.humanApprovalNeeded, value: false },
    { candidates: TASK_FIELDS.budget, value: input.budget },
    { candidates: TASK_FIELDS.timezonePreference, value: input.timezonePreference },
    { candidates: TASK_FIELDS.createdBy, value: input.createdBy },
  ]);

  const page = await notionClient.pages.create({
    parent: {
      data_source_id: dataSourceId,
    },
    properties: properties as never,
  });

  return mapTaskPage(page as unknown as Record<string, unknown>);
};

export const createWorkerPage = async (input: CreateWorkerInput): Promise<WorkerRecord> => {
  const dataSourceId = await getDataSourceId(env.workersDbId);
  const properties = await buildProperties(env.workersDbId, [
    { candidates: WORKER_FIELDS.name, value: input.name },
    { candidates: WORKER_FIELDS.skills, value: input.skills },
    { candidates: WORKER_FIELDS.availability, value: input.availability },
    { candidates: WORKER_FIELDS.timezone, value: input.timezone },
    { candidates: WORKER_FIELDS.hourlyRate, value: input.hourlyRate },
    { candidates: WORKER_FIELDS.reputation, value: input.reputation },
    { candidates: WORKER_FIELDS.capacity, value: input.capacity },
    { candidates: WORKER_FIELDS.activeTaskCount, value: input.activeTaskCount },
    { candidates: WORKER_FIELDS.notes, value: input.notes },
    { candidates: WORKER_FIELDS.slackHandle, value: input.slackHandle },
  ]);

  const page = await notionClient.pages.create({
    parent: {
      data_source_id: dataSourceId,
    },
    properties: properties as never,
  });

  return mapWorkerPage(page as unknown as Record<string, unknown>);
};

export const updateTaskAssignment = async (taskId: string, input: AssignWorkerInput): Promise<TaskRecord> => {
  const taskPage = await findPageInDatabase(env.tasksDbId, taskId);
  const properties = await buildProperties(env.tasksDbId, [
    { candidates: TASK_FIELDS.assignedWorker, value: input.workerId },
    { candidates: TASK_FIELDS.assignedWorkerName, value: input.workerName },
    { candidates: TASK_FIELDS.aiConfidence, value: clamp(input.confidence, 0, 1) },
    { candidates: TASK_FIELDS.selectionReason, value: input.selectionReason },
    { candidates: TASK_FIELDS.approvalStatus, value: input.approvalStatus ?? "Not Required" },
    { candidates: TASK_FIELDS.humanApprovalNeeded, value: input.humanApprovalNeeded ?? false },
    { candidates: TASK_FIELDS.status, value: input.status ?? "Assigned" },
  ]);

  const updatedPage = await notionClient.pages.update({
    page_id: String(taskPage.id),
    properties: properties as never,
  });

  return mapTaskPage(updatedPage as unknown as Record<string, unknown>);
};

export const updateTaskApprovalState = async (taskId: string, input: TaskApprovalStateInput): Promise<TaskRecord> => {
  const taskPage = await findPageInDatabase(env.tasksDbId, taskId);
  const properties = await buildProperties(env.tasksDbId, [
    { candidates: TASK_FIELDS.approvalStatus, value: input.approvalStatus },
    { candidates: TASK_FIELDS.humanApprovalNeeded, value: input.humanApprovalNeeded },
    { candidates: TASK_FIELDS.status, value: input.status },
    { candidates: TASK_FIELDS.selectionReason, value: input.selectionReason },
    { candidates: TASK_FIELDS.aiConfidence, value: input.confidence },
  ]);

  const updatedPage = await notionClient.pages.update({
    page_id: String(taskPage.id),
    properties: properties as never,
  });

  return mapTaskPage(updatedPage as unknown as Record<string, unknown>);
};

export const updateTaskCompletion = async (taskId: string, input: TaskCompletionInput): Promise<TaskRecord> => {
  const taskPage = await findPageInDatabase(env.tasksDbId, taskId);
  const properties = await buildProperties(env.tasksDbId, [
    { candidates: TASK_FIELDS.status, value: "Completed" },
    { candidates: TASK_FIELDS.completedAt, value: input.completedAt ?? new Date().toISOString() },
    { candidates: TASK_FIELDS.completionNotes, value: input.completionNotes },
  ]);

  const updatedPage = await notionClient.pages.update({
    page_id: String(taskPage.id),
    properties: properties as never,
  });

  return mapTaskPage(updatedPage as unknown as Record<string, unknown>);
};

export const updateTaskEvaluation = async (taskId: string, input: TaskEvaluationInput): Promise<TaskRecord> => {
  const taskPage = await findPageInDatabase(env.tasksDbId, taskId);
  const properties = await buildProperties(env.tasksDbId, [
    { candidates: TASK_FIELDS.qualityScore, value: input.qualityScore },
    { candidates: TASK_FIELDS.humanReviewNeeded, value: input.humanReviewNeeded },
    { candidates: TASK_FIELDS.selectionReason, value: input.selectionReason },
  ]);

  const updatedPage = await notionClient.pages.update({
    page_id: String(taskPage.id),
    properties: properties as never,
  });

  return mapTaskPage(updatedPage as unknown as Record<string, unknown>);
};

export const createApprovalPage = async (input: CreateApprovalInput): Promise<ApprovalRecord> => {
  const dataSourceId = await getDataSourceId(env.approvalsDbId);
  const properties = await buildProperties(env.approvalsDbId, [
    { candidates: APPROVAL_FIELDS.name, value: `Approval for ${input.taskTitle}` },
    { candidates: APPROVAL_FIELDS.task, value: input.taskId },
    { candidates: APPROVAL_FIELDS.taskTitle, value: input.taskTitle },
    { candidates: APPROVAL_FIELDS.worker, value: input.workerId },
    { candidates: APPROVAL_FIELDS.workerName, value: input.workerName },
    { candidates: APPROVAL_FIELDS.status, value: "Pending" },
    { candidates: APPROVAL_FIELDS.confidence, value: clamp(input.confidence, 0, 1) },
    { candidates: APPROVAL_FIELDS.reason, value: input.reason },
    { candidates: APPROVAL_FIELDS.requestedAt, value: new Date().toISOString() },
  ]);

  const page = await notionClient.pages.create({
    parent: {
      data_source_id: dataSourceId,
    },
    properties: properties as never,
  });

  return mapApprovalPage(page as unknown as Record<string, unknown>);
};

export const updateApprovalDecision = async (approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalRecord> => {
  const approvalPage = await findPageInDatabase(env.approvalsDbId, approvalId);
  const properties = await buildProperties(env.approvalsDbId, [
    { candidates: APPROVAL_FIELDS.status, value: input.status },
    { candidates: APPROVAL_FIELDS.reviewer, value: input.reviewer },
    { candidates: APPROVAL_FIELDS.notes, value: input.notes },
    { candidates: APPROVAL_FIELDS.resolvedAt, value: new Date().toISOString() },
  ]);

  const updatedPage = await notionClient.pages.update({
    page_id: String(approvalPage.id),
    properties: properties as never,
  });

  return mapApprovalPage(updatedPage as unknown as Record<string, unknown>);
};

export const createLogPage = async (input: CreateLogInput): Promise<LogRecord> => {
  const dataSourceId = await getDataSourceId(env.logsDbId);
  const properties = await buildProperties(env.logsDbId, [
    { candidates: LOG_FIELDS.title, value: `${input.eventType} ${new Date().toISOString()}` },
    { candidates: LOG_FIELDS.eventType, value: input.eventType },
    { candidates: LOG_FIELDS.message, value: input.message },
    { candidates: LOG_FIELDS.severity, value: input.severity ?? "INFO" },
    { candidates: LOG_FIELDS.entityType, value: input.entityType },
    { candidates: LOG_FIELDS.entityId, value: input.entityId },
    { candidates: LOG_FIELDS.payload, value: serializePayload(input.payload) },
    { candidates: LOG_FIELDS.timestamp, value: new Date().toISOString() },
  ]);

  const page = await notionClient.pages.create({
    parent: {
      data_source_id: dataSourceId,
    },
    properties: properties as never,
  });

  return mapLogPage(page as unknown as Record<string, unknown>);
};

export const buildDashboardStats = (
  tasks: TaskRecord[],
  workers: WorkerRecord[],
  approvals: ApprovalRecord[],
): DashboardStats => {
  const taskConfidences = tasks
    .map((task) => task.aiConfidence)
    .filter((value): value is number => typeof value === "number");
  const qualityScores = tasks
    .map((task) => task.qualityScore)
    .filter((value): value is number => typeof value === "number");
  const normalizeStatus = (value: string): string => value.trim().toLowerCase();
  const pendingApprovalCount = new Set(
    approvals
      .filter((approval) => ["pending", "awaiting approval", "needs approval"].includes(normalizeStatus(approval.status)))
      .map((approval) => approval.taskId || approval.id),
  ).size;
  const deriveTaskState = (task: TaskRecord): "open" | "assigned" | "completed" | "pending approval" | "rejected" => {
    const taskStatus = normalizeStatus(task.status);
    const approvalStatus = normalizeStatus(task.approvalStatus);

    if (task.completedAt || ["completed", "done", "closed", "delivered", "finished"].includes(taskStatus)) {
      return "completed";
    }

    if (
      task.humanApprovalNeeded
      || ["pending", "awaiting approval", "needs approval"].includes(approvalStatus)
      || ["pending approval", "awaiting approval", "needs approval"].includes(taskStatus)
    ) {
      return "pending approval";
    }

    if (["rejected", "declined", "blocked"].includes(taskStatus) || ["rejected", "declined"].includes(approvalStatus)) {
      return "rejected";
    }

    if (
      task.assignedWorkerId
      || task.assignedWorkerName
      || ["assigned", "in progress", "active", "working"].includes(taskStatus)
    ) {
      return "assigned";
    }

    return "open";
  };

  return {
    totalTasks: tasks.length,
    openTasks: tasks.filter((task) => ["open", "pending approval", "rejected"].includes(deriveTaskState(task))).length,
    assignedTasks: tasks.filter((task) => deriveTaskState(task) === "assigned").length,
    completedTasks: tasks.filter((task) => deriveTaskState(task) === "completed").length,
    pendingApprovals: pendingApprovalCount,
    activeWorkers: workers.filter((worker) => !["offline", "inactive", "unavailable"].includes(normalizeStatus(worker.availability))).length,
    averageConfidence: taskConfidences.length
      ? Number((taskConfidences.reduce((sum, value) => sum + value, 0) / taskConfidences.length).toFixed(2))
      : 0,
    averageQualityScore: qualityScores.length
      ? Number((qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length).toFixed(2))
      : 0,
  };
};
