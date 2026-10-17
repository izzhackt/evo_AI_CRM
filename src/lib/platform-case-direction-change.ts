/**
 * Смена направления дела в «Журнале действий» и в «Истории» дела: форма поля,
 * которое отдают `platform_private.case_direction_change` (миграция «аудит
 * направления») и обе проекции, и его разбор. Файл клиент-безопасный: без
 * server-only и без Supabase, и без собственных зависимостей, кроме списка
 * направлений, потому что его разбирает и `platform-audit.ts`, который
 * запускается без `npm ci` (`scripts/check-platform-audit-journal-contract.mjs`).
 *
 * В поле только коды направлений сотрудников (`ADMISSIONS_DIRECTIONS`): ни версий,
 * ни персональных данных. Код вне пяти (например, IT или CZ) разбор не пропускает:
 * показывать нечего, и сырой код на экран не попадает.
 */
import { ADMISSIONS_DIRECTIONS, type AdmissionsDirection } from "./platform-admissions-playbook-contract.ts";

/** Смена направления: `from` пусто при первой установке. */
export type CaseDirectionChange = Readonly<{
  from: AdmissionsDirection | null;
  to: AdmissionsDirection;
}>;

function direction(value: unknown): AdmissionsDirection | null {
  return typeof value === "string" && (ADMISSIONS_DIRECTIONS as readonly string[]).includes(value)
    ? (value as AdmissionsDirection)
    : null;
}

/**
 * Поле сервера -> смена направления; `null`, если показывать нечего: поля нет,
 * форма не та, `to` не из пяти, `from` задан, но не из пяти, или значения равны.
 * Не бросает: неизвестное значение - не сбой страницы, а событие без значений.
 */
export function parseCaseDirectionChange(value: unknown): CaseDirectionChange | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "from,to") return null;
  const to = direction(record.to);
  if (to === null) return null;
  const from = record.from === null ? null : direction(record.from);
  if (record.from !== null && from === null) return null;
  if (from === to) return null;
  return Object.freeze({ from, to });
}
