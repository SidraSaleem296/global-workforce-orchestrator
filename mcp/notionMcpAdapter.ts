import {
  type ApprovalDecisionInput,
  type ApprovalRecord,
  type AssignWorkerInput,
  type CreateApprovalInput,
  type CreateLogInput,
  type CreateTaskInput,
  type DashboardStats,
  type LogRecord,
  type TaskApprovalStateInput,
  type TaskCompletionInput,
  type TaskEvaluationInput,
  type TaskRecord,
  type WorkerRecord,
  buildDashboardStats,
  createApprovalPage,
  createLogPage,
  createTaskPage,
  findApprovalById,
  findTaskById,
  findWorkerById,
  listApprovals,
  listTasks,
  listWorkers,
  listLogs,
  updateApprovalDecision,
  updateTaskApprovalState,
  updateTaskAssignment,
  updateTaskCompletion,
  updateTaskEvaluation,
} from "../notion/databases.js";

export interface StructuredContextResource<T> {
  name: string;
  databaseRole: "tasks" | "workers" | "approvals";
  recordCount: number;
  records: T[];
}

export interface StructuredContextBundle {
  generatedAt: string;
  resources: [
    StructuredContextResource<TaskRecord>,
    StructuredContextResource<WorkerRecord>,
    StructuredContextResource<ApprovalRecord>,
  ];
  tools: string[];
}

export class NotionMcpAdapter {
  async getStructuredContext(): Promise<StructuredContextBundle> {
    const [tasks, workers, approvals] = await Promise.all([this.getTasks(), this.getWorkers(), this.getApprovals()]);

    return {
      generatedAt: new Date().toISOString(),
      resources: [
        {
          name: "tasks",
          databaseRole: "tasks",
          recordCount: tasks.length,
          records: tasks,
        },
        {
          name: "workers",
          databaseRole: "workers",
          recordCount: workers.length,
          records: workers,
        },
        {
          name: "approvals",
          databaseRole: "approvals",
          recordCount: approvals.length,
          records: approvals,
        },
      ],
      tools: ["getTasks", "getWorkers", "createTask", "assignWorker", "createApproval", "logEvent"],
    };
  }

  async getTasks(): Promise<TaskRecord[]> {
    return listTasks();
  }

  async getWorkers(): Promise<WorkerRecord[]> {
    return listWorkers();
  }

  async getApprovals(): Promise<ApprovalRecord[]> {
    return listApprovals();
  }

  async getLogs(): Promise<LogRecord[]> {
    return listLogs();
  }

  async getTaskById(taskId: string): Promise<TaskRecord> {
    return findTaskById(taskId);
  }

  async getWorkerById(workerId: string): Promise<WorkerRecord> {
    return findWorkerById(workerId);
  }

  async getApprovalById(approvalId: string): Promise<ApprovalRecord> {
    return findApprovalById(approvalId);
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    return createTaskPage(input);
  }

  async assignWorker(taskId: string, input: AssignWorkerInput): Promise<TaskRecord> {
    return updateTaskAssignment(taskId, input);
  }

  async updateTaskApprovalState(taskId: string, input: TaskApprovalStateInput): Promise<TaskRecord> {
    return updateTaskApprovalState(taskId, input);
  }

  async completeTask(taskId: string, input: TaskCompletionInput): Promise<TaskRecord> {
    return updateTaskCompletion(taskId, input);
  }

  async saveTaskEvaluation(taskId: string, input: TaskEvaluationInput): Promise<TaskRecord> {
    return updateTaskEvaluation(taskId, input);
  }

  async createApproval(input: CreateApprovalInput): Promise<ApprovalRecord> {
    return createApprovalPage(input);
  }

  async resolveApproval(approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalRecord> {
    return updateApprovalDecision(approvalId, input);
  }

  async logEvent(input: CreateLogInput) {
    return createLogPage(input);
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const [tasks, workers, approvals] = await Promise.all([this.getTasks(), this.getWorkers(), this.getApprovals()]);
    return buildDashboardStats(tasks, workers, approvals);
  }
}
