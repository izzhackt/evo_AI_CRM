"use client";

import { useActionState } from "react";

import {
  loginStaffAction,
  type StaffLoginActionState,
} from "@/lib/staff-auth-actions";
import { btnCls, inputCls, labelCls } from "./ui";

type StaffLoginLabels = Readonly<{
  accessDenied: string;
  authUnavailable: string;
  staffAccessDenied: string;
  email: string;
  password: string;
  signIn: string;
}>;

export function LoginForm({
  labels,
  initialError = null,
}: Readonly<{
    labels: StaffLoginLabels;
    initialError?: StaffLoginActionState;
  }>) {
  const [error, action, pending] = useActionState(
    loginStaffAction,
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
        <label htmlFor="staff-email" className={labelCls}>
          {labels.email}
        </label>
        <input
          id="staff-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={320}
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="staff-password" className={labelCls}>
          {labels.password}
        </label>
        <input
          id="staff-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={4096}
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
