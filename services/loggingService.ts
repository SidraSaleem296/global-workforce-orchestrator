import { type LogEventType } from "../notion/databases.js";
import { NotionMcpAdapter } from "../mcp/notionMcpAdapter.js";

const defaultSeverityFor = (eventType: LogEventType): string => {
  if (eventType === "APPROVAL_REQUESTED" || eventType === "TASK_UPDATED_MANUALLY") {
    return "WARN";
  }

  return "INFO";
};

export class LoggingService {
  constructor(private readonly notionMcpAdapter: NotionMcpAdapter) {}

  async logEvent(
    eventType: LogEventType,
    input: {
      message: string;
      severity?: string;
      entityType?: string;
      entityId?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    return this.notionMcpAdapter.logEvent({
      eventType,
      message: input.message,
      severity: input.severity ?? defaultSeverityFor(eventType),
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
    });
  }
}
