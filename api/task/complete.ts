import { services } from "../../server/dependencies.js";
import { readJsonBody, requireString } from "../../utils/apiRequest.js";
import { errorResponse, jsonResponse } from "../../utils/http.js";

type CompleteTaskRequest = {
  completionNotes?: string;
  taskId?: string;
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await readJsonBody<CompleteTaskRequest>(request);
    const result = await services.taskService.completeTask({
      taskId: requireString(body.taskId, "taskId"),
      completionNotes: requireString(body.completionNotes, "completionNotes"),
    });

    return jsonResponse({
      status: "completed",
      ...result,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
