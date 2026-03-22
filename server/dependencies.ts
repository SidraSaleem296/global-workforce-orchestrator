import { EvaluatorAgent } from "../agents/evaluatorAgent.js";
import { PlannerAgent } from "../agents/plannerAgent.js";
import { env } from "../config/env.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { ApprovalService } from "../services/approvalService.js";
import { AuditChatService } from "../services/auditChatService.js";
import { AuditSyncService } from "../services/auditSyncService.js";
import { LoggingService } from "../services/loggingService.js";
import { TaskService } from "../services/taskService.js";
import { WorkforceService } from "../services/workforceService.js";

export const buildMetaResponse = () => ({
  name: "Global Human Workforce Orchestrator",
  mode: env.notionMcpMode,
  aiProvider: env.aiProvider,
  aiModel: env.aiModel,
  confidenceThreshold: env.aiConfidenceThreshold,
  endpoints: [
    "POST /api/task/create",
    "POST /api/task/assign",
    "POST /api/task/approve",
    "POST /api/task/complete",
    "POST /api/logs/chat",
    "GET /api/dashboard",
    "GET /api/workers",
    "GET /api/workspace",
  ],
});

const notionMcpAdapter = new NotionMcpAdapter();
const loggingService = new LoggingService(notionMcpAdapter);
const auditSyncService = new AuditSyncService(notionMcpAdapter, loggingService);
const auditChatService = new AuditChatService(notionMcpAdapter, auditSyncService);
const plannerAgent = new PlannerAgent();
const evaluatorAgent = new EvaluatorAgent();
const approvalService = new ApprovalService(notionMcpAdapter, loggingService, auditSyncService);
const workforceService = new WorkforceService(
  notionMcpAdapter,
  plannerAgent,
  approvalService,
  loggingService,
  auditSyncService,
);
const taskService = new TaskService(notionMcpAdapter, loggingService, evaluatorAgent, auditSyncService);

export const services = {
  approvalService,
  auditChatService,
  auditSyncService,
  evaluatorAgent,
  loggingService,
  notionMcpAdapter,
  plannerAgent,
  taskService,
  workforceService,
} as const;
