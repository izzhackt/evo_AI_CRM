import type { KeyboardEvent } from "react";

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shift+Tab с названия панели (на него падает фокус при открытии, `tabIndex=-1`) идёт на последний управляемый элемент панели
 * (крестик или последнее действие), как круг по Tab. Без этого Radix `FocusScope` замыкает круг только от первого
 * фокусируемого элемента, названием он не считается, браузер уводил фокус за панель, и ловушка возвращала его на название: Shift+Tab
 * не делал ничего (APG: «Dialog (Modal)»).
 */
export function wrapShiftTabFromTitle(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab" || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const panel = event.currentTarget.closest<HTMLElement>('[role="dialog"]');
  const stops = panel ? [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden") : [];
  const last = stops.at(-1);
  if (!last) return;
  event.preventDefault();
  last.focus();
}
