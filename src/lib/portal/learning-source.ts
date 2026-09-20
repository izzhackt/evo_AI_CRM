import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import {
  parseLearningAttempt,
  parseLearningLessonView,
  parseLearningModules,
  parseLearningReview,
  parseLearningReviewCheck,
  parseLearningSaveResult,
  type LearningAnswer,
  type LearningAttempt,
  type LearningLessonView,
  type LearningModule,
  type LearningReviewCheck,
  type LearningReviewItem,
  type LearningSaveResult,
} from "./learning";

/**
 * Серверный транспорт движка обучения (миграция 198). Коды ошибок зеркалят
 * assessment-source: 40001 -> conflict, 22023 -> invalid, 42501 -> denied,
 * остальное -> unavailable.
 */
export class LearningSourceError extends Error {
  readonly code: "conflict" | "invalid" | "denied" | "unavailable";
  constructor(code: "conflict" | "invalid" | "denied" | "unavailable" = "unavailable") {
    super("Learning is unavailable.");
    this.name = "LearningSourceError";
    this.code = code;
  }
}

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = await createSupabaseServerClient();
  const response = await client.schema("platform").rpc(name, args);
  if (response.error) {
    const code = typeof response.error === "object"
      ? (response.error as unknown as Record<string, unknown>).code
      : null;
    throw new LearningSourceError(
      code === "40001" ? "conflict" : code === "22023" ? "invalid" : code === "42501" ? "denied" : "unavailable",
    );
  }
  return response.data;
}

function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new LearningSourceError("unavailable");
  }
}

export async function readLearningModules(): Promise<LearningModule[]> {
  const data = await rpc("learning_modules_v1");
  return parsed(() => parseLearningModules(data));
}

export async function readLearningLesson(lessonId: string): Promise<LearningLessonView> {
  const data = await rpc("learning_lesson_v1", { p_lesson_id: lessonId });
  return parsed(() => parseLearningLessonView(data));
}

export async function startLearningLesson(
  lessonId: string,
  requestId: string,
): Promise<LearningAttempt> {
  const data = await rpc("start_learning_lesson_v1", {
    p_lesson_id: lessonId,
    p_request_id: requestId,
  });
  return parsed(() => parseLearningAttempt(data));
}

export async function saveLearningAnswer(input: {
  attemptId: string;
  expectedRevision: number;
  exerciseId: string;
  answer: LearningAnswer;
  requestId: string;
}): Promise<LearningSaveResult> {
  const data = await rpc("save_learning_answer_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_exercise_id: input.exerciseId,
    p_answer: input.answer,
    p_request_id: input.requestId,
  });
  return parsed(() => parseLearningSaveResult(data));
}

export async function completeLearningLesson(input: {
  attemptId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<LearningAttempt> {
  const data = await rpc("complete_learning_lesson_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId,
  });
  return parsed(() => parseLearningAttempt(data));
}

export async function readLearningReview(moduleId: string): Promise<LearningReviewItem[]> {
  const data = await rpc("learning_review_v1", { p_module_id: moduleId });
  return parsed(() => parseLearningReview(data));
}

export async function checkLearningReviewAnswer(
  exerciseId: string,
  answer: LearningAnswer,
): Promise<LearningReviewCheck> {
  const data = await rpc("learning_review_check_v1", {
    p_exercise_id: exerciseId,
    p_answer: answer,
  });
  return parsed(() => parseLearningReviewCheck(data));
}
