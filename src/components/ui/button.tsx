import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Кнопка «Нового вида». Вид — как у `btnCls`/`btnGhostCls` прежнего набора: 44 px, роль `t-label`,
 * недоступное состояние — токены поверхности без прозрачности. Сплошной красный (`default`) — одно главное
 * действие страницы; остальное — `outline`/`ghost`. Размеры shadcn `xs`/`sm` оставлены ради блоков из
 * реестров, но тоже 44 px: меньше этой цели в CRM нет.
 */
const buttonVariants = cva(
  "inline-flex h-11 min-w-11 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border px-4 t-label transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3 disabled:active:scale-100 aria-invalid:border-danger motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "v3-raised border-primary bg-primary text-primary-foreground hover:border-accent-2 hover:bg-accent-2",
        outline:
          "v3-raised border-input bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg",
        secondary: "border-transparent bg-surface-2 text-fg hover:bg-surface-3",
        ghost:
          "border-transparent bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg",
        destructive:
          "v3-raised border-input bg-surface text-fg-2 hover:border-danger hover:bg-danger-weak hover:text-danger",
        link: "border-transparent bg-transparent px-1 text-accent-text underline underline-offset-4 hover:text-fg",
      },
      size: {
        default: "",
        xs: "",
        sm: "",
        lg: "h-12 px-5",
        icon: "size-11 px-0",
        "icon-xs": "size-11 px-0",
        "icon-sm": "size-11 px-0",
        "icon-lg": "size-12 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
