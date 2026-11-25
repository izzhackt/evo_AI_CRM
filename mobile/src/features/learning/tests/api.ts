// Тесты (english36, orvis92): каталог, попытка, запись ответов. Записи замораживаются
// (повтор после обрыва идёт тем же p_request_id и телом).
import type { AssessmentAnswers, AssessmentAttempt, AssessmentCatalog, StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { normalizeAssessmentAttempt, normalizeAssessmentCatalog } from "@/features/learning/tests/assessment-decode";
import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";
import { PortalDecodeError } from "@/domain/portal-source";

function decoded<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch {
    throw new PortalDecodeError();
  }
}

export const readAssessmentCatalog = async (t: RpcTransport): Promise<AssessmentCatalog> => decoded(normalizeAssessmentCatalog, await rpcRead(t, "student_assessments_v1"));
export const readAssessmentAttempt = async (t: RpcTransport, attemptId: string): Promise<AssessmentAttempt> =>
  decoded(normalizeAssessmentAttempt, await rpcRead(t, "student_assessment_attempt_v1", { p_attempt_id: attemptId }));

export const startAssessmentWrite = (key: StudentAssessmentKey, id?: string): FrozenWrite => createWrite("start_student_assessment_v1", { p_instrument_key: key }, { requestId: id });
export const saveAssessmentWrite = (i: { attemptId: string; expectedRevision: number; answers: AssessmentAnswers }, id?: string): FrozenWrite =>
  createWrite("save_student_assessment_answers_v1", { p_attempt_id: i.attemptId, p_expected_revision: i.expectedRevision, p_answers: i.answers }, { requestId: id });
export const completeAssessmentWrite = (i: { attemptId: string; expectedRevision: number; answers: AssessmentAnswers }, id?: string): FrozenWrite =>
  createWrite("complete_student_assessment_v1", { p_attempt_id: i.attemptId, p_expected_revision: i.expectedRevision, p_answers: i.answers }, { requestId: id });

/**
 * Сервер ответил на запись успешно, но квитанцию приложение разобрать не смогло. Запись он при этом принял, а ревизия попытки
 * ушла вперёд; без неё следующий ответ студента ушёл бы со старой ревизией и дал ложный конфликт («Тест открыт в другой вкладке»),
 * а «Показать сохранённые ответы» потеряла бы более новый ответ. Поэтому ревизия берётся из сырого ответа, если она в нём видна
 * и относится к этой же попытке (`revision` ниже: число или `null`).
 */
export class UnreadableReceiptError extends PortalDecodeError {
  constructor(readonly revision: number | null) {
    super();
  }
}

function receiptRevision(raw: unknown, attemptId: unknown): number | null {
  if (typeof attemptId !== "string" || typeof raw !== "object" || raw === null) return null;
  const { attemptId: id, revision } = raw as { attemptId?: unknown; revision?: unknown };
  return id === attemptId && typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export const sendAssessment = async (t: RpcTransport, w: FrozenWrite): Promise<AssessmentAttempt> => {
  const raw = await rpcWrite(t, w);
  try {
    return normalizeAssessmentAttempt(raw);
  } catch {
    throw new UnreadableReceiptError(receiptRevision(raw, w.args.p_attempt_id));
  }
};
