import { services } from "../../server/dependencies.js";
import { readJsonBody, requireString } from "../../utils/apiRequest.js";
import { errorResponse, jsonResponse } from "../../utils/http.js";

type AssignTaskRequest = {
  taskId?: string;
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await readJsonBody<AssignTaskRequest>(request);
    const assignment = await services.workforceService.assignTask(requireString(body.taskId, "taskId"));
    return jsonResponse(assignment);
  } catch (error) {
    return errorResponse(error);
  }
};
