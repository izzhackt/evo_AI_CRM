"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { btnCls, btnGhostCls, cn, inputCls } from "@/components/ui";
import { ACCOUNT_DELETION_CONFIRM_WORD } from "@/lib/account-deletion-contract";
import {
  processAccountDeletionAction,
  type AccountDeletionProcessState,
} from "@/lib/account-deletion/staff-actions";

const IDLE: AccountDeletionProcessState = { status: "idle", step: null, emailStatus: null };

/** Что не получилось и что делать — словами шага, без кода ошибки. */
const FAILED: Readonly<Record<NonNullable<AccountDeletionProcessState["step"]>, string>> = {
  process: "База не выполнила удаление. Ничего не удалено или удаление можно повторить: нажмите ещё раз.",
  config: "На сервере не настроен ключ Supabase service role: файлы и вход удалить нельзя. Нужен технический специалист.",
  storage: "Строки базы удалены, но файлы не удалились. Повторите удаление.",
  auth: "Строки и файлы удалены, но вход в аккаунт не удалился. Повторите удаление.",
  complete: "Файлы и вход удалены, но база не подтвердила завершение. Повторите удаление.",
};

/**
 * Разрушительное действие запроса (миграция 279). Первый шаг только
 * раскрывает подтверждение тут же: что произойдёт и поле для слова
 * «удалить». «Удалить навсегда» активна только с этим словом. Ответ сервера
 * — честный: выполнено (страница перечитывается и показывает итог) или на
 * каком шаге остановилось; повтор безопасен.
 */
export function AccountDeletionProcess({
  requestRowId,
  requestedAt,
  displayName,
  retry,
}: Readonly<{ requestRowId: string; requestedAt: string; displayName: string; retry: boolean }>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(processAccountDeletionAction, IDLE);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmed = word.trim().toLocaleLowerCase("ru") === ACCOUNT_DELETION_CONFIRM_WORD;

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (state.status === "completed") router.refresh(); }, [state, router]);

  const error = state.status === "failed" && state.step ? FAILED[state.step]
    : state.status === "invalid" ? "Введите слово «удалить», чтобы подтвердить."
      : state.status === "forbidden" ? "Удалять аккаунты может только администратор, не в режиме просмотра роли." : null;

  if (state.status === "completed") {
    return <p role="status" className="t-body-compact text-fg" data-testid="v3-deletion-done">Удалено. Обновляем карточку.</p>;
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button ref={startRef} type="button" className={btnCls} onClick={() => setOpen(true)} data-testid="v3-deletion-start">
          {retry ? "Повторить удаление" : "Удалить аккаунт и данные"}
        </button>
        {error ? <p role="alert" className="t-body-compact text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex max-w-xl flex-col gap-3 rounded-card border border-border bg-surface px-4 py-4"
      data-testid="v3-deletion-confirm"
    >
      <input type="hidden" name="request_row_id" value={requestRowId} />
      <input type="hidden" name="requested_at" value={requestedAt} />
      <p className="t-section text-fg">Удалить аккаунт «{displayName}»?</p>
      <p id={hintId} className="t-body-compact text-fg-2">
        Отменить нельзя. Вход в аккаунт, файлы и личные данные удаляются сразу, договор и оплаты остаются обезличенными.
        Чтобы подтвердить, введите слово «удалить».
      </p>
      <div>
        <label htmlFor={inputId} className="t-label block text-fg">Слово для подтверждения</label>
        <input
          ref={inputRef}
          id={inputId}
          name="confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={word}
          disabled={pending}
          onChange={(event) => setWord(event.target.value)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={state.status === "invalid" ? true : undefined}
          className={cn(inputCls, "mt-1 max-w-xs aria-[invalid=true]:border-danger")}
          data-testid="v3-deletion-word"
        />
      </div>
      {error ? <p id={errorId} role="alert" className="t-body-compact text-danger">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          className={cn(btnGhostCls, "whitespace-nowrap")}
          disabled={pending}
          onClick={() => { setOpen(false); setWord(""); requestAnimationFrame(() => startRef.current?.focus()); }}
        >
          Отмена
        </button>
        <button type="submit" className={cn(btnCls, "whitespace-nowrap")} disabled={pending || !confirmed} data-testid="v3-deletion-submit">
          {pending ? "Удаляем…" : "Удалить навсегда"}
        </button>
      </div>
    </form>
  );
}
