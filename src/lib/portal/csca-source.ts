import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import {
  CSCA_TRACK,
  parseCscaAnswerReceipt,
  parseCscaHome,
  parseCscaLessonAttempt,
  parseCscaLessonView,
  parseCscaModuleLessons,
  parseCscaProgress,
  parseCscaReportReceipt,
  parseCscaReview,
  parseCscaReviewReceipt,
  parseCscaTargetReceipt,
  parseCscaTestAttempt,
  parseCscaTestSaveReceipt,
  cscaErrorCode,
  type CscaAnswerReceipt,
  type CscaErrorCode,
  type CscaHome,
  type CscaLessonAttempt,
  type CscaLessonSummary,
  type CscaLessonView,
  type CscaOptionId,
  type CscaProgress,
  type CscaReview,
  type CscaReviewReceipt,
  type CscaTestAttempt,
  type CscaTestSaveReceipt,
} from "./csca";

/**
 * Серверный транспорт CSCA (RPC миграции 285 и записи 198). Коды ошибок
 * (cscaErrorCode в csca.ts) зеркалят learning-source и добавляют именованные
 * отказы теста, повторения и сообщений (§1.1 контракта).
 */
export type { CscaErrorCode };

export class CscaSourceError extends Error {
  readonly code: CscaErrorCode;
  constructor(code: CscaErrorCode = "unavailable") {
    super("CSCA learning is unavailable.");
    this.name = "CscaSourceError";
    this.code = code;
  }
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await createSupabaseServerClient();
  const response = await client.schema("platform").rpc(name, args);
  if (response.error) throw new CscaSourceError(cscaErrorCode(response.error));
  return response.data;
}

function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new CscaSourceError("unavailable");
  }
}

export async function readCscaHome(): Promise<CscaHome> {
  const data = await rpc("learning_track_home_v1", { p_track: CSCA_TRACK });
  return parsed(() => parseCscaHome(data));
}

export async function readCscaModuleLessons(): Promise<CscaLessonSummary[]> {
  const data = await rpc("learning_modules_v2", { p_track: CSCA_TRACK });
  return parsed(() => parseCscaModuleLessons(data));
}

export async function readCscaLesson(lessonId: string): Promise<CscaLessonView> {
  const data = await rpc("learning_lesson_v2", { p_lesson_id: lessonId });
  const view = parsed(() => parseCscaLessonView(data));
  // Уроки «Английского» этот экран не рисует: чужой трек = нет такого урока.
  if (view.module.track !== CSCA_TRACK) throw new CscaSourceError("denied");
  return view;
}

export async function startCscaLesson(lessonId: string, requestId: string): Promise<CscaLessonAttempt> {
  const data = await rpc("start_learning_lesson_v1", { p_lesson_id: lessonId, p_request_id: requestId });
  return parsed(() => parseCscaLessonAttempt(data));
}

export async function saveCscaAnswer(input: {
  attemptId: string;
  expectedRevision: number;
  exerciseId: string;
  selected: CscaOptionId;
  requestId: string;
}): Promise<CscaAnswerReceipt> {
  const data = await rpc("save_learning_answer_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_exercise_id: input.exerciseId,
    p_answer: { selected: input.selected },
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaAnswerReceipt(data));
}

export async function completeCscaLesson(input: {
  attemptId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<CscaLessonAttempt> {
  const data = await rpc("complete_learning_lesson_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaLessonAttempt(data));
}

export async function startCscaTest(formId: string, requestId: string): Promise<CscaTestAttempt> {
  const data = await rpc("start_learning_test_v1", { p_form_id: formId, p_request_id: requestId });
  return parsed(() => parseCscaTestAttempt(data));
}

export async function readCscaTestAttempt(attemptId: string): Promise<CscaTestAttempt> {
  const data = await rpc("learning_test_attempt_v1", { p_attempt_id: attemptId });
  return parsed(() => parseCscaTestAttempt(data));
}

export async function saveCscaTest(input: {
  attemptId: string;
  expectedRevision: number;
  answers: Record<string, CscaOptionId>;
  flags: string[];
  itemSeconds: Record<string, number>;
  requestId: string;
}): Promise<CscaTestSaveReceipt> {
  const data = await rpc("save_learning_test_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_answers: input.answers,
    p_flags: input.flags,
    p_item_seconds: input.itemSeconds,
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaTestSaveReceipt(data));
}

export async function completeCscaTest(input: {
  attemptId: string;
  expectedRevision: number;
  requestId: string;
}): Promise<CscaTestAttempt> {
  const data = await rpc("complete_learning_test_v1", {
    p_attempt_id: input.attemptId,
    p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaTestAttempt(data));
}

export async function readCscaReview(): Promise<CscaReview> {
  const data = await rpc("learning_review_v2", { p_track: CSCA_TRACK });
  return parsed(() => parseCscaReview(data));
}

export async function recordCscaReview(input: {
  itemKey: string;
  selected: CscaOptionId;
  requestId: string;
}): Promise<CscaReviewReceipt> {
  const data = await rpc("record_learning_review_v1", {
    p_track: CSCA_TRACK,
    p_item_key: input.itemKey,
    p_answer: { selected: input.selected },
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaReviewReceipt(data));
}

export async function readCscaProgress(): Promise<CscaProgress> {
  const data = await rpc("learning_track_progress_v1", { p_track: CSCA_TRACK });
  return parsed(() => parseCscaProgress(data));
}

export async function reportCscaItem(input: {
  itemKey: string;
  message: string;
  requestId: string;
}): Promise<{ reportId: string; itemKey: string }> {
  const data = await rpc("report_learning_item_v1", {
    p_track: CSCA_TRACK,
    p_item_key: input.itemKey,
    p_message: input.message,
    p_request_id: input.requestId,
  });
  return parsed(() => parseCscaReportReceipt(data));
}

export async function setCscaTargetSession(sessionKey: string | null): Promise<{ targetSessionKey: string | null }> {
  const data = await rpc("set_learning_target_session_v1", { p_track: CSCA_TRACK, p_session_key: sessionKey });
  return parsed(() => parseCscaTargetReceipt(data));
}
