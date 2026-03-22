import { services } from "../server/dependencies.js";
import { errorResponse, jsonResponse } from "../utils/http.js";

export const GET = async (): Promise<Response> => {
  try {
    const workers = await services.workforceService.listWorkers();
    return jsonResponse({
      workers,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
