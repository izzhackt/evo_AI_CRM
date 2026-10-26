import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Чип состояния. Тот же вид, что `.v3-chip` (v3.css): слово обязательно, цвет его только подкрепляет,
 * красный — только проблема (`danger`). `neutral` (он же `default`) — серое слово с контуром: если для значения
 * нет настоящего состояния, берут его, а не зелёный «чтобы было живее». Имена shadcn (`secondary`,
 * `destructive`, `outline`) оставлены для блоков из реестров.
 */
const badgeVariants = cva(
  "inline-flex min-h-5 w-fit max-w-full shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-[7px] py-px t-caption [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-surface text-fg-2",
        neutral: "border-border-strong bg-surface text-fg-2",
        ok: "border-transparent bg-ok-weak text-ok",
        warn: "border-transparent bg-warn-weak text-warn",
        danger: "border-transparent bg-danger-weak text-danger",
        info: "border-transparent bg-info-weak text-info",
        secondary: "border-transparent bg-surface-2 text-fg-2",
        destructive: "border-transparent bg-danger-weak text-danger",
        outline: "border-border-strong bg-transparent text-fg-2",
        ghost: "border-transparent bg-transparent text-fg-2 hover:bg-surface-2",
        link: "border-transparent bg-transparent text-accent-text underline underline-offset-4",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
