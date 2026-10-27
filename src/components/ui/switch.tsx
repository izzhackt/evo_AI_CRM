"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Переключатель 44×24 px с зоной нажатия 44 px по высоте. Включён — тёмный нейтральный, граница выключенного ≥3:1.
 * Заперт — бледная дорожка и курсор «нельзя»: настоящий `disabled` (Radix ставит `data-disabled`) или `aria-disabled`,
 * который оставляет переключатель в порядке Tab и читаемым (запись идёт, или причина запрета рядом словами).
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input transition-colors after:absolute after:-inset-y-2.5 after:inset-x-0 data-checked:border-fg data-checked:bg-fg data-unchecked:bg-surface-3 data-disabled:cursor-not-allowed data-disabled:border-border data-disabled:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:border-border aria-disabled:bg-surface-2 aria-disabled:data-checked:bg-fg-3",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-surface shadow-evo transition-transform data-checked:translate-x-5 data-unchecked:translate-x-0.5 motion-reduce:transition-none"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
