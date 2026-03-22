import { Router } from "express";

import { ApprovalService } from "../services/approvalService.js";
import { TaskService } from "../services/taskService.js";
import { WorkforceService } from "../services/workforceService.js";

const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
};

export const createTaskRoutes = (dependencies: {
  taskService: TaskService;
  workforceService: WorkforceService;
  approvalService: ApprovalService;
}) => {
  const router = Router();

  router.post("/create", async (req, res) => {
    const title = requireString(req.body.title, "title");
    const description = requireString(req.body.description, "description");
    const requiredSkill = requireString(req.body.requiredSkill, "requiredSkill");
    const priority = typeof req.body.priority === "string" && req.body.priority.trim()
      ? req.body.priority.trim()
      : "Medium";
    const budget = typeof req.body.budget === "number" ? req.body.budget : undefined;
    const timezonePreference = typeof req.body.timezonePreference === "string"
      ? req.body.timezonePreference.trim()
      : undefined;
    const createdBy = typeof req.body.createdBy === "string" ? req.body.createdBy.trim() : undefined;
    const task = await dependencies.taskService.createTask({
      title,
      description,
      requiredSkill,
      priority,
      budget,
      timezonePreference,
      createdBy,
    });

    res.status(201).json({
      status: "created",
      task,
    });
  });

  router.post("/assign", async (req, res) => {
    const taskId = requireString(req.body.taskId, "taskId");
    const assignment = await dependencies.workforceService.assignTask(taskId);

    res.json(assignment);
  });

  router.post("/approve", async (req, res) => {
    const approvalId = requireString(req.body.approvalId, "approvalId");
    const reviewer = requireString(req.body.reviewer, "reviewer");

    if (typeof req.body.approved !== "boolean") {
      throw new Error("approved must be a boolean.");
    }

    const result = await dependencies.approvalService.reviewApproval({
      approvalId,
      approved: req.body.approved,
      reviewer,
      notes: typeof req.body.notes === "string" ? req.body.notes.trim() : undefined,
    });

    res.json(result);
  });

  router.post("/complete", async (req, res) => {
    const taskId = requireString(req.body.taskId, "taskId");
    const completionNotes = requireString(req.body.completionNotes, "completionNotes");
    const result = await dependencies.taskService.completeTask({
      taskId,
      completionNotes,
    });

    res.json({
      status: "completed",
      ...result,
    });
  });

  return router;
};
