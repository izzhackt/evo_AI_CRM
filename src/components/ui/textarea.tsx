import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-y rounded-ctl border border-input bg-surface px-3 py-2.5 text-base text-fg transition-[border-color,background-color] duration-150 ease-out placeholder:text-fg-3 hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3 aria-invalid:border-danger motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
