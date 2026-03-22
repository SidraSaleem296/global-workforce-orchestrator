# Global Human Workforce Orchestrator

Global Human Workforce Orchestrator is a modular Node.js + Express service that uses Notion as the control plane for coordinating human workers with AI-assisted assignment logic.

The app reads workers and tasks from Notion, chooses the best worker for a task, routes low-confidence decisions into a human approval queue, and writes every important action back to Notion for a clean hackathon demo.

## What it does

- Reads workers from the `Workers` database.
- Reads tasks from the `Tasks` database.
- Uses a planner agent to score and select the best worker.
- Creates approval requests when confidence is below `AI_CONFIDENCE_THRESHOLD` (default `0.7`).
- Assigns approved tasks back into Notion.
- Logs orchestration activity into the `Logs` database.
- Detects manual task edits in Notion and reconciles them into the audit trail on the next sync.
- Lets tasks be completed and evaluated with an evaluator agent.
- Exposes a simple API for demos and local testing.

## Architecture

```text
Notion Databases
  -> mcp/notionMcpAdapter.ts
  -> services/*
  -> agents/*
  -> routes/*
  -> Express API
```

### Modules

- `config/env.ts`: environment loading and validation.
- `notion/notionClient.ts`: shared Notion SDK client.
- `notion/databases.ts`: schema-tolerant Notion database access and mapping.
- `mcp/notionMcpAdapter.ts`: MCP-aligned adapter that exposes tool-like functions such as `getTasks`, `getWorkers`, `createTask`, `assignWorker`, `createApproval`, and `logEvent`.
- `agents/plannerAgent.ts`: worker selection and confidence scoring.
- `agents/evaluatorAgent.ts`: completion quality scoring and human-review recommendation.
- `services/*`: orchestration logic for assignments, approvals, tasks, and logging.
- `routes/*`: API endpoints.
- `server/index.ts`: Express bootstrap.

## Notion MCP note

This project follows the Notion MCP idea of treating Notion as structured context and a tool surface for agents. The official Notion MCP guide is here:

- https://developers.notion.com/guides/mcp/mcp

For this hackathon build, the runtime uses the Notion JavaScript SDK plus an MCP-shaped adapter because the provided environment is server-side and token-based. That keeps the app easy to run locally with an internal integration token while preserving the same control-plane model.

Related official docs:

- Notion authorization: https://developers.notion.com/docs/authorization
- Build your first integration: https://developers.notion.com/docs/create-a-notion-integration
- API introduction: https://developers.notion.com/reference/intro

## Project structure

```text
global-workforce-orchestrator/
  server/
    index.ts
  config/
    env.ts
  notion/
    notionClient.ts
    databases.ts
  agents/
    plannerAgent.ts
    evaluatorAgent.ts
  services/
    workforceService.ts
    taskService.ts
    approvalService.ts
    loggingService.ts
  routes/
    taskRoutes.ts
    workerRoutes.ts
  mcp/
    notionMcpAdapter.ts
  utils/
    logger.ts
  README.md
```

## Environment variables

The app expects these required values:

```env
NOTION_API_KEY=
TASKS_DB_ID=
WORKERS_DB_ID=
APPROVALS_DB_ID=
LOGS_DB_ID=
AI_PROVIDER=openrouter
AI_MODEL=qwen/qwen3-next-80b-a3b-instruct:free
```

Optional:

```env
AI_CONFIDENCE_THRESHOLD=0.7
PORT=3000
ALLOW_INSECURE_TLS=false
LLM_API_KEY=
LLM_BASE_URL=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=Global Human Workforce Orchestrator
NOTION_MCP_MODE=sdk
```

If no provider API key is configured, the agents still work using deterministic scoring and evaluation heuristics.

If you see `fetch failed: unable to get local issuer certificate`, your machine or network is intercepting HTTPS traffic with a certificate Node does not trust. For a quick local hackathon demo, you can temporarily set:

```env
ALLOW_INSECURE_TLS=true
```

This disables HTTPS certificate verification for the Node process. Only use it for local development or demos.

If the env flag alone still does not help, launch with the dedicated insecure bootstrap so TLS is disabled before the app imports any SDKs:

```bash
npm run dev:insecure
```

## Groq and OpenRouter setups

The project now supports `groq`, `openrouter`, `openai`, `compatible`, `local`, and `heuristic` through the shared LLM client.

### Recommended zero-cost option: OpenRouter

As of March 16, 2026, OpenRouter documents two easy free paths:

