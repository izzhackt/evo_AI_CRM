// Тексты документов программы: словарь веба `programDocuments` (RU и KY без копий) с подменой нескольких строк, которые сайт
// пишет про страницу, вкладку и браузер. В приложении они были бы неверными, поэтому их место занимают строки среза
// (`prep.*`); остальные 80 с лишним строк идут из веба как есть.
import type { PortalStrings } from "@web/lib/portal/i18n";
import { useMemo } from "react";

import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";

export type DocumentStrings = PortalStrings<"programDocuments">;

/** Строки веба, которые заменяет приложение, и ключ замены. */
export const DOCUMENT_STRING_OVERRIDES = {
  forbidden: "prep.forbidden",
  storageUnavailable: "prep.storageUnavailable",
  cleanupFailed: "prep.cleanupFailed",
  savedSendBusy: "prep.savedSendBusy",
  deadlineSource: "prep.deadlineSource",
} as const satisfies Partial<Record<keyof DocumentStrings, MobileStringKey>>;

export function useDocumentStrings(): DocumentStrings {
  const { m, t } = useLang();
  const base = t("programDocuments");
  return useMemo(() => {
    const merged: Record<string, string> = { ...base };
    for (const [key, replacement] of Object.entries(DOCUMENT_STRING_OVERRIDES)) merged[key] = m(replacement);
    return merged as DocumentStrings;
  }, [base, m]);
}
