"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n-data";
import { getSignupConfirmationStrings } from "@/lib/portal/signup-confirmation-i18n";
import { confirmStudentSignupAction } from "@/lib/student-signup-confirmation-actions";
import { parseStudentSignupConfirmationFragment, STUDENT_SIGNUP_CONFIRMATION_PATH, type StudentSignupConfirmationInput } from "@/lib/student-signup-confirmation-contract";
import type { SignupConfirmState } from "@/lib/student-signup-confirmation-state";

export function SignupConfirmationLanding({ locale, csrfToken }: { locale: Locale; csrfToken: string }) {
  const strings = getSignupConfirmationStrings(locale);
  const captured = useRef(false);
  const [intent, setIntent] = useState<StudentSignupConfirmationInput | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, action, busy] = useActionState(confirmStudentSignupAction, { status: "idle" } as SignupConfirmState);
  const error = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const parsed = parseStudentSignupConfirmationFragment(window.location.hash);
    try { window.history.replaceState(null, "", STUDENT_SIGNUP_CONFIRMATION_PATH); }
    catch {
      // Browser-only initialization after hydration; failed URL stripping must fail closed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(true); return;
    }
    setIntent(parsed);
    setLoaded(true);
  }, []);
  useEffect(() => { if (state.status !== "idle") error.current?.focus(); }, [state]);
  const message = state.status !== "idle" ? strings[state.status] : loaded && !intent ? strings.invalid_link : null;
  const terminal = ["invalid_link", "expired_or_used", "account_conflict", "sign_in_required", "resume_unknown"].includes(state.status);
  return <section className="rounded-card border border-border bg-surface p-5 sm:p-10" aria-labelledby="signup-confirm-title">
    <h1 id="signup-confirm-title" className="text-2xl font-semibold text-fg">{strings.title}</h1>
    {(!loaded || (intent && !terminal)) && <p className="mt-4 text-fg-2">{strings.landing}</p>}
    {!loaded && <p role="status" className="mt-4 text-fg-2">{strings.loading}</p>}
    {message && <p ref={error} tabIndex={-1} role="alert" className="mt-4 text-fg-2">{message}</p>}
    {intent && !terminal && <form action={action} className="mt-6" aria-busy={busy}>
      <input type="hidden" name="cap" value={intent.cap} /><input type="hidden" name="otp" value={intent.otp} /><input type="hidden" name="csrf_token" value={csrfToken} />
      <button disabled={busy} className="min-h-12 w-full rounded-ctl bg-accent px-4 py-3 font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60">{busy ? strings.confirming : strings.confirm}</button>
    </form>}
    <Link href="/login" className="mt-4 inline-flex min-h-11 items-center text-accent-text underline">{strings.login}</Link>
    {message && <a href="mailto:evo@evoadmissions.com" className="ml-6 mt-4 inline-flex min-h-11 items-center text-accent-text underline">{strings.support}</a>}
    <noscript><p>{strings.noScript}</p></noscript>
  </section>;
}
