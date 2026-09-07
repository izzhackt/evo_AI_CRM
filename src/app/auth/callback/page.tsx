import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { StudentInviteCallback } from "@/components/StudentInviteCallback";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { btnGhostCls } from "@/components/ui";
import {
  decodeStudentInviteCallbackQuery,
  isStudentInviteCsrfToken,
  STUDENT_INVITE_CSRF_COOKIE,
} from "@/lib/student-invite-callback-contract";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Принять приглашение | EVO Admissions",
  robots: { index: false, follow: false },
};

type CallbackSearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

export default async function StudentInviteCallbackPage({
  searchParams,
}: Readonly<{ searchParams: CallbackSearchParams }>) {
  const invite = decodeStudentInviteCallbackQuery(await searchParams);
  const csrfToken = (await cookies()).get(STUDENT_INVITE_CSRF_COOKIE)?.value;
  const canVerify = invite !== null && isStudentInviteCsrfToken(csrfToken);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <section
        aria-labelledby="invite-title"
        className="page-in w-full max-w-[440px] rounded-[20px] bg-surface p-7 shadow-evo-lg"
      >
        <div className="mb-5 flex items-center gap-3">
          <EvoMark size={38} />
          <span className="leading-tight">
            <span className="block text-md font-bold text-fg">EVO</span>
            <span className="block text-xs text-fg-3">Student Portal</span>
          </span>
        </div>

        <h1 id="invite-title" className="text-2xl font-bold leading-tight text-fg">
          Приглашение в личный кабинет
        </h1>

        {canVerify ? (
          <>
            <p className="mt-2 text-sm leading-6 text-fg-3">
              Продолжите, чтобы подтвердить приглашение и задать пароль. До
              нажатия кнопки ссылка не изменяет вашу учётную запись.
            </p>
            <StudentInviteCallback
              csrfToken={csrfToken}
              tokenHash={invite.tokenHash}
            />
          </>
        ) : (
          <>
            <p
              role="alert"
              className="mt-3 rounded-ctl bg-danger-weak px-3 py-2.5 text-sm font-medium text-danger"
            >
              Ссылка приглашения недействительна или открыта не полностью.
              Вернитесь к исходному письму и откройте её снова.
            </p>
            <Link href="/login" className={`${btnGhostCls} mt-6 w-full`}>
              Перейти ко входу
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
