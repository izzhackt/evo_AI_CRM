// Общие части тестов «Главной»: RPC-ответы студента и «сегодня» без настоящих часов. Данные придуманы.
import { NOTIFICATION_ROW, OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { universityRow, uuidN } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";
import cscaHome from "@/test-fixtures/csca-home-fresh.json";

export const saved = (country: string) => ({ country, source: "saved", savedAt: "2026-11-01T08:00:00+00:00" });
export const favorites = (n: number) => Array.from({ length: n }, (_, i) => ({ institutionId: uuidN(i + 1), createdAt: "2026-10-01T00:00:00+00:00" }));
export const byIds = (args?: Record<string, unknown>) => ({ items: ((args?.p_institution_ids as string[]) ?? []).map((id) => universityRow(Number(id.slice(-12)))), nextOffset: null });

/** Ответы RPC студента на сопровождении: дело, платёж, новость, выбор страны, два вуза, главная CSCA и индекс каталога. */
export function homeHandlers(country = "MY", extra: Record<string, unknown> = {}) {
  return {
    student_portal_overview_v2: [OVERVIEW_ROW],
    student_portal_finance_v2: [PAYMENT_ROW],
    student_portal_notifications_v2: [NOTIFICATION_ROW],
    student_country_choice_v1: saved(country),
    student_university_favorites_v1: favorites(2),
    student_university_catalog_by_ids_v1: byIds,
    learning_track_home_v1: cscaHome,
    student_university_index_v1: indexBody(),
    ...extra,
  };
}

/** Своя анкета до договора (approved): отправлена 10.11, одобрена 18.11. */
export const APPLICATION_ROW = Object.freeze({
  id: uuidN(7),
  status: "approved",
  revision: 1,
  email: "student@example.org",
  submitted_at: "2026-11-10T04:00:00+00:00",
  decided_at: "2026-11-18T09:00:00+00:00",
  decision_reason: null,
});

const REAL_TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "performance"] as const;

/**
 * «Сегодня» теста: подменяются только часы `Date` (таймеры настоящие, `findBy*` и запросы работают как обычно).
 * Дела фикстуры: паспорт до 12.09.2026 03:00 UTC, платёж до 01.10.2026 08:00 UTC.
 */
export function setNow(iso: string): void {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...REAL_TIMERS] });
}

/** Переставить «сегодня» уже внутри теста (после `setNow` в `beforeEach`). */
export function moveNow(iso: string): void {
  jest.setSystemTime(new Date(iso));
}

export function restoreNow(): void {
  jest.useRealTimers();
}
