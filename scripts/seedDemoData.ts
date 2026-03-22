import dotenv from "dotenv";

import {
  createLogPage,
  createTaskPage,
  createWorkerPage,
  listTasks,
  listWorkers,
} from "../notion/databases.js";

dotenv.config();

const demoWorkers = [
  {
    name: "Amina Khan",
    skills: ["UI Design", "Figma", "Landing Pages"],
    availability: "Available",
    timezone: "Europe/London",
    hourlyRate: 38,
    reputation: 96,
    capacity: 3,
    activeTaskCount: 1,
    notes: "Strong visual systems designer for product marketing launches.",
    slackHandle: "@amina",
  },
  {
    name: "Daniel Reyes",
    skills: ["Frontend", "React", "Next.js", "Landing Pages"],
    availability: "Limited",
    timezone: "America/New_York",
    hourlyRate: 44,
    reputation: 89,
    capacity: 2,
    activeTaskCount: 1,
    notes: "Fast frontend builder who can turn design handoff into production pages.",
    slackHandle: "@daniel",
  },
  {
    name: "Sofia Chen",
    skills: ["Copywriting", "Content Strategy", "Landing Pages"],
    availability: "Available",
    timezone: "Asia/Singapore",
    hourlyRate: 30,
    reputation: 91,
    capacity: 4,
    activeTaskCount: 0,
    notes: "Conversion-focused writer for B2B SaaS launches.",
    slackHandle: "@sofia",
  },
  {
    name: "Ibrahim Noor",
    skills: ["UI Design", "Design Systems", "QA"],
    availability: "Busy",
    timezone: "Asia/Dubai",
    hourlyRate: 34,
    reputation: 87,
    capacity: 2,
    activeTaskCount: 2,
    notes: "Reliable design systems contributor and design QA reviewer.",
    slackHandle: "@ibrahim",
  },
];

const demoTasks = [
  {
    title: "Design landing page",
    description: "Create a polished landing page for a global workforce orchestration platform with strong conversion intent and a clear enterprise trust story.",
    requiredSkill: "UI Design",
    priority: "High",
    budget: 500,
    timezonePreference: "Europe/London",
    createdBy: "Hackathon Seed",
  },
];

const main = async () => {
  const existingWorkers = await listWorkers();
  const existingTasks = await listTasks();

  const createdWorkers = [];
  const createdTasks = [];

  for (const worker of demoWorkers) {
    const alreadyExists = existingWorkers.some(
      (candidate) => candidate.name.trim().toLowerCase() === worker.name.trim().toLowerCase(),
    );

    if (alreadyExists) {
      continue;
    }

    createdWorkers.push(await createWorkerPage(worker));
  }

  for (const task of demoTasks) {
    const alreadyExists = existingTasks.some(
      (candidate) => candidate.title.trim().toLowerCase() === task.title.trim().toLowerCase(),
    );

    if (alreadyExists) {
      continue;
    }

    const createdTask = await createTaskPage(task);
    createdTasks.push(createdTask);

    await createLogPage({
      eventType: "TASK_CREATED",
      message: `Seeded demo task "${createdTask.title}".`,
      entityType: "task",
      entityId: createdTask.id,
      payload: {
        source: "seedDemoData",
      },
    });
  }

  console.log(JSON.stringify({
    createdWorkers: createdWorkers.map((worker) => ({
      id: worker.id,
      name: worker.name,
    })),
    createdTasks: createdTasks.map((task) => ({
      id: task.id,
      title: task.title,
    })),
  }, null, 2));
};

await main();
