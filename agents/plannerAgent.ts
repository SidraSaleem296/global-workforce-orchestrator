import { env } from "../config/env.js";
import { type TaskRecord, type WorkerRecord, resolveTimezoneOffset } from "../notion/databases.js";
import { generateChatNarrative } from "../utils/llmClient.js";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizeText = (value: string): string => value.trim().toLowerCase();

const tokenize = (value: string): string[] =>
  normalizeText(value)
    .split(/[^a-z0-9+/.-]+/i)
    .map((token) => token.trim())
    .filter(Boolean);

const scoreSkillMatch = (requiredSkill: string, description: string, workerSkills: string[]): number => {
  if (workerSkills.length === 0) {
    return 0.1;
  }

  const normalizedRequiredSkill = normalizeText(requiredSkill);
  const requiredTokens = new Set(tokenize(requiredSkill || description));
  let bestScore = 0.15;

  for (const workerSkill of workerSkills) {
    const normalizedWorkerSkill = normalizeText(workerSkill);

    if (normalizedRequiredSkill && (normalizedWorkerSkill === normalizedRequiredSkill
      || normalizedWorkerSkill.includes(normalizedRequiredSkill)
      || normalizedRequiredSkill.includes(normalizedWorkerSkill))) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    const workerTokens = new Set(tokenize(workerSkill));
    const overlap = [...requiredTokens].filter((token) => workerTokens.has(token)).length;
    const tokenScore = requiredTokens.size ? overlap / requiredTokens.size : 0.2;
    bestScore = Math.max(bestScore, tokenScore);
  }

  if (!requiredSkill.trim()) {
    return clamp(bestScore + 0.1, 0, 1);
  }

  return clamp(bestScore, 0, 1);
};

const scoreAvailability = (worker: WorkerRecord): number => {
  const availability = normalizeText(worker.availability);
  let baseScore = 0.45;

  if (availability.includes("available") || availability.includes("open")) {
    baseScore = 1;
  } else if (availability.includes("limited") || availability.includes("part")) {
    baseScore = 0.65;
  } else if (availability.includes("busy") || availability.includes("occupied")) {
    baseScore = 0.25;
  } else if (availability.includes("offline") || availability.includes("unavailable") || availability.includes("inactive")) {
    baseScore = 0.05;
  }

  const capacity = worker.capacity;
  const activeTaskCount = worker.activeTaskCount ?? 0;

  if (!capacity || capacity <= 0) {
    return baseScore;
  }

  const capacityUtilization = activeTaskCount / capacity;

  if (capacityUtilization >= 1) {
    return clamp(baseScore * 0.1, 0, 1);
  }

  return clamp(baseScore * (1 - (capacityUtilization * 0.5)), 0, 1);
};

const scoreTimezone = (task: TaskRecord, worker: WorkerRecord): number => {
  const preference = task.timezonePreference?.trim();
  const workerTimezone = worker.timezone?.trim();

  if (!preference && !workerTimezone) {
    return 0.65;
  }

  if (!preference) {
    return workerTimezone ? 0.75 : 0.65;
  }

  if (!workerTimezone) {
    return 0.45;
  }

  if (normalizeText(preference) === normalizeText(workerTimezone)) {
    return 1;
  }

  const taskOffset = resolveTimezoneOffset(preference);
  const workerOffset = resolveTimezoneOffset(workerTimezone);

  if (taskOffset === null || workerOffset === null) {
    return workerTimezone.toLowerCase().includes(preference.toLowerCase()) ? 0.9 : 0.55;
  }

  const hourDifference = Math.abs(taskOffset - workerOffset) / 60;
  return clamp(1 - (hourDifference / 12), 0.2, 1);
};

const scoreCost = (workerRate: number | undefined, allRates: number[]): number => {
  if (workerRate === undefined || allRates.length === 0) {
    return 0.65;
  }

  const minRate = Math.min(...allRates);
  const maxRate = Math.max(...allRates);

  if (minRate === maxRate) {
    return 0.75;
  }

  return clamp(1 - ((workerRate - minRate) / (maxRate - minRate)), 0.1, 1);
};

const buildReasoning = (
  task: TaskRecord,
  topWorker: WorkerRecord,
  breakdown: WorkerScore,
  secondBest?: WorkerScore,
): string => {
  const confidenceNote = secondBest
    ? `Top-vs-second score gap is ${(breakdown.totalScore - secondBest.totalScore).toFixed(2)}.`
    : "Only one viable worker profile was available in the current context.";

  return [
    `Selected ${topWorker.name} for "${task.title}" because skill match scored ${breakdown.skillScore.toFixed(2)}, availability ${breakdown.availabilityScore.toFixed(2)}, timezone fit ${breakdown.timezoneScore.toFixed(2)}, and cost efficiency ${breakdown.costScore.toFixed(2)}.`,
    confidenceNote,
  ].join(" ");
};

