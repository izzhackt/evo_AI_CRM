"use client";

import { useActionState } from "react";

import {
  setStudentPortalPasswordAction,
  type StudentPasswordActionState,
} from "@/lib/student-portal-auth-actions";
import { btnCls, inputCls, labelCls } from "@/components/ui";

const ERROR_COPY: Record<Exclude<StudentPasswordActionState, null>, string> = {
  invalidRequest: "Форма недействительна. Обновите страницу и попробуйте снова.",
  passwordMismatch: "Пароли не совпадают.",
  passwordRejected:
    "Используйте пароль длиной не менее 12 символов. Не выбирайте уже скомпрометированный пароль.",
  invalidIdentity:
    "Эта сессия не связана с принятым приглашением. Откройте исходную ссылку ещё раз.",
  authUnavailable: "Сервис входа временно недоступен. Попробуйте снова позже.",
};

export function StudentSetPasswordForm() {
  const [error, action, pending] = useActionState(
    setStudentPortalPasswordAction,
    null,
  );

  return (
    <form action={action} aria-busy={pending} className="mt-6 space-y-5">
      {error ? (
        <p
          id="password-error"
          role="alert"
          aria-live="polite"
          data-password-error={error}
          className="rounded-ctl bg-danger-weak px-3 py-2.5 text-sm font-medium text-danger"
        >
          {ERROR_COPY[error]}
        </p>
      ) : null}

      <div>
        <label htmlFor="student-new-password" className={labelCls}>
          Новый пароль
        </label>
        <input
          id="student-new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={4096}
          aria-describedby={error ? "password-error" : "password-help"}
          className={inputCls}
        />
        <p id="password-help" className="mt-1.5 text-xs leading-5 text-fg-3">
          Не менее 12 символов.
        </p>
      </div>

      <div>
        <label htmlFor="student-password-confirm" className={labelCls}>
          Повторите пароль
        </label>
        <input
          id="student-password-confirm"
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={4096}
          aria-describedby={error ? "password-error" : undefined}
          className={inputCls}
        />
      </div>

      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {pending ? "Сохраняем…" : "Сохранить пароль"}
      </button>
    </form>
  );
}
