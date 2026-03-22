import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type ProviderName = "heuristic" | "openai" | "groq" | "openrouter" | "compatible" | "local";

interface ProviderConfig {
  provider: ProviderName;
  endpoint: string;
  apiKey: string;
  headers?: Record<string, string>;
}

const normalizeProvider = (value: string): ProviderName => {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "groq") {
    return "groq";
  }

  if (normalizedValue === "openrouter") {
    return "openrouter";
  }

  if (normalizedValue === "openai") {
    return "openai";
  }

  if (normalizedValue === "compatible") {
    return "compatible";
  }

  if (normalizedValue === "local") {
    return "local";
  }

  return "heuristic";
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const resolveProviderConfig = (): ProviderConfig | null => {
  const provider = normalizeProvider(env.aiProvider);

  if (provider === "heuristic") {
    return null;
  }

  if (provider === "groq") {
    const apiKey = env.groqApiKey || env.llmApiKey;

    if (!apiKey) {
      return null;
    }

    return {
      provider,
      endpoint: `${stripTrailingSlash(env.groqBaseUrl || env.llmBaseUrl || "https://api.groq.com/openai/v1")}/chat/completions`,
      apiKey,
    };
  }

  if (provider === "openrouter") {
    const apiKey = env.openRouterApiKey || env.llmApiKey;

    if (!apiKey) {
      return null;
    }

    const headers: Record<string, string> = {};

    if (env.openRouterSiteUrl) {
      headers["HTTP-Referer"] = env.openRouterSiteUrl;
    }

    if (env.openRouterAppName) {
      headers["X-OpenRouter-Title"] = env.openRouterAppName;
      headers["X-Title"] = env.openRouterAppName;
    }

    return {
      provider,
      endpoint: `${stripTrailingSlash(env.openRouterBaseUrl || env.llmBaseUrl || "https://openrouter.ai/api/v1")}/chat/completions`,
      apiKey,
      headers,
    };
  }

  const apiKey = env.openAiApiKey || env.llmApiKey;

  if (!apiKey) {
    return null;
  }

  return {
    provider,
    endpoint: `${stripTrailingSlash(env.openAiBaseUrl || env.llmBaseUrl || "https://api.openai.com/v1")}/chat/completions`,
    apiKey,
  };
};

export const isLlmNarrationEnabled = (): boolean => resolveProviderConfig() !== null;

export const generateChatNarrative = async (input: {
  messages: ChatMessage[];
  temperature?: number;
  warningLabel: string;
}): Promise<string | null> => {
  const providerConfig = resolveProviderConfig();

  if (!providerConfig) {
    return null;
  }

  try {
    const response = await fetch(providerConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
        ...providerConfig.headers,
      },
      body: JSON.stringify({
        model: env.aiModel,
        temperature: input.temperature ?? 0.2,
        messages: input.messages,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.warn(input.warningLabel, {
        provider: providerConfig.provider,
        status: response.status,
        response: responseText.slice(0, 400),
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    logger.warn(input.warningLabel, {
      provider: providerConfig.provider,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
};
