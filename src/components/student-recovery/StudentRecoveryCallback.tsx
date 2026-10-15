"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { btnCls } from "@/components/ui";
import type { PasswordRecoveryStrings } from "@/lib/portal/password-recovery-i18n";
import { verifyStudentPasswordRecoveryAction } from "@/lib/student-password-recovery-actions";
import { STUDENT_PASSWORD_FORGOT_PATH } from "@/lib/student-password-recovery-contract";

import { recoveryErrorCls, recoveryLinkCls } from "./recovery-styles";

/** Terminal answers: this link cannot succeed any more, offer a new email. */
const TERMINAL = new Set(["expiredOrUsed", "invalidIdentity", "staffRefused"]);

export function StudentRecoveryCallback({
  csrfToken,
  tokenHash,
  strings,
}: Readonly<{
  csrfToken: string;
  tokenHash: string;
  strings: PasswordRecoveryStrings;
}>) {
  const [error, action, pending] = useActionState(
    verifyStudentPasswordRecoveryAction,
    null,
  );
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);

  const terminal = error !== null && TERMINAL.has(error);
  return (
    <div className="space-y-5">
      {terminal ? null : (
        <p className="text-sm leading-6 text-fg-2">{strings.linkIntro}</p>
      )}
      {error ? (
        <div
          ref={alert}
          tabIndex={-1}
          role="alert"
          data-recovery-error={error}
          className={recoveryErrorCls}
        >
          {strings[error]}
        </div>
      ) : null}

      {terminal ? (
        error === "staffRefused" ? (
          <Link href="/login" className={`${btnCls} w-full`}>
            {strings.toLogin}
          </Link>
        ) : (
          <Link href={STUDENT_PASSWORD_FORGOT_PATH} className={`${btnCls} w-full`}>
            {strings.requestNew}
          </Link>
        )
      ) : (
        <form action={action} aria-busy={pending}>
          <input type="hidden" name="csrf_token" value={csrfToken} />
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value="recovery" />
          <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
            {pending ? strings.checking : strings.continue}
          </button>
        </form>
      )}

      {terminal && error !== "staffRefused" ? (
        <Link href="/login" className={recoveryLinkCls}>
          {strings.toLogin}
        </Link>
      ) : null}
    </div>
  );
}
