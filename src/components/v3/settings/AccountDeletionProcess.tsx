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
  process: "База не выполнила удаление, данные не изменены. Повторите.",
  review: "В «Проверить вручную» есть записи без решения. Решите по каждой и повторите.",
  amocrm: "Строки базы удалены. Отметьте, что контакт и сделка в amoCRM удалены, и повторите удаление.",
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
 * каком шаге остановилось; повтор безопасен. Пока в «Проверить вручную» есть
 * запись без решения (`reviewOpen`), начать нельзя: база тоже отказывает.
 * Если у человека есть связи с amoCRM (`amocrmContacts`, номера в
 * `amocrmIds`), amoCRM чистит Admin вручную: без флажка «Контакт и сделка в
 * amoCRM удалены» кнопка неактивна, база тоже проверяет.
 */
export function AccountDeletionProcess({
  requestRowId,
  requestedAt,
  displayName,
  retry,
  amocrmContacts,
  amocrmIds,
  reviewOpen,
}: Readonly<{
  requestRowId: string;
  requestedAt: string;
  displayName: string;
  retry: boolean;
  amocrmContacts: number;
  amocrmIds: string | null;
  reviewOpen: number;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(processAccountDeletionAction, IDLE);
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [amocrmErased, setAmocrmErased] = useState(false);
  const amocrmRequired = amocrmContacts > 0;
  const inputId = useId();
  const amocrmId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmed = word.trim().toLocaleLowerCase("ru") === ACCOUNT_DELETION_CONFIRM_WORD
    && (!amocrmRequired || amocrmErased);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (state.status === "completed") router.refresh(); }, [state, router]);

  const error = state.status === "failed" && state.step ? FAILED[state.step]
    : state.status === "invalid" ? "Введите слово «удалить», чтобы подтвердить."
      : state.status === "forbidden" ? "Удалять аккаунты может только администратор, не в режиме просмотра роли." : null;

  if (state.status === "completed") {
    return <p role="status" className="t-body-compact text-fg" data-testid="v3-deletion-done">Удалено. Обновляем карточку.</p>;
  }

  if (!open || reviewOpen > 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button ref={startRef} type="button" className={btnCls} onClick={() => setOpen(true)} disabled={reviewOpen > 0}
          aria-describedby={reviewOpen > 0 ? hintId : undefined} data-testid="v3-deletion-start">
          {retry ? "Повторить удаление" : "Удалить аккаунт и данные"}
        </button>
        {reviewOpen > 0 ? (
          <p id={hintId} className="t-body-compact text-fg-2" data-testid="v3-deletion-review-blocked">
            Сначала решите по записям в «Проверить вручную»: без решения {reviewOpen}.
          </p>
        ) : null}
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
      <input type="hidden" name="amocrm_erased" value={amocrmErased ? "1" : "0"} />
      <p className="t-section text-fg">Удалить аккаунт «{displayName}»?</p>
      <p id={hintId} className="t-body-compact text-fg-2">
        Отменить нельзя. Вход в аккаунт, его файлы и записи удаляются сразу, договор и оплаты остаются обезличенными.
        Записи других людей меняются только вашими решениями в «Проверить вручную», а из журнала по записям
        человека уходят только его данные. Чтобы подтвердить, введите слово «удалить».
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
      {amocrmRequired ? (
        <div className="flex items-start gap-2">
          <input
            id={amocrmId}
            type="checkbox"
            checked={amocrmErased}
            disabled={pending}
            onChange={(event) => setAmocrmErased(event.target.checked)}
            className="mt-1 size-4 shrink-0"
            data-testid="v3-deletion-amocrm"
          />
          <label htmlFor={amocrmId} className="t-body-compact text-fg">
            Контакт и сделка в amoCRM удалены
            <span className="block text-fg-2">amoCRM не связана с удалением в CRM: удалите их в amoCRM сами.</span>
            {amocrmIds ? <span className="block text-fg-2">{amocrmIds}</span> : null}
          </label>
        </div>
      ) : null}
      {error ? <p id={errorId} role="alert" className="t-body-compact text-danger">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          className={cn(btnGhostCls, "whitespace-nowrap")}
          disabled={pending}
          onClick={() => {
            setOpen(false); setWord(""); setAmocrmErased(false);
            requestAnimationFrame(() => startRef.current?.focus());
          }}
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
