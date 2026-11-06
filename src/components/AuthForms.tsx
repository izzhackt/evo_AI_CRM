"use client";

import Link from "next/link";
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
  rememberDevice: string;
  rememberDeviceHint: string;
}>;

export function LoginForm({
  labels,
  initialError = null,
  recovery,
}: Readonly<{
    labels: StaffLoginLabels;
    initialError?: StaffLoginActionState;
    /** Student self-service recovery; staff recovery stays admin-driven. */
    recovery?: Readonly<{ href: string; label: string }>;
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
          data-auth-error={error}
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
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
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
        {recovery ? (
          <div className="mt-1 flex justify-end">
            <Link
              href={recovery.href}
              className="inline-flex min-h-11 items-center text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline focus-visible:underline"
            >
              {recovery.label}
            </Link>
          </div>
        ) : null}
      </div>

      {/* «Это моё устройство», как у образца akylman.org.kg/login: без галочки вход до закрытия браузера. */}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-5 text-fg-2">
        <input
          type="checkbox"
          name="remember_device"
          value="1"
          defaultChecked
          className="login-remember mt-0.5 size-5 shrink-0 cursor-pointer"
        />
        <span>
          <span className="text-fg">{labels.rememberDevice}</span>
          <span className="block">{labels.rememberDeviceHint}</span>
        </span>
      </label>

      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {labels.signIn}
      </button>
    </form>
  );
}
