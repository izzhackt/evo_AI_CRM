import type { TimelineAppModule } from "./country-timeline.ts";

/**
 * Маршруты модулей кабинета для ссылок «Пути поступления» (контракт §3 п. 6).
 * Пока раздела CSCA в кабинете нет (S5), ключа `csca` здесь нет, и шаг
 * экзаменов Китая ведёт на https://csca.cn. PR раздела CSCA добавляет
 * `csca: "/portal/csca"` вместе со страницей маршрута; тест
 * tests/portal-country-timeline-ui.test.mjs сверяет этот список с файлами
 * маршрутов, поэтому ссылка не уведёт на несуществующую страницу.
 */
export const TIMELINE_MODULE_ROUTES: Readonly<Partial<Record<TimelineAppModule, string>>> = Object.freeze({});
