import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { StudentInviteCallback } from "@/components/StudentInviteCallback";
import { EvoMark } from "@/components/platform/brand/EvoMark";
import { StudentAuthShell } from "@/components/student-recovery/StudentAuthShell";
import { recoveryErrorCls, recoveryLinkCls } from "@/components/student-recovery/recovery-styles";
import { StudentRecoveryCallback } from "@/components/student-recovery/StudentRecoveryCallback";
import { btnCls, btnGhostCls } from "@/components/ui";
import { getLocale } from "@/lib/i18n";
import { getPasswordRecoveryStrings } from "@/lib/portal/password-recovery-i18n";
import {
  decodeStudentInviteCallbackQuery,
  decodeStudentRecoveryCallbackQuery,
  isStudentInviteCsrfToken,
  STUDENT_INVITE_CSRF_COOKIE,
} from "@/lib/student-invite-callback-contract";
import { STUDENT_PASSWORD_FORGOT_PATH } from "@/lib/student-password-recovery-contract";
import { readRequestTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Подтвердить аккаунт | EVO Admissions",
  robots: { index: false, follow: false },
};

type CallbackSearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

export default async function StudentInviteCallbackPage({
  searchParams,
}: Readonly<{ searchParams: CallbackSearchParams }>) {
  const query = await searchParams;
  const csrfToken = (await cookies()).get(STUDENT_INVITE_CSRF_COOKIE)?.value;
  // The shared Recovery template sends Students here with type=recovery.
  if (query.type === "recovery") {
    const recovery = decodeStudentRecoveryCallbackQuery(query);
    const [locale, theme] = await Promise.all([getLocale(), readRequestTheme()]);
    const strings = getPasswordRecoveryStrings(locale);
    return (
      <StudentAuthShell
        locale={locale}
        theme={theme}
        titleId="recovery-link-title"
        title={strings.linkTitle}
      >
        {recovery !== null && isStudentInviteCsrfToken(csrfToken) ? (
          <StudentRecoveryCallback
            csrfToken={csrfToken}
            tokenHash={recovery.tokenHash}
            strings={strings}
          />
        ) : (
          <div className="space-y-5">
            <p role="alert" className={recoveryErrorCls}>
              {strings.invalidLink}
            </p>
            <Link href={STUDENT_PASSWORD_FORGOT_PATH} className={`${btnCls} w-full`}>
              {strings.requestNew}
            </Link>
            <Link href="/login" className={recoveryLinkCls}>
              {strings.toLogin}
            </Link>
          </div>
        )}
      </StudentAuthShell>
    );
  }

  const invite = decodeStudentInviteCallbackQuery(query);
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
