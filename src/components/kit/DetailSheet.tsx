"use client";

import { useLayoutEffect, useRef } from "react";

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
  footer,
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
  footer?: React.ReactNode;
  side?: "right" | "bottom";
  children: React.ReactNode;
}>) {
  const opener = useRef<HTMLElement | null>(null);
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
        onCloseAutoFocus={(event) => {
          const target = opener.current;
          opener.current = null;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={cn("gap-0", side === "right" && "data-[side=right]:sm:max-w-lg")}
      >
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="min-w-0">{title}</SheetTitle>
            {help ? <HelpTip label={helpLabel ?? `Пояснение: ${title}`}>{help}</HelpTip> : null}
          </div>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <ScrollArea className="flex-1" viewportProps={{ tabIndex: 0, role: "region", "aria-label": title }}>
          <div className="px-5 py-4">{children}</div>
        </ScrollArea>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
