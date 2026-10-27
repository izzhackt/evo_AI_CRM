"use client";

import { useLayoutEffect, useRef } from "react";

import { wrapShiftTabFromTitle } from "@/components/kit/detail-sheet-focus";
import { HelpTip } from "@/components/kit/HelpTip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Выезжающая панель для второстепенного: запись списка, старый журнал, сканы, длинные списки. Основной экран
 * остаётся коротким (CLAUDE.md, «Плотность»). Открывается состоянием (`open` + `onOpenChange`: строка таблицы,
 * плитка) или своей кнопкой (`trigger`). Действия записи — в `footer`; существующие формы и серверные действия
 * вкладываются внутрь как есть. Esc и крестик закрывают; фокус возвращается на то, что открыло панель: на
 * свою кнопку `trigger` (это делает Radix), а при открытии состоянием (строка таблицы, карточка) — на элемент,
 * который был в фокусе в момент открытия (запоминается здесь: у Radix без `trigger` вернуть фокус некуда и он
 * уходил бы в начало страницы).
 *
 * Фокус при открытии: на название панели (`tabIndex=-1`; рамки у неё нет: это не элемент управления), а не на первый попавшийся элемент. Первым в панели
 * стоит прокручиваемая область (`tabIndex=0`), и при открытии с клавиатуры рамка фокуса охватывала бы всё тело панели, обрезанная
 * её краем. Читалка так сразу зачитывает название и описание. Кто уже поставил фокус внутрь панели сам, того не трогаем.
 * Область принимает фокус клавишей Tab, рамка у неё внутри (снаружи её срезает край панели). Shift+Tab с названия идёт на
 * последний управляемый элемент панели (`wrapShiftTabFromTitle`): сам Radix круг от названия не замыкает.
 *
 * Запись в панели не очищают в `onOpenChange(false)`: 200 мс закрытия панель ещё видна, и пустая шапка мигала
 * бы. Держат последнюю выбранную запись в состоянии, а открыта ли панель — отдельным флагом (`KitTable`).
 */
export function DetailSheet({
  title,
  description,
  help,
  helpLabel,
  trigger,
  open,
  onOpenChange,
  onCloseAutoFocus,
  footer,
  onEscapeKeyDown,
  side = "right",
  children,
}: Readonly<{
  title: string;
  /** Читается вслух при открытии, на экране тоже строка под заголовком — одна короткая, не абзац. */
  description?: string;
  /** Пояснение к панели — за «?». */
  help?: React.ReactNode;
  helpLabel?: string;
  /** Своя кнопка открытия (`<Button>`); без неё панель управляется `open`. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Перед возвратом фокуса при закрытии; `preventDefault()` оставляет фокус как есть (панель закрыта ссылкой на место страницы). */
  onCloseAutoFocus?: (event: Event) => void;
  footer?: React.ReactNode;
  /** Esc закрывает панель; страница с полями и окнами подтверждения в ней решает сама, когда не закрывать: `preventDefault()` оставляет панель. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  side?: "right" | "bottom";
  children: React.ReactNode;
}>) {
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const hasTrigger = Boolean(trigger);
  // Слой, а не обычный эффект: фокус уходит в панель в эффектах Radix, раньше него нужно успеть запомнить, откуда.
  useLayoutEffect(() => {
    if (!open || hasTrigger) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [open, hasTrigger]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side={side}
        {...(description ? {} : { "aria-describedby": undefined })}
        onEscapeKeyDown={onEscapeKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const panel = event.currentTarget;
          if (panel instanceof Node && panel.contains(document.activeElement)) return;
          heading.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const target = opener.current;
          opener.current = null;
          if (event.defaultPrevented) return;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={cn("gap-0", side === "right" && "data-[side=right]:sm:max-w-lg")}
      >
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle ref={heading} tabIndex={-1} onKeyDown={wrapShiftTabFromTitle} className="min-w-0 focus-visible:outline-none!">{title}</SheetTitle>
            {help ? <HelpTip label={helpLabel ?? `Пояснение: ${title}`}>{help}</HelpTip> : null}
          </div>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <ScrollArea className="flex-1" viewportProps={{ tabIndex: 0, role: "region", "aria-label": title, className: "focus-visible:-outline-offset-2! focus-visible:shadow-none!" }}>
          <div className="px-5 py-4">{children}</div>
        </ScrollArea>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
