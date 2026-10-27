"use client";

import { useId } from "react";

import { HELP_TIP_BUTTON, type HelpTipProps } from "@/components/kit/help-tip-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Настоящий «?» на Radix Popover; в страницу его подключает только `HelpTip` (`./HelpTip`), подгружая по требованию. */
export function HelpTipImpl({ children, label = "Пояснение", align = "start", className }: HelpTipProps) {
  const textId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(HELP_TIP_BUTTON, className)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} aria-label={label} aria-describedby={textId} className="w-80">
        <div id={textId} className="text-fg-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
