/**
 * «Следующий шаг» в «Быстром просмотре» — чистая логика редактора без React:
 * быстрые варианты срока, проверка ввода словами для сотрудника и форма
 * команды ровно из полей действия #1054. По ней работает NextStepEditor и
 * unit-тест.
 */
import type { StudentCaseQueueRow } from "../../../lib/platform-student-case-queue-contract.ts";
import { shiftDay } from "../calendar/types.ts";
import { nextFriday } from "../queue/due-bucket.ts";
import type { NextStepDueChoice } from "./students-queue-view.ts";

export type NextStepEditorRow = Pick<StudentCaseQueueRow, "studentCaseId" | "nextAction" | "nextActionDueOn" | "admissionsVersion">;

/** Поля, которые принимает `saveCaseNextActionAction` (#1054), — ровно эти. */
export const NEXT_STEP_FORM_FIELDS = ["student_case_id", "expected_version", "next_action", "next_action_due_on", "request_id"] as const;

/** Быстрый вариант срока для уже записанной даты; своя дата — «Дата…». */
export function nextStepChoiceFor(dueOn: string | null, hasStep: boolean, today: string): NextStepDueChoice {
  if (dueOn === null) return hasStep ? "none" : "today";
  if (dueOn === today) return "today";
  if (dueOn === shiftDay(today, 1)) return "tomorrow";
  if (dueOn === nextFriday(today)) return "friday";
  return "date";
}

/** День срока по выбору; "" — без срока. */
export function nextStepDueFor(choice: NextStepDueChoice, date: string, today: string): string {
  switch (choice) {
    case "today": return today;
    case "tomorrow": return shiftDay(today, 1);
    case "friday": return nextFriday(today);
    case "date": return date;
    case "none": return "";
  }
}

/**
 * Проверка перед отправкой — те же правила, что у SQL и
 * `parseCaseNextActionInput`, словами для сотрудника. null — можно отправлять.
 */
export function nextStepInputError(text: string, choice: NextStepDueChoice, date: string, hasStep: boolean): string | null {
  if (choice === "date" && !date) return "Выберите дату или другой срок.";
  if (text.trim() || choice === "none") return null;
  return hasStep
    ? "Напишите шаг или нажмите «Снять шаг»: срок без шага не сохраняется."
    : "Напишите шаг: срок без шага не сохраняется.";
}

/**
 * Есть ли что сохранять. Срок без текста у дела без шага — не правка:
 * быстрый вариант «Сегодня» у пустого поля не должен включать «Сохранить».
 */
export function nextStepDirty(text: string, due: string, baseline: Readonly<{ text: string; due: string }>): boolean {
  const trimmed = text.trim();
  return trimmed !== baseline.text || (trimmed !== "" && due !== baseline.due);
}

/** Форма команды: ровно поля действия, ожидаемая версия — версия строки из чтения. */
export function nextStepForm(row: NextStepEditorRow, text: string, dueOn: string, requestId: string): FormData {
  const form = new FormData();
  form.set("student_case_id", row.studentCaseId);
  form.set("expected_version", row.admissionsVersion);
  form.set("next_action", text);
  form.set("next_action_due_on", dueOn);
  form.set("request_id", requestId);
  return form;
}

/** Переносы строк (вставка из письма) — пробелами: SQL и действие принимают одну строку. */
export function oneLineStep(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/gu, " ");
}