- `openrouter/free` for automatic routing across currently available free models.
- Any specific free variant using the `:free` suffix, such as `meta-llama/llama-3.2-3b-instruct:free`.

Example:

```env
AI_PROVIDER=openrouter
AI_MODEL=qwen/qwen3-next-80b-a3b-instruct:free
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=Global Human Workforce Orchestrator
```

If your requirement is specifically "free and more than 70B", this is the best default for this project. OpenRouter currently lists `qwen/qwen3-next-80b-a3b-instruct:free` as a free 80B model with a 262,144-token context window, and its positioning is a strong fit for structured planning and evaluation tasks.

Other current free options above or at 70B on OpenRouter include:

- `openai/gpt-oss-120b:free`
- `meta-llama/llama-3.3-70b-instruct:free`

### Fastest simple option: Groq

Groq works with the same chat-completions shape and uses the OpenAI-compatible base URL `https://api.groq.com/openai/v1`.

Example:

```env
AI_PROVIDER=groq
AI_MODEL=llama-3.1-8b-instant
GROQ_API_KEY=your_groq_key
```

Note: as of March 16, 2026, Groq’s official pricing and models pages still list token pricing for models like `llama-3.1-8b-instant`, so Groq is great for low cost and speed, but OpenRouter is the cleaner choice for truly free inference.

## Recommended Notion database schemas

The code is tolerant of a few property-name variants, but the easiest setup is to use the following schemas.

## Getting The Correct Notion IDs

Each of these env vars must be the ID of an actual Notion database:

- `TASKS_DB_ID`
- `WORKERS_DB_ID`
- `APPROVALS_DB_ID`
- `LOGS_DB_ID`

Do not use:

- the parent page ID that contains an inline database
- the ID of a task row/page inside the database
- a linked database view

Use the source database itself. The safest workflow is:

1. Open the database itself in Notion.
2. Make sure it is the original database, not a linked view.
3. Copy the database link.
4. Use the 32-character ID from that database URL in `.env`.

If the app says an env var "points to a page, not a database", that specific ID needs to be replaced.

The app now also tries to resolve a parent page automatically if that page contains exactly the inline database or linked database block you intended, but using the real source database ID is still the safest option.

### Tasks database

| Property | Type | Example |
| --- | --- | --- |
| `Task` | Title | `Design landing page` |
| `Description` | Rich text | `Create a high-converting landing page for a fintech product.` |
| `Required Skill` | Select or rich text | `UI Design` |
| `Priority` | Select or status | `High` |
| `Status` | Status or select | `Open`, `Pending Approval`, `Assigned`, `Completed` |
| `Assigned Worker` | Relation to Workers or rich text | worker page |
| `Assigned Worker Name` | Rich text | `Amina Khan` |
| `AI Confidence` | Number | `0.82` |
| `Selection Reason` | Rich text | planner output |
| `Human Approval Needed` | Checkbox | `true` |
| `Approval Status` | Select or status | `Not Required`, `Pending`, `Approved`, `Rejected` |
| `Budget` | Number | `500` |
| `Timezone Preference` | Rich text or select | `UTC+1` |
| `Completion Notes` | Rich text | delivery summary |
| `Completed At` | Date | timestamp |
| `Quality Score` | Number | `88` |
| `Human Review Needed` | Checkbox | `false` |

### Workers database

| Property | Type | Example |
| --- | --- | --- |
| `Worker` | Title | `Amina Khan` |
| `Skills` | Multi-select | `UI Design`, `Figma`, `Brand Systems` |
| `Availability` | Select or status | `Available` |
| `Timezone` | Rich text or select | `Asia/Karachi` or `UTC+5` |
| `Hourly Rate` | Number | `35` |
| `Reputation` | Number | `92` |
| `Capacity` | Number | `3` |
| `Active Task Count` | Number | `1` |
| `Slack Handle` | Rich text | `@amina` |
| `Notes` | Rich text | portfolio summary |

### Approvals database

| Property | Type | Example |
| --- | --- | --- |
| `Approval` | Title | `Approval for Design landing page` |
| `Task` | Relation to Tasks or rich text | task page |
| `Task Title` | Rich text | `Design landing page` |
| `Worker` | Relation to Workers or rich text | worker page |
| `Worker Name` | Rich text | `Amina Khan` |
| `Status` | Select or status | `Pending`, `Approved`, `Rejected` |
| `Confidence` | Number | `0.61` |
| `Reason` | Rich text | planner rationale |
| `Reviewer` | Rich text | `Product Lead` |
| `Notes` | Rich text | human decision notes |
| `Requested At` | Date | timestamp |
| `Resolved At` | Date | timestamp |

