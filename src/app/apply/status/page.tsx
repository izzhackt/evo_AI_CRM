import Link from "next/link";
import { redirect } from "next/navigation";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { ApplicationStatus } from "@/components/student-application/ApplicationStatus";
import { ApplyLangSwitcher } from "@/components/student-application/ApplyLangSwitcher";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { studentApplicationEntryRedirect } from "@/lib/server/student-signup-runtime";
import { readVerifiedStudentPortalAuthority } from "@/lib/supabase/student-portal-authority";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Моя заявка | EVO Admissions" }, robots: { index: false, follow: false } };

export default async function ApplicationStatusPage() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user?.email_confirmed_at) redirect("/login");
  const destination = await studentApplicationEntryRedirect(client, data.user);
  if (destination === "/portal") {
    // Unified workflow (S5): a pending, curator-less cabinet (S1's «кабинет
    // до продажи») has no other place in the portal to read the анкета it
    // was approved from, so it stays here instead of bouncing straight back.
    // An active/closed case has moved past this screen and keeps the bounce.
    const claims = await client.auth.getClaims();
    const portal = !claims.error && claims.data?.claims
      ? await readVerifiedStudentPortalAuthority(client, claims.data.claims)
      : null;
    const stillPending = portal !== null && portal.status === "authenticated"
      && portal.authority.caseState === "pending";
    if (!stillPending) redirect(destination);
  } else if (destination) {
    redirect(destination);
  }
  const [application, locale] = await Promise.all([readOwnStudentApplication(client), getLocale()]);
  if (!application) redirect("/apply");
  const strings = getPortalStrings("apply", locale);
  return <main className="min-h-dvh bg-bg px-5 pb-12 text-fg sm:px-8">
    <header className="mx-auto flex max-w-4xl items-center justify-between gap-4 py-7">
      <Link href="/apply/status" className="rounded-ctl bg-white p-2"><EvoLogo width={146} /></Link>
      <ApplyLangSwitcher current={locale} label={strings.languageAria} />
    </header>
    <div className="mx-auto max-w-4xl rounded-card border border-border bg-surface px-5 py-8 sm:p-10"><ApplicationStatus application={application} draftOwnerId={data.user.id} locale={locale} /></div>
  </main>;
}
