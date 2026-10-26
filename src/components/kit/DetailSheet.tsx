"use client";

import { HelpTip } from "@/components/kit/HelpTip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Выезжающая панель для второстепенного: запись списка, старый журнал, сканы, длинные списки. Основной экран
 * остаётся коротким (CLAUDE.md, «Плотность»). Открывается состоянием (`open` + `onOpenChange`: строка таблицы,
 * плитка) или своей кнопкой (`trigger`). Действия записи — в `footer`; существующие формы и серверные действия
 * вкладываются внутрь как есть. Esc и крестик закрывают; фокус возвращается на то, что открыло панель.
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent side={side} {...(description ? {} : { "aria-describedby": undefined })} className="gap-0 sm:max-w-lg">
        <SheetHeader>
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="min-w-0">{title}</SheetTitle>
            {help ? <HelpTip label={helpLabel}>{help}</HelpTip> : null}
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
