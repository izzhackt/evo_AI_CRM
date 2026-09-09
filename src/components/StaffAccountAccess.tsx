"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { acceptStaffAccountAction, setStaffPasswordAction, type StaffAccountState } from "@/lib/staff-account-actions";
import { logoutStaffAction } from "@/lib/staff-auth-actions";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";

const INITIAL: StaffAccountState = { ready: false, email: "", error: "" };

function PasswordForm({ account }: { account: StaffAccountState }) {
  const [state, action, pending] = useActionState(setStaffPasswordAction, account);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return <form action={action} aria-busy={pending} className="mt-5 space-y-4">
    <p className="break-words text-sm leading-6">Вы меняете пароль для <strong>{account.email}</strong>. Если это не ваш адрес, выйдите и откройте своё приглашение.</p>
    <label className="block text-sm">Новый пароль<input className={`${inputCls} mt-1 min-h-11 w-full`} type="password" name="password" required
      autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <p className="text-xs text-fg-3">От 12 до 128 символов.</p>
    <label className="block text-sm">Повторите пароль<input className={`${inputCls} mt-1 min-h-11 w-full`} type="password" name="confirmation" required
      autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    {state.error ? <p role="alert" className="text-sm leading-6 text-danger">{state.error}</p> : null}
    <button disabled={pending || !state.ready} className={`${btnCls} min-h-11 w-full`}>{pending ? "Сохраняем пароль…" : "Сохранить пароль и перейти ко входу"}</button>
  </form>;
}

export function StaffAccountAccess({ initial = INITIAL }: { initial?: StaffAccountState }) {
  const link = useRef<Record<string, string> | null>(null);
  const [state, action, pending] = useActionState(async (previous: StaffAccountState, form: FormData) => {
    if (link.current === null) {
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      link.current = {};
      for (const key of ["token_hash", "type", "code", "access_token", "refresh_token"]) {
        const value = fragment.get(key) ?? query.get(key);
        if (value) link.current[key] = value;
      }
      // Remove secrets from the visible URL/history before the network request.
      window.history.replaceState(null, "", "/auth/staff");
    }
    for (const [key, value] of Object.entries(link.current)) form.set(key, value);
    const result = await acceptStaffAccountAction(previous, form);
    if (result.ready) link.current = {};
    return result;
  }, initial);
  return <>
    {state.ready ? <PasswordForm account={state} /> : <form action={action} aria-busy={pending} className="mt-5 space-y-4">
      <p className="text-sm leading-6 text-fg-3">Нажмите «Продолжить», чтобы подтвердить приглашение или восстановление входа. Затем задайте свой пароль.</p>
      {state.error ? <p role="alert" className="text-sm leading-6 text-danger">{state.error}</p> : null}
      <button className={`${btnCls} min-h-11 w-full`} disabled={pending}>{pending ? "Проверяем ссылку…" : "Продолжить"}</button>
    </form>}
    {state.ready ? <form action={logoutStaffAction}><button className={`${btnGhostCls} mt-4 min-h-11 w-full`}>Это не мой аккаунт — выйти</button></form>
      : <Link className={`${btnGhostCls} mt-4 min-h-11 w-full`} href="/login">Перейти ко входу</Link>}
  </>;
}
