import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";

import { EvaluatorAgent } from "../agents/evaluatorAgent.js";
import { PlannerAgent } from "../agents/plannerAgent.js";
import { env } from "../config/env.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { createTaskRoutes } from "../routes/taskRoutes.js";
import { createWorkerRoutes } from "../routes/workerRoutes.js";
import { ApprovalService } from "../services/approvalService.js";
import { AuditChatService } from "../services/auditChatService.js";
import { AuditSyncService } from "../services/auditSyncService.js";
import { LoggingService } from "../services/loggingService.js";
import { TaskService } from "../services/taskService.js";
import { WorkforceService } from "../services/workforceService.js";
import { logger } from "../utils/logger.js";

const app = express();
const publicDir = resolve(process.cwd(), "public");

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    const causalMessage = (() => {
      const cause = (error as Error & { cause?: unknown }).cause;

      if (cause instanceof Error) {
        return cause.message;
      }

      if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
        return cause.message;
      }

      return "";
    })();

    if (error.message === "fetch failed" && causalMessage) {
      return `fetch failed: ${causalMessage}`;
    }

    return error.message;
  }

  return "Unexpected server error.";
};

app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
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

app.get("/api", (_req, res) => {
  res.json({
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
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use(
  "/api/task",
  createTaskRoutes({
    taskService,
    workforceService,
    approvalService,
  }),
);

app.use(
  "/task",
  createTaskRoutes({
    taskService,
    workforceService,
    approvalService,
  }),
);

app.use(
  "/api",
  createWorkerRoutes({
    workforceService,
    auditChatService,
  }),
);

app.use(
  "/",
  createWorkerRoutes({
    workforceService,
    auditChatService,
  }),
);

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(resolve(publicDir, "index.html"));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = extractErrorMessage(error);
  logger.error("Request failed", {
    message,
  });

  res.status(400).json({
    error: message,
  });
});

app.listen(env.port, () => {
  if (env.allowInsecureTls) {
    logger.warn("ALLOW_INSECURE_TLS is enabled. HTTPS certificate verification is disabled for this process.", {
      allowInsecureTls: true,
    });
  }

  logger.info("Global Human Workforce Orchestrator is running", {
    port: env.port,
    aiProvider: env.aiProvider,
    aiModel: env.aiModel,
    notionMcpMode: env.notionMcpMode,
  });
});
