import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Пустое место виджета: что здесь пусто и (если есть) что сделать. Данных нет — это честное пустое
 * состояние, а не выдуманные строки. `danger` — когда причина пустоты ошибка (она остаётся на виду).
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  tone = "neutral",
  className,
}: Readonly<{
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}>) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}
    >
      {Icon ? (
        <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-3">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <p className={cn("t-item", tone === "danger" ? "text-danger" : "text-fg")}>{title}</p>
      {description ? <p className="t-body-compact max-w-[56ch] text-fg-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
