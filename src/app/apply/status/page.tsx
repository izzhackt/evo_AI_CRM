import Link from "next/link";
import { redirect } from "next/navigation";
import { EvoLogo } from "@/components/platform/brand/EvoLogo";
import { ApplicationStatus } from "@/components/student-application/ApplicationStatus";
import { ApplyLangSwitcher } from "@/components/student-application/ApplyLangSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readRequestTheme } from "@/lib/theme-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { studentApplicationEntryRedirect } from "@/lib/server/student-signup-runtime";
import { readVerifiedStudentPortalAuthority } from "@/lib/supabase/student-portal-authority";
import { AccountDeletionPanel } from "@/components/account-deletion/AccountDeletionPanel";
import { readOwnAccountDeletion } from "@/lib/account-deletion/own-source";

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
  const [application, locale, theme, deletion] = await Promise.all([
    readOwnStudentApplication(client), getLocale(), readRequestTheme(), readOwnAccountDeletion(),
  ]);
  if (!application) redirect("/apply");
  const strings = getPortalStrings("apply", locale);
  const deletionStrings = getPortalStrings("accountDeletion", locale);
  return <main className="min-h-dvh bg-bg px-5 pb-12 text-fg sm:px-8">
    <header className="mx-auto flex max-w-4xl items-center justify-between gap-4 py-7">
      <Link href="/apply/status" className="rounded-ctl bg-white p-2"><EvoLogo width={146} /></Link>
      <div className="flex items-center gap-3">
        <ApplyLangSwitcher current={locale} label={strings.languageAria} />
        <ThemeToggle locale={locale} initialTheme={theme} />
      </div>
    </header>
    <div className="mx-auto max-w-4xl rounded-card border border-border bg-surface px-5 py-8 sm:p-10"><ApplicationStatus application={application} draftOwnerId={data.user.id} locale={locale} /></div>
    {/* Удаление аккаунта (279): анкета без одобрения тоже может удалить аккаунт. */}
    <section id="account-deletion" aria-labelledby="account-deletion-heading" className="mx-auto mt-6 max-w-4xl rounded-card border border-border bg-surface px-5 py-6 sm:px-10">
      <h2 id="account-deletion-heading" className="mb-3 text-xl font-semibold text-fg">{deletionStrings.heading}</h2>
      <AccountDeletionPanel
        initialRequest={deletion.status === "ready" ? deletion.request : null}
        unavailable={deletion.status === "unavailable"}
        strings={deletionStrings}
        look="apply"
      />
    </section>
  </main>;
}
