"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  fillRecoveryString,
  type PasswordRecoveryStrings,
} from "@/lib/portal/password-recovery-i18n";
import { requestStudentPasswordRecoveryAction } from "@/lib/student-password-recovery-actions";
import {
  STUDENT_RECOVERY_RESEND_SECONDS,
  type StudentRecoveryRequestState,
} from "@/lib/student-password-recovery-contract";

import { recoveryErrorCls, recoveryLinkCls, recoveryNoticeCls } from "./recovery-styles";

const IDLE: StudentRecoveryRequestState = { status: "idle" };

export function StudentForgotPasswordForm({
  strings,
}: Readonly<{ strings: PasswordRecoveryStrings }>) {
  const [state, action, pending] = useActionState(
    requestStudentPasswordRecoveryAction,
    IDLE,
  );
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lastState, setLastState] = useState(state);
  const message = useRef<HTMLDivElement>(null);

  // Adjust local state from each new server answer while rendering, not in
  // an effect: the address shown and a fresh resend wait.
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "sent") {
      setSentTo(email.trim());
      setSecondsLeft(STUDENT_RECOVERY_RESEND_SECONDS);
    }
  }

  const sent = state.status === "sent";
  const waiting = sent && secondsLeft > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((left) => Math.max(0, left - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (state.status !== "idle") message.current?.focus();
  }, [state]);

  if (sent) {
    return (
      <div className="space-y-5">
        <div ref={message} tabIndex={-1} role="status" className={recoveryNoticeCls}>
          <p>{strings.sent}</p>
          {sentTo ? (
            <p className="mt-2 break-all text-fg-2">
              {fillRecoveryString(strings.sentAddress, { email: sentTo })}
            </p>
          ) : null}
          <p className="mt-2 text-fg-2">{strings.sentValidity}</p>
        </div>
        <form action={action} aria-busy={pending}>
          <input type="hidden" name="email" value={sentTo} />
          <button
            type="submit"
            disabled={pending || secondsLeft > 0}
            className={`${btnGhostCls} w-full`}
          >
            {pending
              ? strings.sending
              : secondsLeft > 0
                ? fillRecoveryString(strings.resendIn, { seconds: secondsLeft })
                : strings.resend}
          </button>
        </form>
        <Link href="/login" className={recoveryLinkCls}>
          {strings.backToLogin}
        </Link>
      </div>
    );
  }

  const error = state.status === "idle" ? null : state.status;
  return (
    <form action={action} aria-busy={pending} className="space-y-5">
      {error ? (
        <div
          ref={message}
          id="recovery-request-error"
          tabIndex={-1}
          role="alert"
          data-recovery-error={error}
          className={recoveryErrorCls}
        >
          {strings[error]}
        </div>
      ) : null}
      <div>
        <label htmlFor="recovery-email" className={labelCls}>
          {strings.emailLabel}
        </label>
        <input
          id="recovery-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={error ? "recovery-request-error" : undefined}
          aria-invalid={error === "invalid_email" ? "true" : undefined}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {pending ? strings.sending : strings.submit}
      </button>
      <Link href="/login" className={recoveryLinkCls}>
        {strings.backToLogin}
      </Link>
      <p className="text-xs leading-5 text-fg-3">{strings.staffNote}</p>
    </form>
  );
}
