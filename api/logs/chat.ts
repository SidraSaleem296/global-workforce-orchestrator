import { services } from "../../server/dependencies.js";
import { readJsonBody, requireString } from "../../utils/apiRequest.js";
import { errorResponse, jsonResponse } from "../../utils/http.js";

type AuditChatRequest = {
  history?: Array<{ role?: string; content?: string }>;
  message?: string;
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await readJsonBody<AuditChatRequest>(request);
    const result = await services.auditChatService.answerQuestion({
      message: requireString(body.message, "message"),
      history: Array.isArray(body.history)
        ? body.history
          .filter((entry) =>
            entry
            && (entry.role === "user" || entry.role === "assistant")
            && typeof entry.content === "string",
          )
          .map((entry) => ({
            role: entry.role as "user" | "assistant",
            content: entry.content ?? "",
          }))
        : undefined,
    });

    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
};
