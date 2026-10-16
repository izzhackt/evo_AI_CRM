"use server";

import { requireStudentPortalActor } from "../student-portal-guards";
import {
  isCscaKey,
  isCscaOptionId,
  isCscaUuid,
  testSavePayload,
  type CscaAnswerReceipt,
  type CscaLessonAttempt,
  type CscaOptionId,
  type CscaReviewReceipt,
  type CscaTestAttempt,
  type CscaTestSaveReceipt,
} from "./csca";
import {
  CscaSourceError,
  completeCscaLesson,
  completeCscaTest,
  readCscaLesson,
  readCscaTestAttempt,
  recordCscaReview,
  reportCscaItem,
  saveCscaAnswer,
  saveCscaTest,
  setCscaTargetSession,
  startCscaLesson,
  startCscaTest,
  type CscaErrorCode,
} from "./csca-source";

/**
 * Server actions экранов CSCA. Возвращают только код ошибки: тексты
 * локализует клиент. Идемпотентность держит p_request_id RPC: клиент
 * повторяет действие с теми же идентификаторами запроса.
 *
 * revalidatePath здесь нет намеренно: обновление маршрута в ответе действия
 * перечитывало бы текущий экран (урок, тест, повторение) после записи, то
 * есть лишняя волна RPC (S1). Страницы CSCA динамические и читаются заново
 * при переходе.
 */
export type CscaActionError = { ok: false; code: CscaErrorCode };

function failure(error: unknown): CscaActionError {
  return { ok: false, code: error instanceof CscaSourceError ? error.code : "unavailable" };
}

const invalid = (): CscaActionError => ({ ok: false, code: "invalid" });

function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export type CscaAnswerActionResult =
  | { ok: true; attemptId: string; receipt: CscaAnswerReceipt; completed: CscaLessonAttempt | null }
  | CscaActionError;

/**
 * Ответ на задание урока или практики одним кругом: при первом ответе
 * сначала открывается попытка (start 198), после ответа на последнее
 * задание попытка сразу завершается (complete 198). Все три вызова несут
 * идентификаторы запроса клиента, поэтому повтор после сбоя безопасен.
 */
export async function answerCscaLessonItemAction(input: {
  lessonId: unknown;
  attemptId: unknown;
  expectedRevision: unknown;
  startRequestId: unknown;
  exerciseId: unknown;
  selected: unknown;
  requestId: unknown;
  completeRequestId: unknown;
}): Promise<CscaAnswerActionResult> {
  await requireStudentPortalActor();
  if (
    !isCscaUuid(input.lessonId) || !isCscaUuid(input.exerciseId) || !isCscaUuid(input.requestId)
    || !isCscaUuid(input.startRequestId) || !isCscaUuid(input.completeRequestId)
    || !isCscaOptionId(input.selected)
    || (input.attemptId !== null && !isCscaUuid(input.attemptId))
    || (input.attemptId !== null && !revision(input.expectedRevision))
  ) {
    return invalid();
  }
  try {
    let attemptId = input.attemptId as string | null;
    let expected = input.expectedRevision as number;
    if (attemptId === null) {
      const attempt = await startCscaLesson(input.lessonId, input.startRequestId);
      attemptId = attempt.attemptId;
      expected = attempt.revision;
    }
    const receipt = await saveCscaAnswer({
      attemptId,
      expectedRevision: expected,
      exerciseId: input.exerciseId,
      selected: input.selected,
      requestId: input.requestId,
    });
    let completed: CscaLessonAttempt | null = null;
    if (receipt.answeredCount === receipt.exercisesTotal) {
      completed = await completeCscaLesson({
        attemptId,
        expectedRevision: receipt.revision,
        requestId: input.completeRequestId,
      });
    }
    return { ok: true, attemptId, receipt, completed };
  } catch (error) {
    return failure(error);
  }
}

export type CscaLessonCompleteResult = { ok: true; attempt: CscaLessonAttempt } | CscaActionError;

/** Завершение черновика, где отвечено всё, а завершение не дошло. */
export async function completeCscaLessonAction(input: {
  attemptId: unknown;
  expectedRevision: unknown;
  requestId: unknown;
}): Promise<CscaLessonCompleteResult> {
  await requireStudentPortalActor();
  if (!isCscaUuid(input.attemptId) || !isCscaUuid(input.requestId) || !revision(input.expectedRevision)) {
    return invalid();
  }
  try {
    const attempt = await completeCscaLesson({
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
    });
    return { ok: true, attempt };
  } catch (error) {
    return failure(error);
  }
}

export type CscaLessonReloadResult =
  | { ok: true; draft: CscaLessonAttempt | null; latestCompleted: CscaLessonAttempt | null }
  | CscaActionError;

