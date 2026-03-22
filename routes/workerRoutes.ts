import { Router } from "express";

import { AuditChatService } from "../services/auditChatService.js";
import { WorkforceService } from "../services/workforceService.js";

export const createWorkerRoutes = (dependencies: {
  workforceService: WorkforceService;
  auditChatService: AuditChatService;
}) => {
  const router = Router();

  router.get("/workers", async (_req, res) => {
    const workers = await dependencies.workforceService.listWorkers();

    res.json({
      workers,
    });
  });

  router.get("/dashboard", async (_req, res) => {
    const dashboard = await dependencies.workforceService.getDashboard();

    res.json(dashboard);
  });

  router.get("/tasks", async (_req, res) => {
    const tasks = await dependencies.workforceService.listTasks();

    res.json({
      tasks,
    });
  });

  router.get("/approvals", async (_req, res) => {
    const approvals = await dependencies.workforceService.listApprovals();

    res.json({
      approvals,
    });
  });

  router.get("/logs", async (_req, res) => {
    const logs = await dependencies.workforceService.listLogs();

    res.json({
      logs,
    });
  });

  router.post("/logs/chat", async (req, res) => {
    if (typeof req.body.message !== "string" || req.body.message.trim() === "") {
      throw new Error("message is required.");
    }

    const result = await dependencies.auditChatService.answerQuestion({
      message: req.body.message,
      history: Array.isArray(req.body.history) ? req.body.history : undefined,
    });

    res.json(result);
  });

  router.get("/workspace", async (_req, res) => {
    const workspace = await dependencies.workforceService.getWorkspaceSnapshot();

    res.json(workspace);
  });

  return router;
};
