import type { Locale } from "@/lib/i18n";

const LOCALE_TAG: Record<Locale, string> = {
  ru: "ru-RU",
  ky: "ky-KG",
  en: "en-US",
};

export const SALES_STAGE_TONE = {
  processing_mp: "bg-info",
  qualified: "bg-accent",
  meeting_scheduled: "bg-surface-3",
  meeting_done: "bg-warn",
  contract_signed: "bg-ok",
  no_request: "bg-border-strong",
} as const;

export function formatSalesNumber(value: number, locale: Locale) {
  return value.toLocaleString(LOCALE_TAG[locale]);
}

export function shortSalesDate(value: string | null) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

export function salesTaskTone(lead: {
  open_tasks: number;
  overdue_tasks: number;
}) {
  if (lead.overdue_tasks > 0) return "bg-danger-weak text-danger";
  if (lead.open_tasks === 0) return "bg-warn-weak text-warn";
  return "bg-ok-weak text-ok";
}
