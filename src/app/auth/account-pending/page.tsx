import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StudentAccountPending } from "@/components/StudentAccountPending";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { createStudentInviteSessionRuntime } from "@/lib/server/student-invite-session-runtime";
import { readVerifiedStudentInviteSession } from "@/lib/server/student-invite-session";
import { resolveStudentPortalActor } from "@/lib/student-portal-auth";

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
      </section>
    </main>
  );
}
