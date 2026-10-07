import type { Metadata } from "next";

import { StudentAuthShell } from "@/components/student-recovery/StudentAuthShell";
import { StudentResetPasswordForm } from "@/components/student-recovery/StudentResetPasswordForm";
import { getLocale } from "@/lib/i18n";
import { getPasswordRecoveryStrings } from "@/lib/portal/password-recovery-i18n";
import { readStudentRecoverySession } from "@/lib/server/student-password-recovery";
import { readRequestTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Новый пароль | EVO Admissions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Reachable only with the path-scoped recovery session from /auth/callback. */
export default async function StudentResetPasswordPage() {
  const [locale, theme, session] = await Promise.all([
    getLocale(),
    readRequestTheme(),
    readStudentRecoverySession(),
  ]);
  const strings = getPasswordRecoveryStrings(locale);

  return (
    <StudentAuthShell
      locale={locale}
      theme={theme}
      titleId="recovery-reset-title"
      title={strings.resetTitle}
      intro={session.status === "ready" ? strings.resetIntro : undefined}
    >
      <StudentResetPasswordForm session={session} strings={strings} />
    </StudentAuthShell>
  );
}
