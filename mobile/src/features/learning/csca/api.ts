// Чтения и записи CSCA через RPC схемы `platform` (контракт docs/portal/csca-contract.md).
// Парсеры ответов — общие с вебом (@web/lib/portal/csca): строгая форма, неожиданный ключ
// (например, утёкший ключ ответа) означает ошибку экрана, а не показ. Тексты серверных
// ошибок дальше слоя RPC не идут (docs/mobile/reference/ios-app-inventory.md §0).
import {
  CSCA_TRACK,
  parseCscaAnswerReceipt,
  parseCscaHome,
  parseCscaLessonAttempt,
  parseCscaLessonView,
  parseCscaProgress,
  parseCscaReportReceipt,
  parseCscaReview,
  parseCscaReviewReceipt,
  parseCscaTargetReceipt,
  parseCscaTestAttempt,
  parseCscaTestSaveReceipt,
  type CscaAnswerReceipt,
  type CscaHome,
  type CscaLessonAttempt,
  type CscaLessonView,
  type CscaOptionId,
  type CscaProgress,
  type CscaReview,
  type CscaReviewReceipt,
  type CscaTestAttempt,
  type CscaTestSaveReceipt,
} from "@web/lib/portal/csca";

import { PortalDecodeError } from "@/domain/portal-source";
import { createWrite, RpcError, rpcRead, rpcWrite, type FrozenWrite, type RpcNamedFailure, type RpcTransport } from "@/lib/rpc";

/** Разбор ответа; любая форма вне контракта это `PortalDecodeError` без данных. */
function decoded<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch {
    throw new PortalDecodeError();
  }
}

export const readCscaHomeV1 = async (transport: RpcTransport): Promise<CscaHome> =>
  decoded(parseCscaHome, await rpcRead(transport, "learning_track_home_v1", { p_track: CSCA_TRACK }));

export const readCscaLessonV2 = async (transport: RpcTransport, lessonId: string): Promise<CscaLessonView> => {
  const view = decoded(parseCscaLessonView, await rpcRead(transport, "learning_lesson_v2", { p_lesson_id: lessonId }));
  // Уроки «Английского» этот экран не рисует: чужой трек это «нет такого урока».
  if (view.module.track !== CSCA_TRACK) throw new RpcError("forbidden", "42501");
  return view;
};

export const readCscaTestAttemptV1 = async (transport: RpcTransport, attemptId: string): Promise<CscaTestAttempt> =>
  decoded(parseCscaTestAttempt, await rpcRead(transport, "learning_test_attempt_v1", { p_attempt_id: attemptId }));

export const readCscaReviewV2 = async (transport: RpcTransport): Promise<CscaReview> =>
  decoded(parseCscaReview, await rpcRead(transport, "learning_review_v2", { p_track: CSCA_TRACK }));

export const readCscaProgressV1 = async (transport: RpcTransport): Promise<CscaProgress> =>
  decoded(parseCscaProgress, await rpcRead(transport, "learning_track_progress_v1", { p_track: CSCA_TRACK }));

// ---- записи: замороженный запрос + повтор того же запроса при обрыве --------------------

export const startLessonWrite = (lessonId: string, requestId?: string): FrozenWrite =>
  createWrite("start_learning_lesson_v1", { p_lesson_id: lessonId }, { requestId });

export const saveAnswerWrite = (input: { attemptId: string; expectedRevision: number; exerciseId: string; selected: CscaOptionId }, requestId?: string): FrozenWrite =>
  createWrite(
    "save_learning_answer_v1",
    { p_attempt_id: input.attemptId, p_expected_revision: input.expectedRevision, p_exercise_id: input.exerciseId, p_answer: { selected: input.selected } },
    { requestId },
  );

export const completeLessonWrite = (input: { attemptId: string; expectedRevision: number }, requestId?: string): FrozenWrite =>
  createWrite("complete_learning_lesson_v1", { p_attempt_id: input.attemptId, p_expected_revision: input.expectedRevision }, { requestId });

export const sendStartLesson = async (transport: RpcTransport, write: FrozenWrite): Promise<CscaLessonAttempt> =>
  decoded(parseCscaLessonAttempt, await rpcWrite(transport, write));
export const sendAnswer = async (transport: RpcTransport, write: FrozenWrite): Promise<CscaAnswerReceipt> =>
  decoded(parseCscaAnswerReceipt, await rpcWrite(transport, write));

export const startTestWrite = (formId: string, requestId?: string): FrozenWrite =>
  createWrite("start_learning_test_v1", { p_form_id: formId }, { requestId });

export const saveTestWrite = (
  input: { attemptId: string; expectedRevision: number; answers: Record<string, CscaOptionId>; flags: string[]; itemSeconds: Record<string, number> },
  requestId?: string,
): FrozenWrite =>
  createWrite(
    "save_learning_test_v1",
    { p_attempt_id: input.attemptId, p_expected_revision: input.expectedRevision, p_answers: input.answers, p_flags: input.flags, p_item_seconds: input.itemSeconds },
    { requestId },
  );

export const completeTestWrite = (input: { attemptId: string; expectedRevision: number }, requestId?: string): FrozenWrite =>
  createWrite("complete_learning_test_v1", { p_attempt_id: input.attemptId, p_expected_revision: input.expectedRevision }, { requestId });

export const sendTestAttempt = async (transport: RpcTransport, write: FrozenWrite): Promise<CscaTestAttempt> =>
  decoded(parseCscaTestAttempt, await rpcWrite(transport, write));
export const sendTestSave = async (transport: RpcTransport, write: FrozenWrite): Promise<CscaTestSaveReceipt> =>
  decoded(parseCscaTestSaveReceipt, await rpcWrite(transport, write));

export const reviewWrite = (itemKey: string, selected: CscaOptionId, requestId?: string): FrozenWrite =>
  createWrite("record_learning_review_v1", { p_track: CSCA_TRACK, p_item_key: itemKey, p_answer: { selected } }, { requestId });
export const sendReview = async (transport: RpcTransport, write: FrozenWrite): Promise<CscaReviewReceipt> =>
  decoded(parseCscaReviewReceipt, await rpcWrite(transport, write));

export const reportWrite = (itemKey: string, message: string, requestId?: string): FrozenWrite =>
  createWrite("report_learning_item_v1", { p_track: CSCA_TRACK, p_item_key: itemKey, p_message: message }, { requestId });
export const sendReport = async (transport: RpcTransport, write: FrozenWrite) =>
  decoded(parseCscaReportReceipt, await rpcWrite(transport, write));

/** Выбор целевой сессии: не запись с request_id (контракт §11), идемпотентна по значению. */
export async function setTargetSession(transport: RpcTransport, sessionKey: string | null): Promise<{ targetSessionKey: string | null }> {
  return decoded(parseCscaTargetReceipt, await rpcRead(transport, "set_learning_target_session_v1", { p_track: CSCA_TRACK, p_session_key: sessionKey }));
}

// ---- ошибки -------------------------------------------------------------------------------

export type CscaFailure =
  | "conflict"
  | "invalid"
  | "denied"
  | "unavailable"
  | RpcNamedFailure;

/** Код сбоя для экрана: без текста сервера (тот не доходит и до этого слоя). */
export function cscaFailure(error: unknown): CscaFailure {
  if (error instanceof RpcError) {
    if (error.named) return error.named;
    switch (error.kind) {
      case "conflict": return "conflict";
      case "forbidden": return "denied";
      case "invalid": return "invalid";
      default: return "unavailable";
    }
  }
  return "unavailable"; // PortalDecodeError и прочее: повтор тем же запросом безопасен
}