### Logs database

| Property | Type | Example |
| --- | --- | --- |
| `Log` | Title | `TASK_ASSIGNED 2026-03-16T18:00:00.000Z` |
| `Event Type` | Select or rich text | `TASK_ASSIGNED` |
| `Message` | Rich text | event summary |
| `Severity` | Select or status | `INFO`, `WARN`, `ERROR` |
| `Entity Type` | Rich text or select | `task` |
| `Entity ID` | Rich text | Notion page id |
| `Payload` | Rich text | JSON metadata |
| `Timestamp` | Date | timestamp |

## API endpoints

### `POST /task/create`

Creates a new Notion task.

```json
{
  "title": "Design landing page",
  "description": "Create a responsive landing page for a global payroll startup.",
  "requiredSkill": "UI Design",
  "priority": "High",
  "budget": 500,
  "timezonePreference": "UTC+1"
}
```

### `POST /task/assign`

Runs the planner agent and either assigns the task or creates an approval request.

```json
{
  "taskId": "notion-task-page-id"
}
```

### `POST /task/approve`

Human approval workflow.

```json
{
  "approvalId": "notion-approval-page-id",
  "approved": true,
  "reviewer": "Product Lead",
  "notes": "Looks good. Proceed."
}
```

### `POST /task/complete`

Marks a task complete and triggers evaluator scoring.

```json
{
  "taskId": "notion-task-page-id",
  "completionNotes": "Shared the Figma file, exported final assets, and completed developer handoff."
}
```

### `POST /logs/chat`

Asks the audit assistant to explain recent log activity, manual Notion edits, approvals, and task history.

```json
{
  "message": "What changed in Notion for Akss AI today?",
  "history": [
    {
      "role": "user",
      "content": "Summarize manual edits."
    },
    {
      "role": "assistant",
      "content": "Recent changes made directly in Notion..."
    }
  ]
}
```

### `GET /dashboard`

Returns task, worker, and approval statistics for the demo.

## Demo flow

1. Create a task in Notion or with `POST /task/create`.
2. Call `POST /task/assign`.
3. Watch the planner choose a worker.
4. If confidence is below threshold, review the new row in the Approvals database.
5. Approve with `POST /task/approve`.
6. See the task updated in Notion and the Logs database fill with events.
7. Complete the task with `POST /task/complete` and show the evaluation score.

## Run locally

1. Install dependencies.

```bash
npm install
```

2. Start the dev server.

```bash
npm run dev
```

If Notion calls fail with `unable to get local issuer certificate`, use:

```bash
npm run dev:insecure
```

To populate the demo with sample workers and a sample task:

```bash
npm run seed:notion:insecure
```

3. Open the glass dashboard UI:

```text
http://localhost:3000/
```

Useful JSON endpoints:

```text
http://localhost:3000/health
http://localhost:3000/api
http://localhost:3000/api/workspace
http://localhost:3000/api/dashboard
```

## UI and Notion experience

The browser UI is a local orchestration cockpit for demos. It lets you:

- create tasks
- trigger AI assignment
- approve or reject low-confidence recommendations
- complete tasks and trigger evaluation
- watch logs refresh live
- ask the audit assistant what changed in Notion and why

Manual edits made directly in Notion are also detected during the next workspace or dashboard sync. Those changes create visible `TASK_UPDATED_MANUALLY` log entries, while internal snapshot records stay hidden from the UI feed.

Notion remains the actual source of truth. Every action in the UI writes back into your Notion databases, so judges can see the same flow in two places:

- the local glass dashboard at `http://localhost:3000/`
- your live Notion workspace in `Tasks`, `Workers`, `Approvals`, and `Logs`

## Example curl commands

```bash
curl -X POST http://localhost:3000/task/create \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Design landing page",
    "description": "Create a high-converting landing page for a global payroll startup.",
    "requiredSkill": "UI Design",
    "priority": "High"
  }'
```

```bash
curl -X POST http://localhost:3000/task/assign \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "replace-with-task-page-id"
  }'
```

## Optional upgrades

- Slack notifications using the `Slack Handle` field.
- Worker reputation updates after evaluation.
- Cost-aware routing based on budget pressure.
- Deeper timezone balancing rules for follow-the-sun staffing.
