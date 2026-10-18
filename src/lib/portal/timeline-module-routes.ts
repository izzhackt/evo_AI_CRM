import type { TimelineAppModule } from "./country-timeline.ts";

/**
 * Маршруты модулей кабинета для ссылок «Пути поступления» (контракт §3 п. 6).
 * Шаг экзаменов Китая ведёт в раздел CSCA кабинета, а csca.cn остаётся
 * адресом запасного пути: если ключа модуля здесь нет, `selectCountryTimeline`
 * отдаёт внешнюю ссылку https://csca.cn. Тест
 * tests/portal-country-timeline-ui.test.mjs сверяет этот список с файлами
 * маршрутов, поэтому ссылка не уведёт на несуществующую страницу.
 *
 * На iPhone тот же набор ключей (`CountryTimelineModules.routes` в
 * ios/EVOAdmissions/Services/CountryTimeline.swift): веб и приложение
 * добавляют модуль одним шагом, иначе пропадёт паритет.
 */
export const TIMELINE_MODULE_ROUTES: Readonly<Partial<Record<TimelineAppModule, string>>> = Object.freeze({
  csca: "/portal/csca",
});