/** Свежее состояние урока после конфликта ревизии или повторного ответа. */
export async function reloadCscaLessonAction(lessonId: unknown): Promise<CscaLessonReloadResult> {
  await requireStudentPortalActor();
  if (!isCscaUuid(lessonId)) return invalid();
  try {
    const view = await readCscaLesson(lessonId);
    return { ok: true, draft: view.draft, latestCompleted: view.latestCompleted };
  } catch (error) {
    return failure(error);
  }
}

export type CscaTestActionResult = { ok: true; attempt: CscaTestAttempt } | CscaActionError;

export async function startCscaTestAction(formId: unknown, requestId: unknown): Promise<CscaTestActionResult> {
  await requireStudentPortalActor();
  if (!isCscaUuid(formId) || !isCscaUuid(requestId)) return invalid();
  try {
    return { ok: true, attempt: await startCscaTest(formId, requestId) };
  } catch (error) {
    return failure(error);
  }
}

export async function readCscaTestAttemptAction(attemptId: unknown): Promise<CscaTestActionResult> {
  await requireStudentPortalActor();
  if (!isCscaUuid(attemptId)) return invalid();
  try {
    return { ok: true, attempt: await readCscaTestAttempt(attemptId) };
  } catch (error) {
    return failure(error);
  }
}

export type CscaTestSaveActionResult = { ok: true; receipt: CscaTestSaveReceipt } | CscaActionError;

export async function saveCscaTestAction(input: {
  attemptId: unknown;
  expectedRevision: unknown;
  itemKeys: unknown;
  answers: unknown;
  flags: unknown;
  itemSeconds: unknown;
  requestId: unknown;
}): Promise<CscaTestSaveActionResult> {
  await requireStudentPortalActor();
  const keys = input.itemKeys;
  if (
    !isCscaUuid(input.attemptId) || !isCscaUuid(input.requestId) || !revision(input.expectedRevision)
    || !Array.isArray(keys) || keys.length > 200 || !keys.every(isCscaKey)
    || !plainObject(input.answers) || !Array.isArray(input.flags) || !plainObject(input.itemSeconds)
  ) {
    return invalid();
  }
  const payload = testSavePayload(
    keys.map((itemKey) => ({ itemKey })),
    input.answers as Record<string, CscaOptionId>,
    (input.flags as unknown[]).filter((flag): flag is string => typeof flag === "string"),
    Object.fromEntries(Object.entries(input.itemSeconds as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))),
  );
  try {
    return {
      ok: true,
      receipt: await saveCscaTest({
        attemptId: input.attemptId,
        expectedRevision: input.expectedRevision,
        ...payload,
        requestId: input.requestId,
      }),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function completeCscaTestAction(input: {
  attemptId: unknown;
  expectedRevision: unknown;
  requestId: unknown;
}): Promise<CscaTestActionResult> {
  await requireStudentPortalActor();
  if (!isCscaUuid(input.attemptId) || !isCscaUuid(input.requestId) || !revision(input.expectedRevision)) {
    return invalid();
  }
  try {
    const attempt = await completeCscaTest({
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      requestId: input.requestId,
    });
    return { ok: true, attempt };
  } catch (error) {
    return failure(error);
  }
}

export type CscaReviewActionResult = { ok: true; receipt: CscaReviewReceipt } | CscaActionError;

export async function recordCscaReviewAction(input: {
  itemKey: unknown;
  selected: unknown;
  requestId: unknown;
}): Promise<CscaReviewActionResult> {
  await requireStudentPortalActor();
  if (!isCscaKey(input.itemKey) || !isCscaOptionId(input.selected) || !isCscaUuid(input.requestId)) {
    return invalid();
  }
  try {
    const receipt = await recordCscaReview({
      itemKey: input.itemKey,
      selected: input.selected,
      requestId: input.requestId,
    });
    return { ok: true, receipt };
  } catch (error) {
    return failure(error);
  }
}

export type CscaReportActionResult = { ok: true } | CscaActionError;

export async function reportCscaItemAction(input: {
  itemKey: unknown;
  message: unknown;
  requestId: unknown;
}): Promise<CscaReportActionResult> {
  await requireStudentPortalActor();
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (
    !isCscaKey(input.itemKey) || !isCscaUuid(input.requestId)
    || message.length < 1 || message.length > 500
    // Перевод строки можно, прочие управляющие символы нет (§10 контракта).
    || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(message)
  ) {
    return invalid();
  }
  try {
    await reportCscaItem({ itemKey: input.itemKey, message, requestId: input.requestId });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type CscaTargetActionResult = { ok: true; targetSessionKey: string | null } | CscaActionError;

export async function setCscaTargetSessionAction(sessionKey: unknown): Promise<CscaTargetActionResult> {
  await requireStudentPortalActor();
  if (sessionKey !== null && !isCscaKey(sessionKey)) return invalid();
  try {
    const receipt = await setCscaTargetSession(sessionKey);
    return { ok: true, targetSessionKey: receipt.targetSessionKey };
  } catch (error) {
    return failure(error);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
