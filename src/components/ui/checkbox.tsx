"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Флажок 20 px с зоной нажатия 44 px (`after`). «Выбрано» — нейтральное, тёмное: красный остаётся главному действию. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-input bg-surface transition-colors after:absolute after:-inset-3 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 aria-invalid:border-danger data-checked:border-fg data-checked:bg-fg data-checked:text-surface",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current">
        <CheckIcon className="size-3.5" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
