import { cookies } from "next/headers";

import { DICTS, LOCALES, type Locale } from "./i18n-data";

export type { Locale } from "./i18n-data";
export { LOCALES, LOCALE_NAMES } from "./i18n-data";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get("locale")?.value;
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : "ru";
}

export async function getT() {
  const locale = await getLocale();
  const dict = DICTS[locale];
  const t = (key: string) => dict[key] ?? DICTS.ru[key] ?? key;
  return { t, locale };
}
