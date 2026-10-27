import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Карточка «Нового вида» — та же, что `Card` прежнего набора: волосяная рамка, `--surface`, радиус 10,
 * без тени. Заголовок — роль `t-section`, пояснение — `t-body-compact`. Отступы 20/16 px; `size="sm"` — 16/12.
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card py-4 text-card-foreground data-[size=sm]:gap-2 data-[size=sm]:py-3",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] group-data-[size=sm]/card:px-4 [.border-b]:border-border [.border-b]:pb-3",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  className,
  as: Tag = "div",
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "h2" | "h3" }) {
  return <Tag data-slot="card-title" className={cn("t-section min-w-0 text-fg", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("t-body-compact text-fg-3", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0 px-5 group-data-[size=sm]/card:px-4", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-2 border-t border-border px-5 pt-3 group-data-[size=sm]/card:px-4",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
