import express, { type NextFunction, type Request, type Response } from "express";
import { resolve } from "node:path";

import { createTaskRoutes } from "../routes/taskRoutes.js";
import { createWorkerRoutes } from "../routes/workerRoutes.js";
import { buildMetaResponse, services } from "./dependencies.js";
import { extractErrorMessage } from "../utils/http.js";
import { logger } from "../utils/logger.js";

const app = express();
const publicDir = resolve(process.cwd(), "public");

app.use(express.json());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.get("/api", (_req, res) => {
  res.json(buildMetaResponse());
});

app.get("/api/meta", (_req, res) => {
  res.json(buildMetaResponse());
});

app.get("/meta", (_req, res) => {
  res.json(buildMetaResponse());
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
    taskService: services.taskService,
    workforceService: services.workforceService,
    approvalService: services.approvalService,
  }),
);

app.use(
  "/task",
  createTaskRoutes({
    taskService: services.taskService,
    workforceService: services.workforceService,
    approvalService: services.approvalService,
  }),
);

app.use(
  "/api",
  createWorkerRoutes({
    workforceService: services.workforceService,
    auditChatService: services.auditChatService,
  }),
);

app.use(
  "/",
  createWorkerRoutes({
    workforceService: services.workforceService,
    auditChatService: services.auditChatService,
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

export default app;
