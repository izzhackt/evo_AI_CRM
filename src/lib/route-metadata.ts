import type { Metadata } from "next";

import { getLocale } from "./i18n";
import type { Locale } from "./i18n-data";

export type RouteTitleCopy = Readonly<Record<Locale, string>>;

export async function buildRouteMetadata(
  titles: RouteTitleCopy,
): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: titles[locale],
  };
}
