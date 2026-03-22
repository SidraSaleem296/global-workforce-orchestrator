import { Client } from "@notionhq/client";

import { env } from "../config/env.js";

export const notionClient = new Client({
  auth: env.notionApiKey,
});
