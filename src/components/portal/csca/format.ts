import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

/** «4 мин» или «7 мин 30 с»: длительность теста на время. */
export function durationLabel(seconds: number, strings: PortalStrings<"csca">): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0
    ? formatPortalString(strings.durationMinutes, { m: String(m) })
    : formatPortalString(strings.durationMinutesSeconds, { m: String(m), s: String(s) });
}
