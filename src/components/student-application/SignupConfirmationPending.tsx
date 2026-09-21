"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import type { Locale } from "@/lib/i18n-data";
import type { SignupResendResult } from "@/lib/student-signup-confirmation-state";
import { resendStudentSignupConfirmationAction } from "@/lib/student-signup-confirmation-actions";
import { getSignupConfirmationStrings } from "@/lib/portal/signup-confirmation-i18n";

export function SignupConfirmationPending({ initial, locale }: { initial: SignupResendResult; locale: Locale }) {
  const [state, action, busy] = useActionState(resendStudentSignupConfirmationAction, initial);
  const heading = useRef<HTMLHeadingElement>(null);
  const strings = getSignupConfirmationStrings(locale);
  useEffect(() => { heading.current?.focus(); }, []);
  const terminal = state.status === "confirmed" || state.status === "expired" || state.status === "account_conflict";
  const pending = state.status === "pending_confirmation" ? state : initial.status === "pending_confirmation" ? initial : null;
  return <section aria-labelledby="signup-pending-title" className="rounded-card border border-border bg-surface p-5 sm:p-10">
    <h1 id="signup-pending-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold text-fg">{strings.title}</h1>
    {pending && !terminal && <p className="mt-4 text-fg-2">{strings.instruction} <bdi className="[overflow-wrap:anywhere]">{pending.maskedEmail}</bdi></p>}
    {!terminal && <p className="mt-4 text-fg-2">{strings.next}</p>}
    <p role="status" className="mt-4 text-fg-2">{state.status === "pending_confirmation" ? strings[state.dispatch] : strings[state.status]}</p>
    {!terminal && <form action={action} className="mt-6" aria-busy={busy}>
      <button disabled={busy} className="min-h-12 w-full rounded-ctl bg-accent px-4 py-3 font-semibold text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60">{busy ? strings.sending : strings.resend}</button>
    </form>}
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
      <Link href="/login" className="inline-flex min-h-11 items-center text-accent-text underline">{strings.login}</Link>
      <a href="mailto:evo@evoadmissions.com" className="inline-flex min-h-11 items-center text-accent-text underline">{strings.support}</a>
    </div>
  </section>;
}
