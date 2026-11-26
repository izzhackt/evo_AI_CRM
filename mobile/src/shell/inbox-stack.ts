// Стек вкладки «Входящие» (`app/(app)/messages`): в его основании должен лежать список (`index`). Внутрь стека входят и снаружи:
// колокольчик и ссылка «Что нового» с «Главной» открывают ленту, строка «Что нового» - экран решения, «Написать EVO» - беседу.
// Такой переход expo-router делает БЕЗ якоря (`unstable_settings.anchor` действует при открытии по ссылке и при `withAnchor`),
// поэтому в стеке оказывается один этот экран, а списка под ним нет. Студент уходит «назад» на прежнюю вкладку, но состояние
// вкладки остаётся: нажатие на «Входящие» открывало ленту (или решение, или беседу), и списка не было видно. Здесь - чистые
// правила: когда основания нет и какими действиями вернуть стек к списку. Действия обычные для навигатора (`POP_TO_TOP`,
// `REPLACE`); `RESET` expo-router 58 требует целое состояние навигатора, поэтому им не пользуемся.
export const INBOX_ROOT = "index";

type StackRoute = Readonly<{ key: string; name: string }>;
/** Состояние стека «Входящих», как оно лежит в состоянии вкладок. */
export type InboxStack = Readonly<{ key: string; routes: readonly StackRoute[] }>;

export type InboxStackAction =
  | Readonly<{ type: "POP_TO_TOP"; target: string }>
  | Readonly<{ type: "REPLACE"; payload: Readonly<{ name: string }>; source: string; target: string }>;

/** Стек вкладки «Входящие» из маршрута вкладки; `null`, пока вкладку не открывали (стека ещё нет). */
export function inboxStackOf(route: object | null | undefined): InboxStack | null {
  const state = (route as { state?: { key?: unknown; routes?: unknown } } | null | undefined)?.state;
  if (!state || typeof state.key !== "string" || !Array.isArray(state.routes) || state.routes.length === 0) return null;
  const routes = state.routes.filter((entry): entry is StackRoute => typeof entry?.key === "string" && typeof entry?.name === "string");
  return routes.length === state.routes.length ? { key: state.key, routes } : null;
}

/** В основании стека не список: в него вошли снаружи. */
export function lacksInboxRoot(stack: InboxStack | null): boolean {
  return stack !== null && stack.routes[0]?.name !== INBOX_ROOT;
}

/** Действия, после которых в стеке остаётся один список (пусто, если он уже такой). */
export function inboxToListActions(stack: InboxStack | null): readonly InboxStackAction[] {
  if (!stack) return [];
  const first = stack.routes[0];
  if (!first) return [];
  const actions: InboxStackAction[] = [];
  if (stack.routes.length > 1) actions.push({ type: "POP_TO_TOP", target: stack.key });
  if (first.name !== INBOX_ROOT) actions.push({ type: "REPLACE", payload: { name: INBOX_ROOT }, source: first.key, target: stack.key });
  return actions;
}
