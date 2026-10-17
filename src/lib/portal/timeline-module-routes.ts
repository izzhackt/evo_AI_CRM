import type { TimelineAppModule } from "./country-timeline.ts";

/**
 * Маршруты модулей кабинета для ссылок «Пути поступления» (контракт §3 п. 6).
 * Раздел CSCA в кабинете есть (S5, `src/app/(portal)/portal/csca/page.tsx`),
 * поэтому шаг экзаменов Китая ведёт на него, а не на https://csca.cn. Модуль,
 * которого здесь нет, остаётся внешней ссылкой на `url` шага. Тест
 * tests/portal-country-timeline-ui.test.mjs сверяет этот список с файлами
 * маршрутов: ключ без страницы и страница без ключа его роняют, поэтому ссылка
 * не уведёт на несуществующую страницу.
 */
export const TIMELINE_MODULE_ROUTES: Readonly<Partial<Record<TimelineAppModule, string>>> = Object.freeze({
  csca: "/portal/csca",
});
