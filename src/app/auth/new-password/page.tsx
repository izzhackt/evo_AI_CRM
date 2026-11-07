import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewPasswordForm } from "@/components/student-application/NewPasswordForm";
import { SignupConfirmationFrame } from "@/components/student-application/SignupConfirmationFrame";
import { getLocale } from "@/lib/i18n";
import { hasTemporaryPassword } from "@/lib/student-account-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Свой пароль | EVO Admissions" },
  robots: { index: false, follow: false },
};

/** 342: только для входа с временным паролем от администратора; остальных ведёт обычный путь студента. */
export default async function StudentNewPasswordPage() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  if (!hasTemporaryPassword(data.user.app_metadata)) redirect("/apply");
  const locale = await getLocale();
  return <SignupConfirmationFrame><NewPasswordForm locale={locale} /></SignupConfirmationFrame>;
}
