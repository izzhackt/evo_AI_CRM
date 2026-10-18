import { parseSalesUuid } from "./platform-sales-register-contract.ts";

/**
 * Подсказка «Похоже на» (#1198, пункт 2; решение владельца 18.10.2026, миграция 306):
 * номер лида или дела записан как телефон родителя в анкете другого студента.
 * Карточки не объединяются и не меняются, сотрудник проверяет сам. Это ответ
 * `platform.read_parent_phone_lookalikes_v1` и слова подсказки.
 *
 * Два уровня решает база для каждого сотрудника, клиент скрытых полей не получает:
 * `matches` это дела, которые сотрудник читает целиком вместе с анкетой (имя и ссылка,
 * до пяти), `restricted` значит, что есть ещё совпадение в деле, которое сотрудник не
 * читает (без имени, номера дела, ссылки и количества), `more` значит, что читаемых дел
 * больше пяти. Любое расхождение формы ответа (лишний ключ, чужой тип, больше пяти дел,
 * `more` без пяти дел) даёт `null`: экран говорит «не проверено», а не рисует
 * совпадение наугад. Номер и имя родителя в ответ не входят, и парсер отвергает любой
 * ключ сверх трёх.
 */
export const PARENT_PHONE_LOOKALIKES_LIMIT = 5;

export type ParentPhoneRelation = "father" | "mother" | "both";

export type ParentPhoneLookalike = Readonly<{
  studentCaseId: string;
  studentName: string;
  relation: ParentPhoneRelation;
}>;

export type ParentPhoneSubject = Readonly<{ leadId: string; studentCaseId?: never }> | Readonly<{ studentCaseId: string; leadId?: never }>;

/** Ответ базы: читаемые дела, есть ли ещё нечитаемое совпадение, больше ли читаемых, чем показано. */
export type ParentPhoneLookalikesAnswer = Readonly<{
  matches: readonly ParentPhoneLookalike[];
  restricted: boolean;
  more: boolean;
}>;

export type ParentPhoneLookalikesState =
  | Readonly<{ status: "available" } & ParentPhoneLookalikesAnswer>
  | Readonly<{ status: "unavailable" }>;

/** Нет совпадений или нет права что-либо показывать: ничего не рисуется. */
export const PARENT_PHONE_LOOKALIKES_NONE: ParentPhoneLookalikesState = Object.freeze({
  status: "available", matches: Object.freeze([]), restricted: false, more: false,
});

export const PARENT_PHONE_LOOKALIKES_WORDS = {
  label: "Похоже на",
  kind: "дело студента",
  note: "Карточки не объединены. Проверьте вручную, тот ли это человек.",
  unavailable: "Совпадения по номеру не проверены. Обновите страницу.",
  // Уровень два: сотрудник читает лид или дело, но не найденное дело. Ни имени, ни ссылки, ни числа.
  restricted: "Номер совпадает с телефоном родителя в другом деле. Уточните у руководителя поступления.",
  // То же рядом с читаемыми делами: «и в другом деле».
  restrictedBeside: "Номер совпадает с телефоном родителя и в другом деле. Уточните у руководителя поступления.",
  // Читаемых дел больше пяти: показаны первые пять.
  more: `Показаны первые ${PARENT_PHONE_LOOKALIKES_LIMIT}, дел с этим номером больше.`,
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
export function parseParentPhoneMatches(value: unknown): readonly ParentPhoneLookalike[] | null {
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

/**
 * Ровно объект `{matches, restricted, more}`: `matches` по правилам выше, два булевых значения,
 * и `more` только при полных пяти делах (иначе ответ противоречит сам себе); иначе `null`.
 */
export function parseParentPhoneLookalikes(value: unknown): ParentPhoneLookalikesAnswer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const answer = value as Record<string, unknown>;
  const keys = Object.keys(answer);
  if (keys.length !== 3 || !["matches", "restricted", "more"].every((key) => keys.includes(key))) return null;
  if (typeof answer.restricted !== "boolean" || typeof answer.more !== "boolean") return null;
  const matches = parseParentPhoneMatches(answer.matches);
  if (!matches || (answer.more && matches.length !== PARENT_PHONE_LOOKALIKES_LIMIT)) return null;
  return Object.freeze({ matches, restricted: answer.restricted, more: answer.more });
}
