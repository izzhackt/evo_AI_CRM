import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ApplicationWizard, type ApplicationNamePrefill } from "@/components/student-application/ApplicationWizard";
import { SignupConfirmationPending } from "@/components/student-application/SignupConfirmationPending";
import { SignupConfirmationFrame } from "@/components/student-application/SignupConfirmationFrame";
import { readPendingStudentSignup } from "@/lib/server/student-signup-confirmation-web";
import { getLocale } from "@/lib/i18n";
import { readRequestTheme } from "@/lib/theme-server";
import { STUDENT_APPLICATION_METADATA_KEY, validateStudentApplicationDraft } from "@/lib/student-application-contract";
import { createStudentInviteSessionRuntime } from "@/lib/server/student-invite-session-runtime";
import { readVerifiedStudentInviteSession } from "@/lib/server/student-invite-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { studentApplicationEntryRedirect } from "@/lib/server/student-signup-runtime";
import { AccountDeletionPanel } from "@/components/account-deletion/AccountDeletionPanel";
import { readOwnAccountDeletion } from "@/lib/account-deletion/own-source";
import { ACCOUNT_DELETED_PATH, isDeletedAuthUserError } from "@/lib/account-deletion-contract";
import { getPortalStrings } from "@/lib/portal/i18n";

/**
 * PORT-1b: prefill only what the invited person already sees as their own —
 * the receipt's display name (their invite was addressed with it). Lead-side
 * contact facts are staff data and are deliberately not copied here.
 */
function invitedNamePrefill(displayName: string | null): ApplicationNamePrefill | null {
  const [first = "", ...rest] = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (first.length === 0) return null;
  return {
    firstName: first.slice(0, 60),
    lastName: rest.join(" ").slice(0, 60),
  };
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "Начните поступление | EVO Admissions" }, description: "Расскажите о ваших планах и создайте личный аккаунт EVO." };

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // PORT-8c: язык анкеты — существующий механизм cookie `locale` (getLocale —
  // async; до создания аккаунта персистить язык больше некуда).
  const [query, locale, theme] = await Promise.all([searchParams, getLocale(), readRequestTheme()]);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  // 280 (ревью п. 4): аккаунт удалён, в браузере осталась его сессия.
  if (isDeletedAuthUserError(error)) redirect(ACCOUNT_DELETED_PATH);
  if (error && error.name !== "AuthSessionMissingError") throw new Error("Student registration is unavailable.");
  let draft = null;
  let email = null;
  let revision = 0;
  let namePrefill: ApplicationNamePrefill | null = null;
  if (data.user?.email_confirmed_at) {
    const destination = await studentApplicationEntryRedirect(client, data.user);
    if (destination) redirect(destination);
    const application = await readOwnStudentApplication(client);
    if (application && (application.status !== "rejected" || query.edit !== "1")) redirect("/apply/status");
    email = data.user.email ?? null;
    draft = application?.questionnaire ?? validateStudentApplicationDraft(data.user.user_metadata?.[STUDENT_APPLICATION_METADATA_KEY]);
    revision = application?.revision ?? 0;
    if (!draft) {
      // PORT-1b: an accepted anketa_v1 invite prefills the name it was
      // addressed to. A failed receipt read never blocks the анкета itself.
      try {
        const { sessionClient, receiptStore } = await createStudentInviteSessionRuntime();
        const invite = await readVerifiedStudentInviteSession(sessionClient, receiptStore);
        if (
          invite.status === "authenticated" &&
          invite.receipt.intakeFlow === "anketa_v1" &&
          invite.receipt.accountPending
        ) {
          namePrefill = invitedNamePrefill(invite.receipt.displayName);
        }
      } catch { /* prefill is a convenience, not authority */ }
    }
  }
  if (!data.user?.email_confirmed_at) {
    const pending = await readPendingStudentSignup();
    if (pending) return <SignupConfirmationFrame><SignupConfirmationPending initial={pending} locale={locale} restored /></SignupConfirmationFrame>;
  }
  const wizard = <ApplicationWizard requestId={randomUUID()} draft={draft} signedInEmail={email} draftOwnerId={email ? data.user?.id : null} expectedRevision={revision} namePrefill={namePrefill} year={new Date().getUTCFullYear()} locale={locale} theme={theme} accountDeletionHref={email ? "#account-deletion" : null} />;
  if (!email) return wizard;
  // Удаление аккаунта (280): вошедший аккаунт без анкеты тоже может удалить
  // аккаунт; ссылка «Удалить аккаунт» в шапке анкеты ведёт сюда.
  const deletionStrings = getPortalStrings("accountDeletion", locale);
  const deletion = await readOwnAccountDeletion();
  return <>
    {wizard}
    <section id="account-deletion" aria-labelledby="account-deletion-heading" className="bg-bg px-4 pb-12 text-fg sm:px-8">
      <div className="mx-auto max-w-4xl rounded-card border border-border bg-surface px-5 py-6 sm:px-10">
        <h2 id="account-deletion-heading" className="mb-3 text-xl font-semibold text-fg">{deletionStrings.heading}</h2>
        <AccountDeletionPanel
          initialRequest={deletion.status === "ready" ? deletion.request : null}
          unavailable={deletion.status === "unavailable"}
          strings={deletionStrings}
          look="apply"
        />
      </div>
    </section>
  </>;
}
