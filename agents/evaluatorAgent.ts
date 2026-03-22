import { env } from "../config/env.js";
import { type TaskRecord } from "../notion/databases.js";
import { generateChatNarrative } from "../utils/llmClient.js";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizeText = (value: string): string => value.trim().toLowerCase();

const buildFallbackReasoning = (
  task: TaskRecord,
  completionNotes: string,
  qualityScore: number,
  needsHumanReview: boolean,
): string => {
  const reviewSentence = needsHumanReview
    ? "Human review is recommended because the completion evidence is either short or below the quality threshold for the task priority."
    : "Human review is optional because the completion notes show enough detail for an automated pass.";

  return [
    `Evaluated "${task.title}" with a quality score of ${qualityScore}/100 from completion detail, delivery signals, and clarity of the handoff.`,
    `Completion note length was ${completionNotes.length} characters.`,
    reviewSentence,
  ].join(" ");
};

const generateModelNarrative = async (
  task: TaskRecord,
  completionNotes: string,
  qualityScore: number,
  needsHumanReview: boolean,
): Promise<string | null> => {
  return generateChatNarrative({
    temperature: 0.1,
    warningLabel: "Evaluator model narration failed",
    messages: [
      {
        role: "system",
        content: "You are a QA evaluator. Summarize the completed task quality in 2 sentences.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            provider: env.aiProvider,
            task,
            completionNotes,
            qualityScore,
            needsHumanReview,
          },
          null,
          2,
        ),
      },
    ],
  });
};

export interface EvaluationResult {
  qualityScore: number;
  needsHumanReview: boolean;
  reasoning: string;
  providerNarrative?: string | null;
}

export class EvaluatorAgent {
  async evaluateTaskCompletion(task: TaskRecord, completionNotes: string): Promise<EvaluationResult> {
    const noteLengthScore = clamp(completionNotes.trim().length / 450, 0, 1);
    const deliverySignals = [
      "delivered",
      "handoff",
      "review",
      "prototype",
      "design",
      "tested",
      "shared",
      "link",
      "completed",
      "launch",
      "approved",
      "documented",
    ];
    const foundSignals = deliverySignals.filter((signal) => normalizeText(completionNotes).includes(signal));
    const deliverySignalScore = clamp(foundSignals.length / 4, 0, 1);
    const sentenceCount = completionNotes
      .split(/[.!?]/)
      .map((sentence) => sentence.trim())
      .filter(Boolean).length;
    const clarityScore = sentenceCount >= 3 ? 1 : sentenceCount === 2 ? 0.75 : 0.45;
    let qualityScore = (
      (noteLengthScore * 0.35)
      + (deliverySignalScore * 0.4)
      + (clarityScore * 0.25)
    ) * 100;

    if (normalizeText(task.priority) === "high") {
      qualityScore -= 5;
    }

    qualityScore = Math.round(clamp(qualityScore, 0, 100));

    const needsHumanReview = qualityScore < 75
      || completionNotes.trim().length < 80
      || (normalizeText(task.priority) === "high" && qualityScore < 85);
    const providerNarrative = await generateModelNarrative(task, completionNotes, qualityScore, needsHumanReview);
    const reasoning = providerNarrative || buildFallbackReasoning(task, completionNotes, qualityScore, needsHumanReview);

    return {
      qualityScore,
      needsHumanReview,
      reasoning,
      providerNarrative,
    };
  }
}
