import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();

const notionApiKey = process.env.NOTION_API_KEY?.trim();

if (!notionApiKey) {
  throw new Error("NOTION_API_KEY is required to bootstrap Notion databases.");
}

const notion = new Client({
  auth: notionApiKey,
});

type DatabaseSpec = {
  envName: "TASKS_DB_ID" | "WORKERS_DB_ID" | "APPROVALS_DB_ID" | "LOGS_DB_ID";
  title: string;
  properties: Record<string, unknown>;
};

type SearchableBlock = {
  id: string;
  type: string;
  link_to_page?: {
    type?: string;
    database_id?: string;
  };
};

const toTitle = (content: string) => [
  {
    type: "text",
    text: {
      content,
    },
  },
];

const normalizeRef = (value: string): string => {
  const trimmedValue = value.trim();
  const hyphenated = trimmedValue.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  if (hyphenated) {
    return hyphenated[0];
  }

  const compact = trimmedValue.match(/[0-9a-f]{32}/i);

  if (!compact) {
    return trimmedValue;
  }

  const value32 = compact[0].toLowerCase();
  return `${value32.slice(0, 8)}-${value32.slice(8, 12)}-${value32.slice(12, 16)}-${value32.slice(16, 20)}-${value32.slice(20)}`;
};

const databaseSpecs: DatabaseSpec[] = [
  {
    envName: "TASKS_DB_ID",
    title: "Tasks",
    properties: {
      Task: { title: {} },
      Description: { rich_text: {} },
      "Required Skill": { rich_text: {} },
      Priority: {
        select: {
          options: [{ name: "High" }, { name: "Medium" }, { name: "Low" }],
        },
      },
      Status: {
        select: {
          options: [
            { name: "Open" },
            { name: "Pending Approval" },
            { name: "Assigned" },
            { name: "Completed" },
          ],
        },
      },
      "Assigned Worker": { rich_text: {} },
      "Assigned Worker Name": { rich_text: {} },
      "AI Confidence": { number: { format: "number" } },
      "Selection Reason": { rich_text: {} },
      "Human Approval Needed": { checkbox: {} },
      "Approval Status": {
        select: {
          options: [
            { name: "Not Required" },
            { name: "Pending" },
            { name: "Approved" },
            { name: "Rejected" },
          ],
        },
      },
      Budget: { number: { format: "dollar" } },
      "Timezone Preference": { rich_text: {} },
      "Completion Notes": { rich_text: {} },
      "Completed At": { date: {} },
      "Quality Score": { number: { format: "number" } },
      "Human Review Needed": { checkbox: {} },
      "Created By": { rich_text: {} },
    },
  },
  {
    envName: "WORKERS_DB_ID",
    title: "Workers",
    properties: {
      Worker: { title: {} },
      Skills: { multi_select: { options: [] } },
      Availability: {
        select: {
          options: [{ name: "Available" }, { name: "Limited" }, { name: "Busy" }, { name: "Offline" }],
        },
      },
      Timezone: { rich_text: {} },
      "Hourly Rate": { number: { format: "dollar" } },
      Reputation: { number: { format: "number" } },
      Capacity: { number: { format: "number" } },
      "Active Task Count": { number: { format: "number" } },
      Slack: { rich_text: {} },
      Notes: { rich_text: {} },
    },
  },
  {
    envName: "APPROVALS_DB_ID",
    title: "Approvals",
    properties: {
      Approval: { title: {} },
      Task: { rich_text: {} },
      "Task Title": { rich_text: {} },
      Worker: { rich_text: {} },
      "Worker Name": { rich_text: {} },
      Status: {
        select: {
          options: [{ name: "Pending" }, { name: "Approved" }, { name: "Rejected" }],
        },
      },
      Confidence: { number: { format: "number" } },
      Reason: { rich_text: {} },
      Reviewer: { rich_text: {} },
      Notes: { rich_text: {} },
      "Requested At": { date: {} },
      "Resolved At": { date: {} },
    },
  },
  {
    envName: "LOGS_DB_ID",
    title: "Logs",
    properties: {
      Log: { title: {} },
      "Event Type": { rich_text: {} },
      Message: { rich_text: {} },
      Severity: {
        select: {
          options: [{ name: "INFO" }, { name: "WARN" }, { name: "ERROR" }],
        },
      },
      "Entity Type": { rich_text: {} },
      "Entity ID": { rich_text: {} },
      Payload: { rich_text: {} },
      Timestamp: { date: {} },
    },
  },
];

const ensureDatabase = async (spec: DatabaseSpec) => {
  const rawReference = process.env[spec.envName]?.trim();

  if (!rawReference) {
    throw new Error(`${spec.envName} is missing from .env.`);
  }

  const reference = normalizeRef(rawReference);

  try {
    const existingDatabase = await notion.databases.retrieve({
      database_id: reference,
    });

    console.log(`${spec.envName}: already a database -> ${existingDatabase.id}`);
    return {
      envName: spec.envName,
      databaseId: existingDatabase.id,
      url: (existingDatabase as { url?: string }).url,
      mode: "existing-database",
    };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("is a page, not a database")) {
      throw error;
    }
  }

  const existingChildren = await notion.blocks.children.list({
    block_id: reference,
    page_size: 100,
  });
  const childBlocks = existingChildren.results as unknown as SearchableBlock[];

  const childDatabase = childBlocks.find((block) => block.type === "child_database");

  if (childDatabase && "id" in childDatabase && typeof childDatabase.id === "string") {
    const database = await notion.databases.retrieve({
      database_id: childDatabase.id,
    });

    console.log(`${spec.envName}: found inline database -> ${database.id}`);
    return {
      envName: spec.envName,
      databaseId: database.id,
      url: (database as { url?: string }).url,
      mode: "existing-inline-database",
    };
  }

  const linkedDatabase = childBlocks.find(
    (block) => block.type === "link_to_page" && block.link_to_page?.type === "database_id",
  );

  if (linkedDatabase?.link_to_page?.type === "database_id" && linkedDatabase.link_to_page.database_id) {
    const database = await notion.databases.retrieve({
      database_id: linkedDatabase.link_to_page.database_id,
    });

    console.log(`${spec.envName}: found linked database -> ${database.id}`);
    return {
      envName: spec.envName,
      databaseId: database.id,
      url: (database as { url?: string }).url,
      mode: "existing-linked-database",
    };
  }

  const createdDatabase = await notion.databases.create({
    parent: {
      type: "page_id",
      page_id: reference,
    },
    title: toTitle(spec.title) as never,
    initial_data_source: {
      properties: spec.properties as never,
    },
  });

  console.log(`${spec.envName}: created database -> ${createdDatabase.id}`);
  return {
    envName: spec.envName,
    databaseId: createdDatabase.id,
    url: (createdDatabase as { url?: string }).url,
    mode: "created",
  };
};

const main = async () => {
  const results = [];

  for (const spec of databaseSpecs) {
    results.push(await ensureDatabase(spec));
  }

  console.log("\nNotion bootstrap complete.\n");

  for (const result of results) {
    console.log(`${result.envName}=${result.databaseId}`);
    console.log(`mode=${result.mode}`);
    console.log(`url=${result.url}\n`);
  }
};

await main();
