import { services } from "../server/dependencies.js";
import { errorResponse, jsonResponse } from "../utils/http.js";

export const GET = async (): Promise<Response> => {
  try {
    const dashboard = await services.workforceService.getDashboard();
    return jsonResponse(dashboard);
  } catch (error) {
    return errorResponse(error);
  }
};
