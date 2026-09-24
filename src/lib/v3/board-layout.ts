/**
 * Доски (воронки) — экраны во всю ширину и высоту окна (решение владельца
 * 25.09.2026). На них боковое меню при ширине окна 768–1535 px сворачивается
 * до рейки из иконок, чтобы все колонки встали без прокрутки вбок. Решение
 * принимается по адресу (оболочка рендерится на сервере с тем же `pathname`)
 * и медиазапросом CSS, поэтому вид не мигает при загрузке.
 */
export const BOARD_ROUTES = ["/v3/pipeline", "/v3/admissions-pipeline"] as const;

export function isBoardRoute(pathname: string | null | undefined): boolean {
  return BOARD_ROUTES.some((route) => pathname === route);
}
