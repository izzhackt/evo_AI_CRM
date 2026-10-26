"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Значок «?» — сюда уезжают пояснения с экрана (решение владельца 27.10.2026): на экране остаются
 * заголовки, данные и кнопки. Открывается нажатием (Enter/Space, касание), закрывается Esc или щелчком
 * мимо; подсказка по наведению на телефоне не открылась бы. Предупреждения об ошибках и рисках
 * сюда не прячут — они остаются на виду.
 */
export function HelpTip({
  children,
  label = "Пояснение",
  align = "start",
  className,
}: Readonly<{
  children: React.ReactNode;
  /** Имя кнопки для читалки. */
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
}>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-input bg-surface t-caption text-fg-2 transition-colors after:absolute after:-inset-2.5 hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg motion-reduce:transition-none",
            className,
          )}
        >
          <span aria-hidden="true">?</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} aria-label={label} className="w-80">
        <div className="text-fg-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
