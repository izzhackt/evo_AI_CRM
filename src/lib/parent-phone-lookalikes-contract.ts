import { parseSalesUuid } from "./platform-sales-register-contract.ts";

/**
 * Подсказка «Похоже на» (#1198, пункт 2; решение владельца 18.10.2026, миграция 302):
 * номер лида или дела записан как телефон родителя в анкете другого студента.
 * Карточки не объединяются и не меняются, сотрудник проверяет сам. Это ответ
 * `platform.read_parent_phone_lookalikes_v1` и слова подсказки. Любое расхождение
 * формы ответа (лишний ключ, чужой тип, больше пяти дел) даёт `null`: экран говорит
 * «не проверено», а не рисует совпадение наугад. Номер и имя родителя в ответ не
 * входят, и парсер отвергает любой ключ сверх трёх.
 */
export const PARENT_PHONE_LOOKALIKES_LIMIT = 5;

export type ParentPhoneRelation = "father" | "mother" | "both";

export type ParentPhoneLookalike = Readonly<{
  studentCaseId: string;
  studentName: string;
  relation: ParentPhoneRelation;
}>;

export type ParentPhoneSubject = Readonly<{ leadId: string; studentCaseId?: never }> | Readonly<{ studentCaseId: string; leadId?: never }>;

export type ParentPhoneLookalikesState =
  | Readonly<{ status: "available"; matches: readonly ParentPhoneLookalike[] }>
  | Readonly<{ status: "unavailable" }>;

export const PARENT_PHONE_LOOKALIKES_WORDS = {
  label: "Похоже на",
  kind: "дело студента",
  note: "Карточки не объединены. Проверьте вручную, тот ли это человек.",
  unavailable: "Совпадения по номеру не проверены. Обновите страницу.",
} as const;

const RELATION_TEXT: Readonly<Record<ParentPhoneRelation, string>> = {
  mother: "номер записан в анкете как телефон мамы",
  father: "номер записан в анкете как телефон папы",
  both: "номер записан в анкете как телефон мамы и папы",
};

export function parentPhoneRelationText(relation: ParentPhoneRelation): string {
  return RELATION_TEXT[relation];
}

function isRelation(value: unknown): value is ParentPhoneRelation {
  return value === "father" || value === "mother" || value === "both";
}

/** Адрес дела в CRM: страница профиля с `?case=`. */
export function parentPhoneCaseHref(studentCaseId: string): string {
  return `/v3/profile?case=${encodeURIComponent(studentCaseId)}`;
}

/** Ровно массив до пяти `{studentCaseId, studentName, relation}`; иначе `null`. */
export function parseParentPhoneLookalikes(value: unknown): readonly ParentPhoneLookalike[] | null {
  if (!Array.isArray(value) || value.length > PARENT_PHONE_LOOKALIKES_LIMIT) return null;
  const matches: ParentPhoneLookalike[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const keys = Object.keys(row);
    if (keys.length !== 3 || !["studentCaseId", "studentName", "relation"].every((key) => keys.includes(key))) return null;
    const studentCaseId = parseSalesUuid(row.studentCaseId);
    const name = row.studentName;
    if (!studentCaseId || seen.has(studentCaseId) || !isRelation(row.relation)
      || typeof name !== "string" || name.trim() === "" || name.length > 300 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
    seen.add(studentCaseId);
    matches.push(Object.freeze({ studentCaseId, studentName: name.trim(), relation: row.relation }));
  }
  return Object.freeze(matches);
}
