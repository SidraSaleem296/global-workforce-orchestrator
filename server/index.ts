import { env } from "../config/env.js";
import app from "./app.js";
import { logger } from "../utils/logger.js";

app.listen(env.port, () => {
  if (env.allowInsecureTls) {
    logger.warn("ALLOW_INSECURE_TLS is enabled. HTTPS certificate verification is disabled for this process.", {
      allowInsecureTls: true,
    });
  }

  logger.info("Global Human Workforce Orchestrator is running", {
    port: env.port,
    aiProvider: env.aiProvider,
    aiModel: env.aiModel,
    notionMcpMode: env.notionMcpMode,
  });
});
