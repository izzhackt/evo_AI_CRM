"use server";

import { revalidatePath } from "next/cache";

import { requireStudentPortalActor } from "../student-portal-guards";
import {
  isLearningUuid,
  parseLearningAnswerInput,
  type LearningAttempt,
  type LearningExerciseType,
  type LearningReviewCheck,
  type LearningSaveResult,
} from "./learning";
import {
  LearningSourceError,
  checkLearningReviewAnswer,
  completeLearningLesson,
  readLearningLesson,
  saveLearningAnswer,
  startLearningLesson,
} from "./learning-source";

/**
 * Server actions урока (PORT-4c). Тексты ошибок локализует клиент по коду —
 * действия возвращают только код; идемпотентность держит request_id RPC.
 */
export type LearningActionError = {
  ok: false;
  code: "conflict" | "invalid" | "denied" | "unavailable";
};
export type LearningAttemptActionResult = { ok: true; attempt: LearningAttempt } | LearningActionError;
export type LearningSaveActionResult = { ok: true; save: LearningSaveResult } | LearningActionError;
export type LearningReviewCheckActionResult =
  | { ok: true; check: LearningReviewCheck }
  | LearningActionError;

function failure(error: unknown): LearningActionError {
  return {
    ok: false,
    code: error instanceof LearningSourceError ? error.code : "unavailable",
  };
}

export async function startLearningLessonAction(
  lessonId: unknown,
  requestId: unknown,
): Promise<LearningAttemptActionResult> {
  await requireStudentPortalActor();
  if (!isLearningUuid(lessonId) || !isLearningUuid(requestId)) {
    return failure(new LearningSourceError("invalid"));
  }
  try {
    const attempt = await startLearningLesson(lessonId, requestId);
    revalidatePath("/portal/english");
    return { ok: true, attempt };
  } catch (error) {
    return failure(error);
  }
}

export async function saveLearningAnswerAction(input: {
  attemptId: unknown;
  expectedRevision: unknown;
  exerciseId: unknown;
  exerciseType: unknown;
  answer: unknown;
  requestId: unknown;
}): Promise<LearningSaveActionResult> {
  await requireStudentPortalActor();
  const type = input.exerciseType;
  if (
    !isLearningUuid(input.attemptId) || !isLearningUuid(input.exerciseId)
    || !isLearningUuid(input.requestId)
    || typeof input.expectedRevision !== "number"
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
    || (type !== "choice" && type !== "matching" && type !== "short_answer" && type !== "reading")
  ) {
    return failure(new LearningSourceError("invalid"));
  }
  const answer = parseLearningAnswerInput(type as LearningExerciseType, input.answer);
  if (!answer) return failure(new LearningSourceError("invalid"));
  try {
    return {
      ok: true,
      save: await saveLearningAnswer({
        attemptId: input.attemptId,
        expectedRevision: input.expectedRevision,
        exerciseId: input.exerciseId,
        answer,
        requestId: input.requestId,
      }),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function completeLearningLessonAction(input: {
  attemptId: unknown;
  expectedRevision: unknown;
  requestId: unknown;
}): Promise<LearningAttemptActionResult> {
  await requireStudentPortalActor();
  if (
    !isLearningUuid(input.attemptId) || !isLearningUuid(input.requestId)
    || typeof input.expectedRevision !== "number"
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
  ) {
    return failure(new LearningSourceError("invalid"));
  }
  try {
    const attempt = await completeLearningLesson({
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
    });
    revalidatePath("/portal/english");
    return { ok: true, attempt };
  } catch (error) {
    return failure(error);
  }
}

/** Свежий черновик после конфликта ревизии — без потери экрана. */
export async function reloadLearningLessonAction(
  lessonId: unknown,
): Promise<LearningAttemptActionResult> {
  await requireStudentPortalActor();
  if (!isLearningUuid(lessonId)) return failure(new LearningSourceError("invalid"));
  try {
    const view = await readLearningLesson(lessonId);
    if (!view.draft) return failure(new LearningSourceError("conflict"));
    return { ok: true, attempt: view.draft };
  } catch (error) {
    return failure(error);
  }
}

export async function checkLearningReviewAction(input: {
  exerciseId: unknown;
  exerciseType: unknown;
  answer: unknown;
}): Promise<LearningReviewCheckActionResult> {
  await requireStudentPortalActor();
  const type = input.exerciseType;
  if (
    !isLearningUuid(input.exerciseId)
    || (type !== "choice" && type !== "matching" && type !== "short_answer" && type !== "reading")
  ) {
    return failure(new LearningSourceError("invalid"));
  }
  const answer = parseLearningAnswerInput(type as LearningExerciseType, input.answer);
  if (!answer) return failure(new LearningSourceError("invalid"));
  try {
    return { ok: true, check: await checkLearningReviewAnswer(input.exerciseId, answer) };
  } catch (error) {
    return failure(error);
  }
}
