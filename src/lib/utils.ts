import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Склейка классов для примитивов shadcn/ui (`src/components/ui/*`) и набора `src/components/kit`.
 * Старый `cn` в `src/components/ui.tsx` остаётся для прежних экранов и не меняется.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
