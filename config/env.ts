import dotenv from "dotenv";

dotenv.config();

const toBoolean = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const allowInsecureTls = toBoolean(process.env.ALLOW_INSECURE_TLS);

if (allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const getRequired = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const getNumber = (name: string, fallback: number): number => {
  const rawValue = process.env[name];

  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return parsedValue;
};

export const env = {
  port: getNumber("PORT", 3000),
  allowInsecureTls,
  notionApiKey: getRequired("NOTION_API_KEY"),
  tasksDbId: getRequired("TASKS_DB_ID"),
  workersDbId: getRequired("WORKERS_DB_ID"),
  approvalsDbId: getRequired("APPROVALS_DB_ID"),
  logsDbId: getRequired("LOGS_DB_ID"),
  aiProvider: process.env.AI_PROVIDER?.trim() || "heuristic",
  aiModel: process.env.AI_MODEL?.trim() || "weighted-orchestrator-v1",
  aiConfidenceThreshold: getNumber("AI_CONFIDENCE_THRESHOLD", 0.7),
  llmApiKey: process.env.LLM_API_KEY?.trim(),
  llmBaseUrl: process.env.LLM_BASE_URL?.trim(),
  openAiApiKey: process.env.OPENAI_API_KEY?.trim(),
  openAiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
  groqApiKey: process.env.GROQ_API_KEY?.trim(),
  groqBaseUrl: process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
  openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim(),
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
  openRouterSiteUrl: process.env.OPENROUTER_SITE_URL?.trim(),
  openRouterAppName: process.env.OPENROUTER_APP_NAME?.trim() || "Global Human Workforce Orchestrator",
  notionMcpMode: process.env.NOTION_MCP_MODE?.trim() || "sdk",
} as const;

if (env.aiConfidenceThreshold < 0 || env.aiConfidenceThreshold > 1) {
  throw new Error("AI_CONFIDENCE_THRESHOLD must be between 0 and 1.");
}
