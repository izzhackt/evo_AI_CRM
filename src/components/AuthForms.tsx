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
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
    >
      {labels[code] ?? code}
    </p>
  );
}

export function LoginForm({ labels }: { labels: Labels }) {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
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
      <p className="text-center text-sm text-slate-500">
        <Link href="/register" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
          {labels.noAccount}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ labels }: { labels: Labels }) {
  const [error, action, pending] = useActionState(registerAction, null);
  return (
    <form action={action} className="space-y-4">
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
      <p className="text-center text-sm text-slate-500">
        <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
          {labels.haveAccount}
        </Link>
      </p>
    </form>
  );
}
