import type { Metadata } from "next";

import { StudentAuthShell } from "@/components/student-recovery/StudentAuthShell";
import { StudentForgotPasswordForm } from "@/components/student-recovery/StudentForgotPasswordForm";
import { getLocale } from "@/lib/i18n";
import { getPasswordRecoveryStrings } from "@/lib/portal/password-recovery-i18n";
import { readRequestTheme } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Восстановление пароля | EVO Admissions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function StudentForgotPasswordPage() {
  const [locale, theme] = await Promise.all([getLocale(), readRequestTheme()]);
  const strings = getPasswordRecoveryStrings(locale);
  return (
    <StudentAuthShell
      locale={locale}
      theme={theme}
      titleId="recovery-request-title"
      title={strings.forgotTitle}
      intro={strings.forgotIntro}
    >
      <StudentForgotPasswordForm strings={strings} />
    </StudentAuthShell>
  );
}
