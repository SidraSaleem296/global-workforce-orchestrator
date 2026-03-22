import { EvaluatorAgent } from "../agents/evaluatorAgent.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";
import { AuditSyncService } from "./auditSyncService.js";
import { LoggingService } from "./loggingService.js";

export class TaskService {
  constructor(
    private readonly notionMcpAdapter: NotionMcpAdapter,
    private readonly loggingService: LoggingService,
    private readonly evaluatorAgent: EvaluatorAgent,
    private readonly auditSyncService: AuditSyncService,
  ) {}

  async createTask(input: {
    title: string;
    description: string;
    requiredSkill: string;
    priority: string;
    budget?: number;
    timezonePreference?: string;
    createdBy?: string;
  }) {
    const task = await this.notionMcpAdapter.createTask(input);

    await this.loggingService.logEvent("TASK_CREATED", {
      message: `Task "${task.title}" created in Notion.`,
      entityType: "task",
      entityId: task.id,
      payload: {
        task,
      },
    });
    await this.auditSyncService.recordTaskSnapshot(task, "app:create-task");

    return task;
  }

  async completeTask(input: { taskId: string; completionNotes: string }) {
    await this.auditSyncService.reconcileTaskChanges();

    const existingTask = await this.notionMcpAdapter.getTaskById(input.taskId);

    if (existingTask.status.toLowerCase() === "completed") {
      throw new Error(`Task "${existingTask.title}" is already marked as completed.`);
    }

    const completedTask = await this.notionMcpAdapter.completeTask(existingTask.id, {
      completionNotes: input.completionNotes,
    });

    await this.loggingService.logEvent("TASK_COMPLETED", {
      message: `Task "${completedTask.title}" marked as completed.`,
      entityType: "task",
      entityId: completedTask.id,
      payload: {
        taskId: completedTask.id,
        completionNotes: input.completionNotes,
      },
    });
    await this.auditSyncService.recordTaskSnapshot(completedTask, "app:complete-task");

    const evaluation = await this.evaluatorAgent.evaluateTaskCompletion(completedTask, input.completionNotes);
    const evaluatedTask = await this.notionMcpAdapter.saveTaskEvaluation(completedTask.id, {
      qualityScore: evaluation.qualityScore,
      humanReviewNeeded: evaluation.needsHumanReview,
    });

    await this.loggingService.logEvent("TASK_EVALUATED", {
      message: `Task "${evaluatedTask.title}" evaluated with score ${evaluation.qualityScore}.`,
      entityType: "task",
      entityId: evaluatedTask.id,
      payload: {
        taskId: evaluatedTask.id,
        qualityScore: evaluation.qualityScore,
        needsHumanReview: evaluation.needsHumanReview,
        reasoning: evaluation.reasoning,
      },
    });
    await this.auditSyncService.recordTaskSnapshot(evaluatedTask, "app:evaluate-task");

    return {
      task: evaluatedTask,
      evaluation,
    };
  }
}
