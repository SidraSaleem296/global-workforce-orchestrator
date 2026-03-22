import { buildMetaResponse } from "../server/dependencies.js";
import { jsonResponse } from "../utils/http.js";

export const GET = async (): Promise<Response> => jsonResponse(buildMetaResponse());
