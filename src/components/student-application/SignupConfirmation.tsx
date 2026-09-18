"use client";

import { useActionState } from "react";
import Link from "next/link";
import { confirmStudentSignupAction } from "@/lib/student-signup-actions";

export function SignupConfirmation({ csrfToken, code, tokenHash }: { csrfToken: string; code: string; tokenHash: string }) {
  const [state, action, pending] = useActionState(confirmStudentSignupAction, { status: "idle" } as const);
  return <form action={action} className="mt-6 space-y-4">
    <input type="hidden" name="csrf_token" value={csrfToken} />
    <input type="hidden" name="code" value={code} />
    <input type="hidden" name="token_hash" value={tokenHash} />
    {state.status !== "idle" && <p role="alert" className="text-sm leading-6 text-danger">
      {state.status === "expired" ? "Не удалось завершить вход по ссылке. Если email уже подтверждён, войдите с вашим паролем — анкета сохранена." : "Не удалось подтвердить аккаунт. Откройте исходную ссылку из письма или повторите позже."}
    </p>}
    <button disabled={pending} className="min-h-12 w-full rounded-ctl bg-accent px-5 font-semibold text-on-accent disabled:opacity-60">{pending ? "Подтверждаем…" : "Подтвердить email"}</button>
    <Link href="/login" className="flex min-h-11 items-center justify-center text-sm font-medium text-accent-text underline underline-offset-4">Перейти ко входу</Link>
  </form>;
}
