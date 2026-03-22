import { services } from "../../server/dependencies.js";
import { readJsonBody, requireString } from "../../utils/apiRequest.js";
import { errorResponse, jsonResponse } from "../../utils/http.js";

type ApproveTaskRequest = {
  approvalId?: string;
  approved?: boolean;
  notes?: string;
  reviewer?: string;
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const body = await readJsonBody<ApproveTaskRequest>(request);

    if (typeof body.approved !== "boolean") {
      throw new Error("approved must be a boolean.");
    }

    const result = await services.approvalService.reviewApproval({
      approvalId: requireString(body.approvalId, "approvalId"),
      approved: body.approved,
      reviewer: requireString(body.reviewer, "reviewer"),
      notes: typeof body.notes === "string" ? body.notes.trim() || undefined : undefined,
    });

    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
};
