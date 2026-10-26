import * as React from "react";

import { cn } from "@/lib/utils";

/** Поле — как `inputCls`: 44 px, граница `--control-edge` (≥3:1), 16 px (iOS не приближает экран). Фокус рисует globals.css. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-ctl border border-input bg-surface px-3 text-base text-fg transition-[border-color,background-color] duration-150 ease-out file:mr-3 file:border-0 file:bg-transparent file:t-label file:text-fg placeholder:text-fg-3 hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3 aria-invalid:border-danger motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
