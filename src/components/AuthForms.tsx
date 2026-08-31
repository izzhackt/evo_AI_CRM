"use client";

import { useActionState } from "react";

import {
  loginDevelopmentGateAction,
  type DevelopmentGateActionState,
} from "@/lib/development-gate-actions";
import { btnCls, inputCls, labelCls } from "./ui";

type DevelopmentGateLabels = Readonly<{
  accessDenied: string;
  gateUnavailable: string;
  identifier: string;
  secret: string;
  signIn: string;
}>;

export function LoginForm({
  labels,
  initialError = null,
}: Readonly<{
  labels: DevelopmentGateLabels;
  initialError?: DevelopmentGateActionState;
}>) {
  const [error, action, pending] = useActionState(
    loginDevelopmentGateAction,
    initialError,
  );

  return (
    <form
      action={action}
      aria-labelledby="login-title"
      aria-busy={pending}
      className="space-y-5"
    >
      {error ? (
        <p
          id="login-error"
          role="alert"
          aria-live="polite"
          className="rounded-ctl bg-danger-weak px-3 py-2.5 text-sm font-medium text-danger"
        >
          {labels[error]}
        </p>
      ) : null}

      <div>
        <label htmlFor="gate-identifier" className={labelCls}>
          {labels.identifier}
        </label>
        <input
          id="gate-identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          maxLength={256}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="gate-secret" className={labelCls}>
          {labels.secret}
        </label>
        <input
          id="gate-secret"
          name="secret"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>

      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {labels.signIn}
      </button>
    </form>
  );
}
