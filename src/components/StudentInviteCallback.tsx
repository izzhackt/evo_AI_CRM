"use client";

import { useActionState } from "react";

import {
  verifyStudentInviteAction,
  type StudentInviteVerificationActionState,
} from "@/lib/student-portal-auth-actions";
import { btnCls } from "@/components/ui";

const ERROR_COPY: Record<
  Exclude<StudentInviteVerificationActionState, null>,
  string
> = {
  invalidRequest:
    "Ссылка приглашения или проверка безопасности недействительна. Откройте исходное письмо ещё раз.",
  expiredOrUsed:
    "Ссылка уже использована или срок её действия истёк. Обратитесь к сотруднику EVO, который отправил приглашение.",
  invalidIdentity:
    "Приглашение не совпадает с этой учётной записью. Выйдите и откройте ссылку для нужного email.",
  authUnavailable:
    "Сервис входа временно недоступен. Попробуйте снова позже; новое приглашение сейчас не требуется.",
};

export function StudentInviteCallback({
  csrfToken,
  tokenHash,
}: Readonly<{
  csrfToken: string;
  tokenHash: string;
}>) {
  const [error, action, pending] = useActionState(
    verifyStudentInviteAction,
    null,
  );

  return (
    <form action={action} aria-busy={pending} className="mt-6 space-y-5">
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value="invite" />

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          data-invite-error={error}
          className="rounded-ctl bg-danger-weak px-3 py-2.5 text-sm font-medium text-danger"
        >
          {ERROR_COPY[error]}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={`${btnCls} w-full`}>
        {pending ? "Проверяем приглашение…" : "Продолжить"}
      </button>
    </form>
  );
}
