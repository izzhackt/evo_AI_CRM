"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId } from "react";

import { btnCls } from "@/components/ui";
import {
  retryAccountDeletionEmailAction,
  type AccountDeletionActionState,
} from "@/lib/account-deletion/staff-actions";

const IDLE: AccountDeletionActionState = { status: "idle", step: null, emailStatus: null };

/** Итог письма словами карточки (те же, что у выполненного запроса). */
const RECORDED = {
  sent: "Письмо отправлено, статус записан.",
  failed: "Письмо не отправлено: ошибка почты. Статус записан, повторить уже нельзя.",
  not_configured: "Письмо не отправлено: почта в CRM не настроена. Статус записан.",
  no_address: "Письмо не отправлено: адреса нет. Статус записан.",
} as const;

/**
 * «Повторить письмо» у выполненного запроса, статус письма которого не записан
 * (ревью 280: F1 и UI-F2). Показывается только пока адрес ещё хранится в
 * запросе; после записи статуса адрес удаляется, и повторять нечего. Ничего не
 * удаляется, слова подтверждения нет. Ответ честный: статус записан или шаг,
 * на котором остановилось.
 */
export function AccountDeletionEmailRetry({
  requestRowId,
  requestedAt,
}: Readonly<{ requestRowId: string; requestedAt: string }>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(retryAccountDeletionEmailAction, IDLE);
  const errorId = useId();

  useEffect(() => { if (state.status === "completed") router.refresh(); }, [state, router]);

  const error = state.status === "failed"
    ? state.step === "email"
      ? "Статус письма снова не записался. Повторите."
      : "Не удалось получить запрос из базы. Обновите страницу и повторите."
    : state.status === "forbidden" ? "Повторять письмо может только администратор, не в режиме просмотра роли."
      : state.status === "invalid" ? "Запрос не распознан. Обновите страницу." : null;

  if (state.status === "completed" && state.emailStatus) {
    return <p role="status" className="t-body-compact text-fg" data-testid="v3-deletion-email-recorded">{RECORDED[state.emailStatus]}</p>;
  }

  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex max-w-xl flex-col items-start gap-2 rounded-card border border-border bg-surface px-4 py-3"
      data-testid="v3-deletion-email-retry"
    >
      <input type="hidden" name="request_row_id" value={requestRowId} />
      <input type="hidden" name="requested_at" value={requestedAt} />
      <p className="t-body-compact text-fg">
        Статус письма об удалении не записан, адрес человека ещё хранится в запросе. Письмо уйдёт заново, статус запишется, а
        адрес после этого удалится.
      </p>
      <button type="submit" className={btnCls} disabled={pending} aria-describedby={error ? errorId : undefined}>
        {pending ? "Отправляем…" : "Повторить письмо"}
      </button>
      {error ? <p id={errorId} role="alert" className="t-body-compact text-danger">{error}</p> : null}
    </form>
  );
}
