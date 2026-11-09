import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Shell } from "@/components/portal/Shell";
import { getLocale } from "@/lib/i18n";
import { consentGateDestination, consentGateRequired, CONSENT_GATE_PATH_HEADER, isConsentGatePath } from "@/lib/portal/consent-gate";
import { readOwnConsentStatus } from "@/lib/portal/consent-gate-source";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { PORTAL_RAIL_COOKIE, portalRailCollapsed } from "@/lib/portal/rail-choice";
import { readReleaseMetadata } from "@/lib/release-metadata";
import { hasTemporaryPassword, NEW_PASSWORD_PATH } from "@/lib/student-account-contract";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { isStudyCountryCode, studyCountryName } from "@/lib/study-countries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  // 356: запрошенную страницу ставит только прокси. Без заголовка экран не определить - слой работает как раньше.
  const requestedPath = (await headers()).get(CONSENT_GATE_PATH_HEADER);
  const gatePage = isConsentGatePath(requestedPath);
  const [actor, locale, theme, countryChoice, cookieStore, claims, consentStatus] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readRequestTheme(),
    // Страна поступления для подписи в карточке внизу рейла («Малайзия ·
    // Студент»); то же чтение 284, что у «Пути поступления». Сбой или «Пока не
    // решил» — без страны.
    gatePage ? Promise.resolve(null) : readStudentCountryChoice().catch((): null => null),
    cookies(),
    createSupabaseServerClient().then((client) => client.auth.getClaims()).catch(() => null),
    // Состояние согласий: сбой чтения кабинет не запирает (доступ ИИ к данным без согласия закрывает база, 320).
    gatePage ? Promise.resolve(null) : readOwnConsentStatus().catch((): null => null),
  ]);
  // 342: вход с временным паролем от администратора — сначала свой пароль.
  if (hasTemporaryPassword(claims?.data?.claims?.app_metadata)) redirect(NEW_PASSWORD_PATH);
  // 356 (решение владельца 09.11.2026): нет решения о Политике и об ИИ-помощниках - сначала экран «Конфиденциальность».
  if (consentStatus !== null && consentGateRequired(consentStatus)) redirect(consentGateDestination(requestedPath));
  // Сам экран - без оболочки кабинета: рейл и меню до решения недоступны.
  if (gatePage) return <div className="pt-shell pt-gate-shell" data-testid="student-portal-consent-gate">{children}</div>;
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
