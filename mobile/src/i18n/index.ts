// RU/KY: общие словари веба подключаются без копий (@web = <repo>/src), строки
// самого приложения лежат в mobile-strings.ts.
import { formatPortalString, getPortalStrings, type PortalNamespace, type PortalStrings } from "@web/lib/portal/i18n";
import { fillRecoveryString, getPasswordRecoveryStrings } from "@web/lib/portal/password-recovery-i18n";

import { MOBILE_STRINGS, type MobileStringKey } from "@/i18n/mobile-strings";

export type Lang = "ru" | "ky";
export const LANGS: readonly Lang[] = ["ru", "ky"];
export const DEFAULT_LANG: Lang = "ru";

export function isLang(value: unknown): value is Lang {
  return value === "ru" || value === "ky";
}

export type { MobileStringKey };

export function mobileString(lang: Lang, key: MobileStringKey): string {
  return MOBILE_STRINGS[lang][key];
}

export type { PortalNamespace, PortalStrings };
export { formatPortalString, getPortalStrings, fillRecoveryString, getPasswordRecoveryStrings };
