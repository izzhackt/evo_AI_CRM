"use server";

import { revalidatePath } from "next/cache";
import { requireStudentPortalActor } from "./student-portal-guards";
import { isAssessmentKey, isAssessmentUuid, parseAssessmentWriteInput, type AssessmentActionResult } from "./student-assessment-contract";
import { readStudentAssessmentAttempt, startStudentAssessment, StudentAssessmentSourceError, writeStudentAssessment } from "./v3/student-assessment-source";

function failure(error: unknown): AssessmentActionResult {
  const code = error instanceof StudentAssessmentSourceError ? error.code : "unavailable";
  const messages = {
    conflict: "Ответы изменились в другой вкладке. Ваш ввод здесь сохранён на экране. Загрузите актуальную попытку перед продолжением.",
    invalid: "Проверьте ответы: для завершения нужно ответить на каждый вопрос. Данные не были изменены.",
    denied: "Доступ к этой попытке недоступен. Войдите в свой кабинет заново.",
    unavailable: "Не удалось подтвердить сохранение. Ответы остались на экране. Повторите запрос перед выходом.",
  };
  return { ok: false, code, message: messages[code] };
}

export async function startStudentAssessmentAction(instrumentKey: unknown, requestId: unknown): Promise<AssessmentActionResult> {
  await requireStudentPortalActor();
  if (!isAssessmentKey(instrumentKey) || !isAssessmentUuid(requestId)) return failure(new StudentAssessmentSourceError("invalid"));
  try {
    const attempt = await startStudentAssessment(instrumentKey, requestId);
    revalidatePath("/portal/tests");
    return { ok: true, attempt };
  } catch (error) { return failure(error); }
}

export async function readStudentAssessmentAttemptAction(attemptId: unknown): Promise<AssessmentActionResult> {
  await requireStudentPortalActor();
  if (!isAssessmentUuid(attemptId)) return failure(new StudentAssessmentSourceError("invalid"));
  try { return { ok: true, attempt: await readStudentAssessmentAttempt(attemptId) }; }
  catch (error) { return failure(error); }
}

export async function saveStudentAssessmentAction(value: unknown): Promise<AssessmentActionResult> {
  await requireStudentPortalActor();
  const input = parseAssessmentWriteInput(value);
  if (!input) return failure(new StudentAssessmentSourceError("invalid"));
  try { return { ok: true, attempt: await writeStudentAssessment(input, false) }; }
  catch (error) { return failure(error); }
}

export async function completeStudentAssessmentAction(value: unknown): Promise<AssessmentActionResult> {
  await requireStudentPortalActor();
  const input = parseAssessmentWriteInput(value);
  if (!input) return failure(new StudentAssessmentSourceError("invalid"));
  try {
    const attempt = await writeStudentAssessment(input, true);
    revalidatePath("/portal/tests");
    return { ok: true, attempt };
  } catch (error) { return failure(error); }
}
