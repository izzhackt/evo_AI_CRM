import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readOwnStudentApplication } from "@/lib/v3/student-application-source";
import { StudentAccountPending } from "@/components/StudentAccountPending";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { createStudentInviteSessionRuntime } from "@/lib/server/student-invite-session-runtime";
import { readVerifiedStudentInviteSession } from "@/lib/server/student-invite-session";
import { resolveStudentPortalActor } from "@/lib/student-portal-auth";
import { AccountDeletionPanel } from "@/components/account-deletion/AccountDeletionPanel";
import { readOwnAccountDeletion } from "@/lib/account-deletion/own-source";
import { sessionAccountDeleted } from "@/lib/account-deletion/deleted-session";
import { ACCOUNT_DELETED_PATH } from "@/lib/account-deletion-contract";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Доступ готовится | EVO Admissions",
  robots: { index: false, follow: false },
};

export default async function StudentAccountPendingPage() {
  const student = await resolveStudentPortalActor();
  if (student.status === "authenticated") redirect("/portal");
  if (
    student.status === "invalid" &&
    student.reason === "student_authority_unavailable"
  ) {
    redirect("/login?error=auth_unavailable");
  }

  // 280 (ревью п. 4): у удалённого аккаунта чтение анкеты отвечает
  // «forbidden»; Auth подтверждает удаление, и браузер уходит на вход с
  // «Аккаунт удалён» вместо ошибки 500.
  let application;
  try {
    application = await readOwnStudentApplication();
  } catch (error) {
    if (await sessionAccountDeleted()) redirect(ACCOUNT_DELETED_PATH);
    throw error;
  }
  if (application) redirect("/apply/status");

  let inviteSession;
  try {
    const { sessionClient, receiptStore } =
      await createStudentInviteSessionRuntime();
    inviteSession = await readVerifiedStudentInviteSession(
      sessionClient,
      receiptStore,
    );
  } catch {
    redirect("/login?error=auth_unavailable");
  }
  if (inviteSession.status === "anonymous") redirect("/login");
  if (inviteSession.status === "unavailable") {
    redirect("/login?error=auth_unavailable");
  }
  if (
    inviteSession.status !== "authenticated" ||
    !inviteSession.receipt.accountPending
  ) {
    redirect("/login?error=session_invalid");
  }
  // PORT-1b: an accepted anketa_v1 invite waits for the анкета, not for a
  // background provisioning step — the submitted-анкета case already
  // redirected to /apply/status above.
  if (inviteSession.receipt.intakeFlow === "anketa_v1") {
    redirect("/apply");
  }

  const [locale, deletion] = await Promise.all([getLocale(), readOwnAccountDeletion()]);
  const deletionStrings = getPortalStrings("accountDeletion", locale);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <section
        aria-labelledby="pending-title"
        className="page-in w-full max-w-[480px] rounded-[20px] bg-surface p-7 shadow-evo-lg"
      >
        <div className="mb-5 flex items-center gap-3">
          <EvoMark size={38} />
          <span className="leading-tight">
            <span className="block text-md font-bold text-fg">EVO</span>
            <span className="block text-xs text-fg-3">Student Portal</span>
          </span>
        </div>
        <h1 id="pending-title" className="text-2xl font-bold leading-tight text-fg">
          Доступ к кабинету готовится
        </h1>
        <p className="mt-2 text-sm leading-6 text-fg-3">
          Приглашение принято, но настройка доступа ещё не завершена. Можно
          безопасно проверить состояние позже или выйти из аккаунта.
        </p>
        <StudentAccountPending />
        {/* Удаление аккаунта (280): и до готовности доступа. */}
        <section aria-labelledby="account-deletion-heading" className="mt-6 border-t border-border pt-5">
          <h2 id="account-deletion-heading" className="mb-3 text-base font-semibold text-fg">{deletionStrings.heading}</h2>
          <AccountDeletionPanel
            initialRequest={deletion.status === "ready" ? deletion.request : null}
            unavailable={deletion.status === "unavailable"}
            strings={deletionStrings}
            look="apply"
          />
        </section>
      </section>
    </main>
  );
}
