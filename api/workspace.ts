import { services } from "../server/dependencies.js";
import { errorResponse, jsonResponse } from "../utils/http.js";

export const GET = async (): Promise<Response> => {
  try {
    const workspace = await services.workforceService.getWorkspaceSnapshot();
    return jsonResponse(workspace);
  } catch (error) {
    return errorResponse(error);
  }
};
