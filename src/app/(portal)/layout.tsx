import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { Shell } from "@/components/portal/Shell";
import { getLocale } from "@/lib/i18n";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { PORTAL_RAIL_COOKIE, portalRailCollapsed } from "@/lib/portal/rail-choice";
import { readReleaseMetadata } from "@/lib/release-metadata";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { isStudyCountryCode, studyCountryName } from "@/lib/study-countries";
import { readRequestTheme } from "@/lib/theme-server";

import "../(staff)/staff.css";
import "./portal.css";

// Страницы кабинета сами дописывают «— EVO Admissions»; корневой шаблон
// «| EVO Admissions CRM» студенту не нужен.
export const metadata: Metadata = {
  title: { absolute: "EVO Admissions", template: "%s" },
};

export default async function StudentPortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [actor, locale, theme, countryChoice, cookieStore] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readRequestTheme(),
    // Страна поступления для подписи в карточке внизу рейла («Малайзия ·
    // Студент»); то же чтение 284, что у «Пути поступления». Сбой или «Пока не
    // решил» — без страны.
    readStudentCountryChoice().catch((): null => null),
    cookies(),
  ]);
  const country = countryChoice?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, locale) : null;

  const metadata = readReleaseMetadata();
  return (
    <Shell
      displayName={actor.displayName}
      accessTier={actor.accessTier}
      locale={locale}
      theme={theme}
      release={metadata.status === "available" ? metadata.revision : null}
      studyCountry={studyCountry}
      railCollapsed={portalRailCollapsed(cookieStore.get(PORTAL_RAIL_COOKIE)?.value)}
    >
      {children}
    </Shell>
  );
}
