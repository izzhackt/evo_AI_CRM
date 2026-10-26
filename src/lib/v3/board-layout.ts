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
 * Экраны высотой в окно: доски, переписка WhatsApp и «Чат» ИИ-агента
 * (вкладка `command` страницы агента — чат, решение владельца 23.10.2026;
 * с 26.10.2026 она по умолчанию, адрес без `?tab=`). От 768 px правая часть оболочки — колонка высотой в окно,
 * страница забирает её целиком (`PartShell` с `fill` или `width="board"`,
 * у «Поручить» — `AgentChatShell`), прокручиваются её списки и лента, а не
 * страница. Ниже 768 px страница идёт обычным потоком (чат «Поручить» —
 * между строкой логотипа и вкладками, см. v3.css).
 */
export const FILL_ROUTES = [...BOARD_ROUTES, "/v3/inbox"] as const;

const AI_AGENT_PAGE = /^\/v3\/ai-agents\/[a-z0-9-]+$/u;

/**
 * Вкладка страницы агента без `?tab=` — «Чат» (`AI_AGENT_DEFAULT_TAB` в `ai-agents-view.ts`,
 * решение владельца 26.10.2026). Здесь своя копия, чтобы оболочка не тянула модуль агентов;
 * совпадение проверяет тест (tests/v3-chat-focus.test.mjs).
 */
export const AI_AGENT_SHELL_DEFAULT_TAB = "command";

/**
 * Чат страницы агента (`?tab=command` или адрес без `?tab=`): единственный экран, где можно
 * спрятать боковое меню («На весь экран», `chat-focus.ts`); на других вкладках
 * агента и других страницах режима нет.
 */
export function isAiAgentChatRoute(pathname: string | null | undefined, tab?: string | null): boolean {
  return (tab ?? AI_AGENT_SHELL_DEFAULT_TAB) === "command" && typeof pathname === "string" && AI_AGENT_PAGE.test(pathname);
}

/** `tab` — значение `?tab=` адреса: страница агента занимает окно только на «Чате» (в том числе без `?tab=`). */
export function isFillRoute(pathname: string | null | undefined, tab?: string | null): boolean {
  if (FILL_ROUTES.some((route) => pathname === route)) return true;
  return isAiAgentChatRoute(pathname, tab);
}
