import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SignupConfirmationLanding } from "@/components/student-application/SignupConfirmationLanding";
import { SignupConfirmationFrame } from "@/components/student-application/SignupConfirmationFrame";
import { getLocale } from "@/lib/i18n";
import { STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE } from "@/lib/student-signup-confirmation-contract";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { absolute: "EVO Admissions" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SignupConfirmationPage() {
  const [store, locale] = await Promise.all([cookies(), getLocale()]);
  return <SignupConfirmationFrame><SignupConfirmationLanding locale={locale} csrfToken={store.get(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE)?.value ?? ""} /></SignupConfirmationFrame>;
}
