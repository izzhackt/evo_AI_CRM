import type { ReactNode } from "react";

import { Shell } from "@/components/portal/Shell";
import { getLocale } from "@/lib/i18n";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

import "../(v3)/v3.css";
import "./portal.css";

export default async function StudentPortalLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [actor, locale] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
  ]);


  return (
    <Shell displayName={actor.displayName} accessTier={actor.accessTier} locale={locale}>
      {children}
    </Shell>
  );
}
