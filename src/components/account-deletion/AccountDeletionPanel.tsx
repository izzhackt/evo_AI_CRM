"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { accountDeletionDate, type OwnAccountDeletion } from "@/lib/account-deletion-contract";
import { requestOwnAccountDeletionAction } from "@/lib/account-deletion/own-actions";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

export type AccountDeletionStrings = PortalStrings<"accountDeletion">;

/**
 * Классы двух миров: кабинет студента рисует себя `pt-*` (portal.css),
 * анкета и экран ожидания — токенами Tailwind. Разметка и поведение одни.
 */
const LOOKS = {
  portal: {
    root: "pt-profile-deletion",
    text: "pt-profile-hint",
    status: "pt-profile-deletion-state",
    strong: "pt-account-deletion-strong",
    confirm: "pt-account-deletion-confirm",
    question: "pt-account-deletion-question",
    actions: "pt-account-deletion-actions",
    danger: "pt-btn-danger",
    dangerSolid: "pt-btn-danger pt-btn-danger-solid",
    ghost: "pt-btn-ghost",
    error: "pt-account-deletion-error",
  },
  apply: {
    root: "flex flex-col items-start gap-3",
    text: "text-sm leading-6 text-fg-2",
    status: "text-sm leading-6 text-fg-2",
    strong: "font-semibold text-fg",
    confirm: "flex w-full flex-col gap-3 rounded-ctl border border-border bg-surface-2 p-4",
    question: "text-base font-semibold text-fg",
    actions: "flex flex-col gap-2 sm:flex-row",
    danger: "inline-flex min-h-11 items-center justify-center rounded-ctl border border-danger px-4 text-sm font-semibold text-danger hover:bg-danger-weak disabled:cursor-progress disabled:opacity-60",
    dangerSolid: "inline-flex min-h-11 items-center justify-center rounded-ctl border border-accent bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-2 disabled:cursor-progress disabled:opacity-60",
    ghost: "inline-flex min-h-11 items-center justify-center rounded-ctl border border-border bg-surface px-4 text-sm font-semibold text-fg-2 hover:text-fg disabled:opacity-60",
    error: "text-sm text-danger",
  },
} as const;

/**
 * «Удалить аккаунт» (миграция 279, решения владельца 07.10.2026, App Store
 * 5.1.1(v)). Любой вошедший аккаунт, в том числе анкета без одобрения.
 * Действие необратимо, поэтому второй шаг подтверждения — тут же, без окна:
 * вопрос, последствия, «Да, удалить аккаунт» и «Отмена». Статус приходит с
 * сервера: после перезагрузки и на другом устройстве видно тот же запрос.
 * request_id стабилен на попытку — повтор нажатия и сбой сети безопасны.
 */
export function AccountDeletionPanel({
  initialRequest,
  unavailable = false,
  strings,
  look,
}: Readonly<{
  initialRequest: OwnAccountDeletion | null;
  unavailable?: boolean;
  strings: AccountDeletionStrings;
  look: keyof typeof LOOKS;
}>) {
  const cls = LOOKS[look];
  const [requestId] = useState(() => crypto.randomUUID());
  const [request, setRequest] = useState(initialRequest);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const questionId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const sentNow = request !== null && request !== initialRequest;

  // Фокус следует за шагом: вопрос подтверждения, затем статус принятого
  // запроса (кнопка, на которой он стоял, исчезает).
  useEffect(() => { if (confirming) questionRef.current?.focus(); }, [confirming]);
  useEffect(() => { if (sentNow) statusRef.current?.focus(); }, [sentNow]);

  if (unavailable && request === null) {
    return <p role="alert" className={cls.error}>{strings.unavailable}</p>;
  }

  if (request !== null) {
    return (
      <div
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className={cls.root}
        data-testid="account-deletion-status"
        data-status={request.status}
      >
        {request.status === "processing" ? (
          <p className={cls.status}>{strings.processing}</p>
        ) : (
          <>
            <p className={cls.status}>
              <span className={cls.strong}>
                {formatPortalString(strings.requested, { date: accountDeletionDate(request.requestedAt) })}
              </span>
            </p>
            <p className={cls.status}>{formatPortalString(strings.due, { date: accountDeletionDate(request.dueAt) })}</p>
          </>
        )}
        <p className={cls.text}>{strings.keptNote}</p>
      </div>
    );
  }

  return (
    <div className={cls.root} data-testid="account-deletion-panel">
      <p className={cls.text}>{strings.description}</p>
      <p className={cls.text}>{strings.keptNote}</p>
      {confirming ? (
        <div className={cls.confirm} role="group" aria-labelledby={questionId}>
          <p
            id={questionId}
            tabIndex={-1}
            ref={questionRef}
            className={cls.question}
          >
            {strings.confirmQuestion}
          </p>
          <p className={cls.text}>{strings.confirmNote}</p>
          <div className={cls.actions}>
            <button
              type="button"
              className={cls.dangerSolid}
              disabled={pending}
              aria-busy={pending || undefined}
              data-testid="account-deletion-confirm"
              onClick={() => {
                setFailed(false);
                startTransition(async () => {
                  try {
                    const result = await requestOwnAccountDeletionAction(requestId);
                    if (result.ok) setRequest(result.request);
                    else setFailed(true);
                  } catch {
                    setFailed(true);
                  }
                });
              }}
            >
              {pending ? strings.sending : strings.confirmYes}
            </button>
            <button
              type="button"
              className={cls.ghost}
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setFailed(false);
                requestAnimationFrame(() => actionRef.current?.focus());
              }}
            >
              {strings.cancel}
            </button>
          </div>
          {failed ? <p role="alert" className={cls.error}>{strings.error}</p> : null}
        </div>
      ) : (
        <button
          ref={actionRef}
          type="button"
          className={cls.danger}
          data-testid="account-deletion-start"
          onClick={() => setConfirming(true)}
        >
          {strings.action}
        </button>
      )}
    </div>
  );
}
