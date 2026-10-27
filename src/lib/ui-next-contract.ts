/**
 * Переключатель «Новый вид» (решение владельца 27.10.2026): новый интерфейс экранов из набора виджетов сначала
 * включается только настоящим системным администратором, всем сотрудникам — позже, по решению владельца.
 *
 * Правило одно и здесь: «новый вид» видит настоящий администратор (`systemRole === "admin"`), не в просмотре
 * роли (`presentationRole === null`), с cookie `evo_ui=next`. Остальным cookie ничего не даёт, даже если она есть.
 * Это про вид, а не про права: чтения, права, серверные действия и адреса экранов от переключателя не зависят.
 * Без зависимостей от Next, чтобы правило проверялось обычными тестами; чтение cookie — в `ui-next.ts`.
 */
export const NEXT_UI_COOKIE = "evo_ui";
export const NEXT_UI_COOKIE_VALUE = "next";
/** Выбор помнится полгода: переключатель — рабочий инструмент владельца, а не сессия. */
export const NEXT_UI_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export type NextUiActor = Readonly<{
  systemRole: "admin" | "staff";
  presentationRole: string | null;
}>;

/** Показывать переключатель и разрешать включение: настоящий администратор, не просмотр роли. */
export function canUseNextUi(actor: NextUiActor): boolean {
  return actor.systemRole === "admin" && actor.presentationRole === null;
}

/** Рисовать «Новый вид»: можно ли и включён ли (cookie). */
export function isNextUiFor(actor: NextUiActor, cookieValue: string | null | undefined): boolean {
  return canUseNextUi(actor) && cookieValue === NEXT_UI_COOKIE_VALUE;
}

const RETURN_PATH = /^\/v3(?:\/[A-Za-z0-9._~%-]+)*(?:\?[A-Za-z0-9._~%!$&'()*+,;=:@/?-]*)?$/;

/** Куда вернуться после переключения: только адрес внутри `/v3` (иначе — «Сегодня»), без внешних ссылок. */
export function nextUiReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 600 || value.includes("//") || value.includes("..")) return "/v3/main";
  return RETURN_PATH.test(value) ? value : "/v3/main";
}
