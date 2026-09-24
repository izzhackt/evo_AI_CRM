"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";

import { placeMenu, type MenuPlacement } from "@/components/v3/board/menu-position";

/**
 * Всплывающее меню в top layer (popover API). Прежнее меню карточки было
 * `absolute` внутри колонки с `overflow-y-auto` и обрезалось её высотой; здесь
 * меню живёт в верхнем слое документа и встаёт `position: fixed` рядом с
 * кнопкой, поэтому колонка, доска или рейка меню его не обрезают.
 *
 * `popover="auto"` даёт закрытие по Escape и по щелчку снаружи и возвращает
 * фокус на кнопку. Кнопка связана с меню через `popoverTarget`, поэтому
 * повторный щелчок по ней закрывает меню, а не открывает заново.
 */
export function TopLayerMenu({
  label,
  trigger,
  triggerClassName,
  triggerProps,
  menuClassName,
  menuLabel,
  placement = "bottom-end",
  testId,
  onKeyDown,
  onOpenChange,
  children,
}: Readonly<{
  /** Доступное имя кнопки. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  triggerProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type" | "aria-label" | "aria-expanded" | "popoverTarget">;
  menuClassName: string;
  /** Имя области меню для читалки; по умолчанию — имя кнопки. */
  menuLabel?: string;
  placement?: MenuPlacement;
  testId?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const place = useCallback(() => {
    const button = triggerRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const position = placeMenu(
      button.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    menu.style.top = `${position.top}px`;
    menu.style.left = `${position.left}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
  }, [placement]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    // Колонка или страница прокрутились — меню остаётся у своей кнопки.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Закрыть после выбора пункта. Меню ищется по id, а не через ref: функция
  // уходит в содержимое меню, которое рендерится вместе с ним.
  const close = useCallback(() => {
    const menu = typeof document === "undefined" ? null : document.getElementById(id);
    if (menu && typeof menu.hidePopover === "function" && menu.matches(":popover-open")) menu.hidePopover();
  }, [id]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        aria-label={label}
        aria-expanded={open}
        className={triggerClassName}
        {...triggerProps}
      >
        {trigger}
      </button>
      <div
        ref={menuRef}
        id={id}
        popover="auto"
        role="group"
        aria-label={menuLabel ?? label}
        data-testid={testId}
        onBeforeToggle={(event) => {
          // Кадр отрисовки начинается после этого обработчика: к нему меню
          // уже в верхнем слое и измеримо, поэтому оно не мелькает не на месте.
          if (event.newState === "open") requestAnimationFrame(place);
        }}
        onToggle={(event) => {
          const next = event.newState === "open";
          setOpen(next);
          onOpenChange?.(next);
        }}
        onKeyDown={onKeyDown}
        className={`inset-auto m-0 overflow-y-auto ${menuClassName}`}
      >
        {children(close)}
      </div>
    </>
  );
}
