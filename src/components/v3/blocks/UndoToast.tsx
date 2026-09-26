"use client";

import { useEffect, useRef } from "react";

export type UndoToastItem = Readonly<{
  /** Ключ строки, которую можно вернуть (`data-queue-row`): по нему работает возврат фокуса. */
  key: string;
  /** Что произошло: «Задача «…» завершена.» */
  message: string;
  /** Команда отмены идёт: кнопка ждёт ответа сервера. */
  pending: boolean;
  /** Отмена не прошла — причина словами и способ исправить. */
  error: string | null;
  /** Новая строка забирает фокус клавиатуры на свою «Отменить» (как строка «Задач» до Э1.3). */
  focus: boolean;
  onUndo: () => void;
}>;

/**
 * «Отменить» нового облика (Э1.3): короткая строка у нижнего края окна в
 * верхнем слое (popover API — ни прокрутка, ни открытая панель её не
 * закрывают). Только там, где есть настоящая обратная команда; срок и сама
 * команда — у вызывающего (6 секунд «Задач»). Пока фокус или указатель на
 * строке, срок стоит (`onHold(true)`), и идёт дальше, когда они ушли
 * (`onHold(false)`): фокус приходит сюда после каждого завершения, и
 * клавиатуре с читалкой не приходится успевать за таймером. Появляется за 160 мс,
 * при `prefers-reduced-motion` — без движения (v3.css). Объявление для читалки
 * делает живая область списка: строка его не повторяет. Клавиши очереди
 * (j/k, ↑/↓, «/», «?», Shift+Enter, Esc панели) при открытой строке работают:
 * она помечена `data-queue-passive` (`popoverBlocksQueueKeys`), а j/k с её
 * «Отменить» продолжают от завершённой строки.
 */
export function UndoToast({
  items,
  label = "Можно отменить",
  onHold,
}: Readonly<{
  items: readonly UndoToastItem[];
  label?: string;
  /** Пауза сроков: true — фокус или указатель на строке, false — ушли. */
  onHold?: (held: boolean) => void;
}>) {
  const regionRef = useRef<HTMLDivElement>(null);
  const seen = useRef<ReadonlySet<string>>(new Set());
  const inside = useRef({ focus: false, pointer: false });
  const sync = () => onHold?.(inside.current.focus || inside.current.pointer);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const open = region.matches(":popover-open");
    if (items.length > 0 && !open) region.showPopover();
    if (items.length === 0 && open) region.hidePopover();
    // Новая строка, которой положен фокус, получает его на «Отменить».
    const fresh = items.filter((item) => item.focus && !seen.current.has(item.key));
    seen.current = new Set(items.map((item) => item.key));
    const target = fresh.at(-1);
    if (target) region.querySelector<HTMLElement>(`[data-undo-row="${CSS.escape(target.key)}"]`)?.focus();
    // Строки ушли вместе с фокусом или под указателем — пауза снимается:
    // скрытая строка событий ухода не присылает.
    inside.current = items.length === 0
      ? { focus: false, pointer: false }
      : { ...inside.current, focus: region.contains(document.activeElement) };
    onHold?.(inside.current.focus || inside.current.pointer);
  }, [items, onHold]);

  return (
    <div
      ref={regionRef}
      popover="manual"
      role="group"
      aria-label={label}
      className="v3-toasts"
      data-testid="v3-undo-toasts"
      data-queue-passive=""
      onFocus={() => { inside.current.focus = true; sync(); }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        inside.current.focus = false;
        sync();
      }}
      onPointerEnter={() => { inside.current.pointer = true; sync(); }}
      onPointerLeave={() => { inside.current.pointer = false; sync(); }}
    >
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="v3-toast">
            <p className="min-w-0 flex-1 break-words t-body-compact">{item.message}</p>
            <button
              type="button"
              data-queue-undo=""
              data-undo-row={item.key}
              disabled={item.pending}
              onClick={item.onUndo}
              className="v3-toast-action t-label"
            >
              Отменить
            </button>
            {item.error ? <p role="alert" className="w-full t-body-compact">{item.error}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
