"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { btnCls, inputCls, labelCls } from "@/components/ui";
import {
  fillRecoveryString,
  type PasswordRecoveryStrings,
} from "@/lib/portal/password-recovery-i18n";
import { setStudentRecoveryPasswordAction } from "@/lib/student-password-recovery-actions";
import {
  STUDENT_PASSWORD_FORGOT_PATH,
  STUDENT_PASSWORD_MIN_LENGTH,
  type StudentRecoveryPasswordState,
} from "@/lib/student-password-recovery-contract";

import { recoveryErrorCls, recoveryLinkCls, recoveryNoticeCls } from "./recovery-styles";

type Status = StudentRecoveryPasswordState["status"];
const IDLE: StudentRecoveryPasswordState = { status: "idle" };

/** Answers after which this session cannot set a password any more. */
const TERMINAL: ReadonlySet<Status> = new Set(["expired", "staff_refused", "sign_in_required"]);

function errorText(strings: PasswordRecoveryStrings, status: Status): string | null {
  switch (status) {
    case "idle":
    case "done":
      return null;
    case "unavailable":
      return strings.save_unavailable;
    case "staff_refused":
      return strings.staffRefused;
    default:
      return strings[status];
  }
}

/**
 * Stays mounted while the action changes cookies: Next then re-renders the
 * page without the recovery session, and the confirmation must survive it.
 */
export function StudentResetPasswordForm({
  session,
  strings,
}: Readonly<{
  session: Readonly<{ status: "ready"; email: string }> | Readonly<{ status: "missing" | "unavailable" }>;
  strings: PasswordRecoveryStrings;
}>) {
  const [state, action, pending] = useActionState(setStudentRecoveryPasswordAction, IDLE);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const focusTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") focusTarget.current?.focus();
  }, [state]);

  if (state.status === "done") {
    return (
      <div className="space-y-5">
        <div ref={focusTarget} tabIndex={-1} role="status" className={recoveryNoticeCls}>
          <p className="font-semibold">{strings.doneTitle}</p>
          <p className="mt-1 text-fg-2">{strings.done}</p>
        </div>
        <Link href="/" className={`${btnCls} w-full`}>
          {strings.goCabinet}
        </Link>
      </div>
    );
  }

  const error = errorText(strings, state.status);
  if (TERMINAL.has(state.status)) {
    const toLogin = state.status !== "expired";
    return (
      <div className="space-y-5">
        <div
          ref={focusTarget}
          tabIndex={-1}
          role="alert"
          data-recovery-error={state.status}
          className={recoveryErrorCls}
        >
          {error}
        </div>
        <Link
          href={toLogin ? "/login" : STUDENT_PASSWORD_FORGOT_PATH}
          className={`${btnCls} w-full`}
        >
          {toLogin ? strings.toLogin : strings.requestNew}
        </Link>
      </div>
    );
  }

  if (session.status !== "ready") {
    return (
      <div className="space-y-5">
        <p role="alert" data-recovery-error={session.status} className={recoveryErrorCls}>
          {session.status === "missing" ? strings.missingSession : strings.authUnavailable}
        </p>
        <Link href={STUDENT_PASSWORD_FORGOT_PATH} className={`${btnCls} w-full`}>
          {strings.requestNew}
        </Link>
        <Link href="/login" className={recoveryLinkCls}>
          {strings.toLogin}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} aria-busy={pending} className="space-y-5">
      <p className="break-all text-sm leading-6 text-fg-2">
        {fillRecoveryString(strings.account, { email: session.email })}
      </p>
      {error ? (
        <div
          ref={focusTarget}
          id="recovery-password-error"
          tabIndex={-1}
          role="alert"
          data-recovery-error={state.status}
          className={recoveryErrorCls}
        >
          {error}
        </div>
      ) : null}

      <div>
        <label htmlFor="recovery-new-password" className={labelCls}>
          {strings.passwordLabel}
        </label>
        <input
          id="recovery-new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={STUDENT_PASSWORD_MIN_LENGTH}
          maxLength={72}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={error ? "recovery-password-error recovery-password-hint" : "recovery-password-hint"}
          className={inputCls}
        />
        <p id="recovery-password-hint" className="mt-1.5 text-xs leading-5 text-fg-3">
          {strings.passwordHint}
        </p>
      </div>

      <div>
        <label htmlFor="recovery-password-confirm" className={labelCls}>
          {strings.confirmLabel}
        </label>
        <input
          id="recovery-password-confirm"
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={STUDENT_PASSWORD_MIN_LENGTH}
          maxLength={72}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-describedby={error ? "recovery-password-error" : undefined}
          className={inputCls}
        />
      </div>

      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {pending ? strings.saving : strings.save}
      </button>
      <Link href="/login" className={recoveryLinkCls}>
        {strings.backToLogin}
      </Link>
    </form>
  );
}
