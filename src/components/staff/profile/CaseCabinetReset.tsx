"use client";

import { useActionState, useId, useRef, useState } from "react";

import { btnGhostCls, cn } from "@/components/ui";
import { studentPasswordResetMessage, type StudentPasswordResetActionState } from "@/lib/student-account-contract";
import { resetStudentPasswordAction } from "@/lib/student-password-reset-actions";

const MESSAGES: Readonly<Record<Exclude<StudentPasswordResetActionState["status"], "idle" | "reset">, string>> = {
  already_reset: "Этот сброс уже выполнен, но пароль не дошёл. Сбросьте ещё раз.",
  invalid: "Пароль не сброшен. Обновите страницу.",
  forbidden: "Пароли сбрасывает только администратор.",
  no_cabinet: "У студента этого дела нет кабинета.",
  unavailable: "Новый пароль не выдан. Повторите сброс.",
};

/**
 * «Кабинет открыт», чем студент входит, и «Сбросить пароль» (344, 07.11.2026). Старый пароль перестаёт работать,
 * поэтому сначала подтверждение. Новый временный пароль виден один раз — CRM его не хранит; блок стоит на одном месте,
 * и при обновлении карточки показанный пароль не пропадает.
 */
export function CaseCabinetReset({ studentCaseId, requestId, login, email, portalOrigin }: Readonly<{
  studentCaseId: string;
  requestId: string;
  login: string | null;
  email: string | null;
  portalOrigin: string;
}>) {
  const id = useId();
  const [state, action, pending] = useActionState(resetStudentPasswordAction, { status: "idle", requestId } as StudentPasswordResetActionState);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const signIn = login
    ? <p>Логин: <span className="font-mono text-fg">{login}</span></p>
    : email ? <p>Почта: <span className="break-all font-mono text-fg">{email}</span></p> : null;

  if (state.status === "reset") {
    const { password } = state;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(studentPasswordResetMessage({ login, email }, password, portalOrigin));
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="space-y-2 text-sm text-fg-2" data-testid="case-cabinet-reset-done">
        <p role="alert" className="t-body-compact text-danger">Пароль виден только сейчас: отправьте его студенту.</p>
        {signIn}
        <p>Временный пароль: <span className="font-mono text-fg">{password}</span></p>
        <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={copy}>Скопировать сообщение для WhatsApp</button>
        <p role="status" aria-live="polite" className="t-meta">{copied ? "Сообщение скопировано." : ""}</p>
      </div>
    );
  }

  const open = () => {
    if (pending) return;
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  };
  const close = () => {
    setConfirming(false);
    requestAnimationFrame(() => openRef.current?.focus());
  };

  return (
    <div className="space-y-2 text-sm text-fg-2" data-testid="case-cabinet-open">
      <p className="t-body-compact text-fg">Кабинет открыт.</p>
      {signIn}
      <form action={action} onSubmit={close}>
        <input type="hidden" name="request_id" value={state.requestId} />
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        {confirming ? (
          <div role="group" aria-labelledby={`${id}-confirm`} data-testid="case-cabinet-reset-confirm"
            className="max-w-md space-y-2 rounded-ctl border border-border bg-bg px-3 py-2.5">
            <p id={`${id}-confirm`} className="t-body-compact text-fg">Старый пароль студента перестанет работать. Сбросить?</p>
            <div className="flex flex-wrap gap-2">
              <button ref={confirmRef} type="submit" className={cn(btnGhostCls, "min-h-11")}>Сбросить</button>
              <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={close}>Отмена</button>
            </div>
          </div>
        ) : (
          <button ref={openRef} type="button" aria-disabled={pending || undefined} className={cn(btnGhostCls, "min-h-11")} onClick={open}>
            {pending ? "Сбрасываем…" : "Сбросить пароль"}
          </button>
        )}
      </form>
      {state.status !== "idle" ? <p role="alert" className="t-body-compact text-danger">{MESSAGES[state.status]}</p> : null}
    </div>
  );
}
