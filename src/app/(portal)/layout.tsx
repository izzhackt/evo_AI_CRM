import type { ReactNode } from "react";

import { Shell } from "@/components/portal/Shell";
import { getLocale } from "@/lib/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readRequestTheme } from "@/lib/theme-server";

import "../(v3)/v3.css";
import "./portal.css";

export default async function StudentPortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [actor, locale, theme] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readRequestTheme(),
  ]);

  return (
    <Shell displayName={actor.displayName} accessTier={actor.accessTier} locale={locale} theme={theme}>
      {children}
    </Shell>
  );
}
