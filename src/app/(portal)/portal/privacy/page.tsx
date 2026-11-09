import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { ConsentGateForm } from "@/components/portal/consent/ConsentGateForm";
import { getLocale } from "@/lib/i18n";
import { consentGateRequired, safeConsentReturnPath } from "@/lib/portal/consent-gate";
import { readOwnConsentStatus } from "@/lib/portal/consent-gate-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { logoutStudentPortalAction } from "@/lib/student-portal-auth-actions";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Конфиденциальность — EVO Admissions",
  robots: { index: false, follow: false },
};

/**
 * Экран «Конфиденциальность» (миграция 356, решение владельца 09.11.2026): слой кабинета отправляет сюда студента без
 * решения о Политике и об ИИ-помощниках. Сам экран слоем не закрыт и показывается без оболочки кабинета; у студента,
 * который уже решил, он ведёт обратно на запрошенную страницу.
 */
export default async function PortalPrivacyPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  await requireStudentPortalActor();
  const [locale, params, status] = await Promise.all([getLocale(), searchParams, readOwnConsentStatus()]);
  const requested = params.next;
  const next = safeConsentReturnPath(typeof requested === "string" ? requested : null);
  if (status !== null && !consentGateRequired(status)) redirect(next);
  const strings = getPortalStrings("consentGate", locale);

  return (
    <main className="pt-gate" data-testid="consent-gate">
      <section aria-labelledby="consent-gate-title" className="pt-gate-card">
        <h1 id="consent-gate-title" className="pt-gate-title">{strings.title}</h1>
        <p className="pt-gate-lead">{strings.lead}</p>
        <ConsentGateForm strings={strings} requestId={randomUUID()} next={next} />
        <form action={logoutStudentPortalAction} className="pt-gate-logout">
          <button type="submit" className="pt-link pt-gate-logout-button">{strings.logout}</button>
        </form>
      </section>
    </main>
  );
}
