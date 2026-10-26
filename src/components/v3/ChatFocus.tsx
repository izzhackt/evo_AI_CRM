"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { chatFocusEscapeExits, readChatFocus, subscribeChatFocus, writeChatFocus } from "@/lib/v3/chat-focus";

/**
 * «На весь экран» чата «Поручить» (решение владельца 26.10.2026).
 *
 * Состояние держит оболочка (`AppShell` через `useChatFocusController`): она
 * прячет боковое меню. Кнопка стоит в шапке страницы агента и говорит с
 * оболочкой через этот контекст. Меню прячется, только пока кнопка на экране —
 * она единственный выход, а у экранов «агент недоступен», «не найден» и
 * загрузки её нет. Выбор запоминается для браузера (`chat-focus.ts`); вне
 * вкладки «Поручить» меню на месте, а при возвращении на неё режим снова включён.
 */
export type ChatFocusValue = Readonly<{
  /** Сотрудник выбрал «На весь экран» (запомнено); показывается ли режим, решает оболочка. */
  on: boolean;
  toggle: () => void;
  /** Кнопка появилась на экране; возвращённая функция вызывается, когда она ушла. */
  attach: () => () => void;
}>;

const ChatFocusContext = createContext<ChatFocusValue | null>(null);
export const ChatFocusProvider = ChatFocusContext.Provider;

/** Оболочка: `active` — меню прячется сейчас; `value` — для `ChatFocusProvider`. */
export function useChatFocusController(chatRoute: boolean): Readonly<{ active: boolean; value: ChatFocusValue }> {
  // Сервер и первая отрисовка в браузере — «выключено»: разметка совпадает с серверной, выбор подхватывается сразу после.
  const on = useSyncExternalStore(subscribeChatFocus, readChatFocus, () => false);
  const [buttons, setButtons] = useState(0);
  const attach = useCallback(() => {
    setButtons((count) => count + 1);
    return () => setButtons((count) => count - 1);
  }, []);
  const toggle = useCallback(() => writeChatFocus(!readChatFocus()), []);
  const value = useMemo(() => ({ on, toggle, attach }), [on, toggle, attach]);
  return { active: on && chatRoute && buttons > 0, value };
}

/**
 * Кнопка в шапке чата: «На весь экран» ↔ «Свернуть». Обычная кнопка без
 * `aria-pressed`: подпись называет действие, которое она выполнит, и совпадает с
 * именем для чтеца экрана. Кнопка-переключатель с `aria-pressed` не меняет имя
 * вместе с состоянием (WAI-ARIA APG) — иначе чтец скажет «Свернуть, нажата»,
 * будто включено «свёрнуто». Esc тоже сворачивает, если фокус не в поле ввода.
 * На телефоне (<768 px) чат и так занимает экран — кнопки там нет.
 */
export function ChatFocusToggle({ className }: Readonly<{ className?: string }>) {
  const focus = useContext(ChatFocusContext);
  const attach = focus?.attach;
  const on = focus?.on ?? false;
  const toggle = focus?.toggle;

  // До отрисовки, а не после: меню прячется в том же кадре, в котором кнопка появилась.
  useLayoutEffect(() => attach?.(), [attach]);

  useEffect(() => {
    if (!on || !toggle) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!chatFocusEscapeExits(event, document)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [on, toggle]);

  if (!focus) return null;
  return (
    <button
      type="button"
      onClick={focus.toggle}
      data-testid="v3-aia-focus-toggle"
      className={cn("v3-choice", QUEUE_SECONDARY, "max-md:hidden", className)}
    >
      <Icon name={on ? "minimize" : "maximize"} size={18} className="shrink-0" />
      {on ? "Свернуть" : "На весь экран"}
    </button>
  );
}