const generateModelNarrative = async (
  task: TaskRecord,
  scoredWorkers: WorkerScore[],
  historySummary?: string,
): Promise<string | null> => {
  return generateChatNarrative({
    temperature: 0.2,
    warningLabel: "Planner model narration failed",
    messages: [
      {
        role: "system",
        content: "You are a workforce planner. Summarize the best worker recommendation in 2 sentences and respect any prior approval history.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            provider: env.aiProvider,
            task,
            scoredWorkers: scoredWorkers.slice(0, 3),
            historySummary,
          },
          null,
          2,
        ),
      },
    ],
  });
};

export interface WorkerScore {
  workerId: string;
  workerName: string;
  totalScore: number;
  skillScore: number;
  availabilityScore: number;
  timezoneScore: number;
  costScore: number;
}

export interface PlannerDecision {
  requiredSkill: string;
  selectedWorker: WorkerRecord;
  confidence: number;
  approvalRequired: boolean;
  reasoning: string;
  providerNarrative?: string | null;
  rankedWorkers: WorkerScore[];
}

export interface PlannerHistoryContext {
  rejectedWorkerIds?: string[];
  rejectedWorkerNames?: string[];
  historySummary?: string;
}

export class PlannerAgent {
  async planTaskAssignment(task: TaskRecord, workers: WorkerRecord[], history: PlannerHistoryContext = {}): Promise<PlannerDecision> {
    if (workers.length === 0) {
      throw new Error("No workers found in the Notion Workers database.");
    }

    const rejectedWorkerIds = new Set(history.rejectedWorkerIds ?? []);
    const eligibleWorkers = rejectedWorkerIds.size > 0
      ? workers.filter((worker) => !rejectedWorkerIds.has(worker.id))
      : workers;
    const workerPool = eligibleWorkers.length > 0 ? eligibleWorkers : workers;
    const reconsideringRejectedWorkers = rejectedWorkerIds.size > 0 && eligibleWorkers.length === 0;
    const rateBook = workerPool
      .map((worker) => worker.hourlyRate)
      .filter((value): value is number => typeof value === "number");

    const scoredWorkers = workerPool
      .map((worker) => {
        const skillScore = scoreSkillMatch(task.requiredSkill, task.description, worker.skills);
        const availabilityScore = scoreAvailability(worker);
        const timezoneScore = scoreTimezone(task, worker);
        const costScore = scoreCost(worker.hourlyRate, rateBook);
        const totalScore = (
          (skillScore * 0.45)
          + (availabilityScore * 0.25)
          + (timezoneScore * 0.15)
          + (costScore * 0.15)
        );

        return {
          worker,
          totalScore: Number(totalScore.toFixed(4)),
          skillScore: Number(skillScore.toFixed(4)),
          availabilityScore: Number(availabilityScore.toFixed(4)),
          timezoneScore: Number(timezoneScore.toFixed(4)),
          costScore: Number(costScore.toFixed(4)),
        };
      })
      .sort((left, right) => right.totalScore - left.totalScore);

    const [topResult, secondResult] = scoredWorkers;

    if (!topResult) {
      throw new Error("Unable to score workers for the requested task.");
    }

    const margin = secondResult ? topResult.totalScore - secondResult.totalScore : topResult.totalScore;
    const marginScore = clamp(margin / 0.25, 0, 1);
    let confidence = (
      (topResult.totalScore * 0.45)
      + (topResult.skillScore * 0.3)
      + (topResult.availabilityScore * 0.15)
      + (marginScore * 0.1)
    );

    if (topResult.skillScore < 0.5) {
      confidence -= 0.12;
    }

    if (topResult.availabilityScore < 0.5) {
      confidence -= 0.08;
    }

    if (topResult.totalScore < 0.6) {
      confidence -= 0.06;
    }

    confidence = clamp(Number(confidence.toFixed(4)), 0, 0.97);

    const rankedWorkers: WorkerScore[] = scoredWorkers.map((result) => ({
      workerId: result.worker.id,
      workerName: result.worker.name,
      totalScore: result.totalScore,
      skillScore: result.skillScore,
      availabilityScore: result.availabilityScore,
      timezoneScore: result.timezoneScore,
      costScore: result.costScore,
    }));
    const providerNarrative = await generateModelNarrative(task, rankedWorkers, history.historySummary);
    const historySuffix = history.rejectedWorkerNames && history.rejectedWorkerNames.length > 0
      ? reconsideringRejectedWorkers
        ? ` All available candidates had been rejected earlier for this task, so the planner had to reconsider ${history.rejectedWorkerNames.join(", ")}.`
        : ` Previously rejected candidates were excluded from this rerun: ${history.rejectedWorkerNames.join(", ")}.`
      : "";
    const reasoning = (providerNarrative
      || buildReasoning(task, topResult.worker, rankedWorkers[0], rankedWorkers[1])) + historySuffix;

    return {
      requiredSkill: task.requiredSkill || "Generalist",
      selectedWorker: topResult.worker,
      confidence,
      approvalRequired: confidence < env.aiConfidenceThreshold,
      reasoning,
      providerNarrative,
      rankedWorkers,
    };
  }
}
