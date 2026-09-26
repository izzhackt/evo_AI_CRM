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

/**
 * Экраны высотой в окно: доски и переписка WhatsApp. От 768 px правая часть
 * оболочки — колонка высотой в окно: верхняя панель сверху, страница
 * забирает остаток (`PartShell` с `fill` или `width="board"`), прокручиваются
 * её списки и лента, а не страница. Прежнее `h-dvh` у `fill` стояло под
 * верхней панелью 64 px, и пустая страница прокручивалась на её высоту
 * (аудит 26.09). Ниже 768 px страница идёт обычным потоком.
 */
export const FILL_ROUTES = [...BOARD_ROUTES, "/v3/inbox"] as const;

export function isFillRoute(pathname: string | null | undefined): boolean {
  return FILL_ROUTES.some((route) => pathname === route);
}
