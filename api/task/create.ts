import { services } from "../../server/dependencies.js";
import { readJsonBody, requireString } from "../../utils/apiRequest.js";
import { errorResponse, jsonResponse } from "../../utils/http.js";

type CreateTaskRequest = {
  budget?: number;
  createdBy?: string;
  description?: string;
  priority?: string;
  requiredSkill?: string;
  timezonePreference?: string;
  title?: string;
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await readJsonBody<CreateTaskRequest>(request);
    const task = await services.taskService.createTask({
      title: requireString(body.title, "title"),
      description: requireString(body.description, "description"),
      requiredSkill: requireString(body.requiredSkill, "requiredSkill"),
      priority: typeof body.priority === "string" && body.priority.trim()
        ? body.priority.trim()
        : "Medium",
      budget: typeof body.budget === "number" ? body.budget : undefined,
      timezonePreference: typeof body.timezonePreference === "string"
        ? body.timezonePreference.trim() || undefined
        : undefined,
      createdBy: typeof body.createdBy === "string" ? body.createdBy.trim() || undefined : undefined,
    });

    return jsonResponse(
      {
        status: "created",
        task,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
};
