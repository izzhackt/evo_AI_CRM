"use client";

import { DetailSheet } from "@/components/kit/DetailSheet";
import { Button } from "@/components/ui/button";

import type { MoreSheetProps } from "./MoreSheet";

/** Настоящая кнопка с панелью `DetailSheet`. Файл подключает только `MoreSheet` (`./MoreSheet`), подгружая по требованию. */
export function MoreSheetImpl({ label, title, ariaLabel, help, testId, children }: MoreSheetProps) {
  return (
    <DetailSheet
      title={title}
      help={help}
      trigger={<Button variant="outline" className="w-fit" aria-label={ariaLabel} data-testid={testId}>{label}</Button>}
    >
      {children}
    </DetailSheet>
  );
}
