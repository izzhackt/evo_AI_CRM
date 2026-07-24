"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, registerAction } from "@/lib/actions";
import { btnCls, inputCls, labelCls } from "./ui";

type Labels = Record<string, string>;

function ErrorMsg({ code, id, labels }: { code: string | null; id: string; labels: Labels }) {
  if (!code) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="rounded-ctl bg-danger-weak px-3 py-2.5 text-[13px] font-medium text-danger"
    >
      {labels[code] ?? code}
    </p>
  );
}

export function LoginForm({ labels }: { labels: Labels }) {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} aria-labelledby="login-title" aria-busy={pending} className="space-y-5">
      <ErrorMsg code={error} id="login-error" labels={labels} />
      <div>
        <label htmlFor="login-email" className={labelCls}>{labels.email}</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="login-password" className={labelCls}>{labels.password}</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={error ? "login-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {labels.signIn}
      </button>
      <p className="text-center text-[13px] text-fg-3">
        <Link
          href="/register"
          className="inline-flex min-h-11 items-center justify-center rounded-ctl px-2 text-pretty font-semibold text-accent transition-[color] duration-150 ease-out hover:underline"
        >
          {labels.noAccount}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ labels }: { labels: Labels }) {
  const [error, action, pending] = useActionState(registerAction, null);
  return (
    <form action={action} aria-busy={pending} className="space-y-4">
      <ErrorMsg code={error} id="register-error" labels={labels} />
      <div>
        <label htmlFor="register-name" className={labelCls}>{labels.name}</label>
        <input
          id="register-name"
          name="name"
          autoComplete="name"
          required
          aria-describedby={error ? "register-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="register-email" className={labelCls}>{labels.email}</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={error ? "register-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="register-phone" className={labelCls}>{labels.phone}</label>
        <input id="register-phone" name="phone" type="tel" autoComplete="tel" className={inputCls} placeholder="+996 ___ ___ ___" />
      </div>
      <div>
        <label htmlFor="register-password" className={labelCls}>{labels.password}</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          aria-describedby={error ? "register-error" : undefined}
          aria-invalid={error ? "true" : undefined}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {labels.signUp}
      </button>
      <p className="text-center text-[13px] text-fg-3">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-ctl px-2 text-pretty font-semibold text-accent transition-[color] duration-150 ease-out hover:underline"
        >
          {labels.haveAccount}
        </Link>
      </p>
    </form>
  );
}
