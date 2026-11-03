/**
 * Рейл кабинета свёрнут до значков или развёрнут (03.11.2026, кнопка в шапке
 * рейла по образцу кабинета пользователя). Выбор живёт в cookie этого
 * устройства, как тема: layout читает её на сервере, поэтому рейл сразу
 * рисуется нужной ширины, без скачка после гидратации. Только удобство, без
 * данных студента; путь `/portal`, 1 год, SameSite=Lax. Модуль клиент-безопасный.
 */
export const PORTAL_RAIL_COOKIE = "portal_rail";
export const PORTAL_RAIL_COOKIE_PATH = "/portal";
export const PORTAL_RAIL_COOKIE_MAX_AGE = 31_536_000;

/** Свёрнут только при точном "collapsed"; всё остальное значит развёрнутый рейл. */
export function portalRailCollapsed(value: string | null | undefined): boolean {
  return value === "collapsed";
}

/** Записывает выбор в cookie (вызывается из обработчика кнопки). */
export function writePortalRailChoice(collapsed: boolean): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${PORTAL_RAIL_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=${PORTAL_RAIL_COOKIE_PATH}; max-age=${PORTAL_RAIL_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}
