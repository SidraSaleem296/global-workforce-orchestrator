type LogLevel = "info" | "warn" | "error";

const write = (level: LogLevel, message: string, metadata?: Record<string, unknown>): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata,
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
};

export const logger = {
  info: (message: string, metadata?: Record<string, unknown>): void => write("info", message, metadata),
  warn: (message: string, metadata?: Record<string, unknown>): void => write("warn", message, metadata),
  error: (message: string, metadata?: Record<string, unknown>): void => write("error", message, metadata),
};
