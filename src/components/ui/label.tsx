"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** Подпись поля — роль `t-label` (как `fieldLabelCls`). */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex select-none items-center gap-2 t-label text-fg-2 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-fg-3 peer-disabled:cursor-not-allowed peer-disabled:text-fg-3",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
