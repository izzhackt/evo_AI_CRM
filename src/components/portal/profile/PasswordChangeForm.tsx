"use client";

import { useActionState, useEffect, useRef } from "react";

import { changeStudentPasswordAction } from "@/lib/student-password-change-actions";
import {
  STUDENT_PASSWORD_CHANGE_INITIAL, STUDENT_PASSWORD_CHANGE_MESSAGE_KEY,
} from "@/lib/student-password-change-contract";
import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * «Профиль → Пароль»: текущий пароль и новый дважды. Поля очищаются после смены; ответ сервера — словом под кнопкой
 * (ошибка — `role="alert"`). Пароль никуда, кроме действия сервера, не уходит.
 */
export function PasswordChangeForm({ strings }: Readonly<{ strings: PortalStrings<"profile"> }>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(changeStudentPasswordAction, STUDENT_PASSWORD_CHANGE_INITIAL);
  useEffect(() => { if (state.status === "done") formRef.current?.reset(); }, [state]);
  const message = state.status === "idle" ? "" : strings[STUDENT_PASSWORD_CHANGE_MESSAGE_KEY[state.status]];
  const good = state.status === "done";

  return (
    <form ref={formRef} action={action} className="pt-password-form" data-testid="portal-password-change">
      <label className="pt-field">
        <span className="pt-field-label">{strings.passwordCurrent}</span>
        <input className="pt-input" type="password" name="current_password" autoComplete="current-password" required />
      </label>
      <label className="pt-field">
        <span className="pt-field-label">{strings.passwordNew}</span>
        <input className="pt-input" type="password" name="password" autoComplete="new-password" minLength={12} required aria-describedby="portal-password-hint" />
      </label>
      <label className="pt-field">
        <span className="pt-field-label">{strings.passwordConfirm}</span>
        <input className="pt-input" type="password" name="password_confirm" autoComplete="new-password" minLength={12} required />
      </label>
      <p id="portal-password-hint" className="pt-password-note">{strings.passwordHint}</p>
      <div className="pt-password-actions">
        <button type="submit" className="pt-btn" disabled={pending}>{pending ? strings.passwordSaving : strings.passwordSubmit}</button>
        <p role={message && !good ? "alert" : "status"} className={good ? "pt-password-note" : "pt-account-deletion-error"}>{message}</p>
      </div>
    </form>
  );
}
