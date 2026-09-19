import type { ReactNode } from "react";

import { Shell } from "@/components/portal/Shell";
import { PortalNotificationUpdates } from "@/components/v3/portal/PortalNotificationUpdates";
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

  // PORT-1a добавит accessTier в серверный authority с той же семантикой; до
  // его merge уровень выводится локально: pending-дело — самостоятельный
  // approved-доступ, active/closed — сопровождение (assisted).
  const accessTier = actor.caseState === "pending" ? "approved" : "assisted";

  return (
    <Shell displayName={actor.displayName} accessTier={accessTier} locale={locale}>
      <PortalNotificationUpdates />
      {children}
    </Shell>
  );
}
