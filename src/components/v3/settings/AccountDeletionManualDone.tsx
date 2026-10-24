"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { btnGhostCls, cn, inputCls } from "@/components/ui";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import {
  ACCOUNT_DELETION_DONE_WORD,
  ACCOUNT_DELETION_NOTE_MAX,
  ACCOUNT_DELETION_NOTE_MIN,
  checkAccountDeletionNote,
} from "@/lib/account-deletion-contract";
import {
  markAccountDeletionDoneAction,
  type AccountDeletionActionState,
} from "@/lib/account-deletion/staff-actions";

const IDLE: AccountDeletionActionState = { status: "idle", step: null, emailStatus: null };

const FAILED: Readonly<Partial<Record<NonNullable<AccountDeletionActionState["step"]>, string>>> = {
  login: "Вход в аккаунт ещё работает. Сначала технический администратор удаляет или отключает вход, затем отметьте выполненным.",
  automatic: "Связанных записей больше нет: этот аккаунт удаляется автоматически. Обновите страницу.",
  invalid: "Заметка должна быть от 10 до 2000 знаков.",
  processing: "Автоматическое удаление уже начато. Завершите его кнопкой «Повторить удаление».",
  mark: "База не отметила запрос выполненным. Повторите.",
  email: "Запрос отмечен выполненным, но статус письма не записался. Карточка обновится: письмо можно повторить там.",
};

/**
 * «Отметить выполненным» (ручная обработка, миграция 280): Admin
 * подтверждает, что команда сделала всё по списку. Заметка обязательна
 * (что сделано, без личных данных человека): она остаётся в запросе и в
 * журнале действий. Подтверждение словом «выполнено». Пока вход в аккаунт
 * работает, кнопка неактивна; база проверяет это сама. Правило заметки (от 10
 * до 2000 знаков) и счётчик стоят под полем, а под неактивной кнопкой сказано,
 * чего не хватает (ревью 280, UI-F1).
 */
export function AccountDeletionManualDone({
  requestRowId,
  requestedAt,
  displayName,
  loginActive,
}: Readonly<{
  requestRowId: string;
  requestedAt: string;
  displayName: string;
  loginActive: boolean;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(markAccountDeletionDoneAction, IDLE);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [word, setWord] = useState("");
  const noteId = useId();
  const noteHintId = useId();
  const noteRuleId = useId();
  const submitHintId = useId();
  const wordId = useId();
  const hintId = useId();
  const errorId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const check = checkAccountDeletionNote(note);
  const noteOk = check.ok;
  const wordOk = word.trim().toLocaleLowerCase("ru") === ACCOUNT_DELETION_DONE_WORD;
  const confirmed = noteOk && wordOk;
  // Что мешает нажать: одна фраза под кнопкой (под, а не над ней: кнопка не сдвигается, когда фраза исчезает).
  const blocker = confirmed ? null
    : !noteOk && !wordOk ? (check.control ? "уберите из заметки недопустимые знаки и введите слово «выполнено»" : "допишите заметку и введите слово «выполнено»")
      : !noteOk ? (check.control ? "уберите из заметки недопустимые знаки" : "допишите заметку")
        : "введите слово «выполнено»";

  useEffect(() => { if (open) noteRef.current?.focus(); }, [open]);
  // Не удалось только записать статус письма: запрос уже выполнен, карточка покажет «Повторить письмо».
  useEffect(() => {
    if (state.status === "completed" || state.step === "automatic" || state.step === "email") router.refresh();
  }, [state, router]);

  const error = state.status === "failed" && state.step
    ? FAILED[state.step] ?? "Не удалось отметить выполненным. Повторите."
    : state.status === "invalid" ? "Напишите заметку (от 10 знаков) и введите слово «выполнено»."
      : state.status === "forbidden" ? "Отмечать может только администратор, не в режиме просмотра роли." : null;

  if (state.status === "completed") {
    return <p role="status" className="t-body-compact text-fg" data-testid="v3-deletion-done">Отмечено выполненным. Обновляем карточку.</p>;
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button ref={startRef} type="button" className={btnGhostCls} onClick={() => setOpen(true)} disabled={loginActive}
          aria-describedby={loginActive ? hintId : undefined} data-testid="v3-deletion-manual-start">
          Отметить выполненным
        </button>
        {loginActive ? (
          <p id={hintId} className="t-body-compact max-w-[70ch] text-fg-2" data-testid="v3-deletion-login-blocked">
            Кнопка станет доступна, когда технический администратор удалит или отключит вход в аккаунт (пункт 7).
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
      data-testid="v3-deletion-manual-confirm"
    >
      <input type="hidden" name="request_row_id" value={requestRowId} />
      <input type="hidden" name="requested_at" value={requestedAt} />
      <p className="t-section text-fg">Отметить удаление «{displayName}» выполненным?</p>
      <p id={hintId} className="t-body-compact text-fg-2">
        Отметьте, только когда все пункты списка сделаны. Отменить нельзя: запрос закроется, человеку уйдёт письмо,
        если почта настроена.
      </p>
      <div>
        <label htmlFor={noteId} className="t-label block text-fg">Что сделано</label>
        <textarea
          ref={noteRef}
          id={noteId}
          name="note"
          rows={4}
          maxLength={ACCOUNT_DELETION_NOTE_MAX}
          value={note}
          disabled={pending}
          onChange={(event) => setNote(event.target.value)}
          aria-describedby={`${noteRuleId} ${noteHintId}`}
          aria-invalid={(state.status === "invalid" && !noteOk) || check.control ? true : undefined}
          className={cn(inputCls, "mt-1 h-auto py-2 aria-[invalid=true]:border-danger")}
          data-testid="v3-deletion-note"
        />
        <p id={noteRuleId} className={cn("t-meta mt-1 tabular-nums", check.control ? "text-danger" : "text-fg-2")}
          data-testid="v3-deletion-note-rule">
          {check.control
            ? "В заметке есть недопустимые знаки: уберите их."
            : `Нужно от ${ACCOUNT_DELETION_NOTE_MIN} до ${ACCOUNT_DELETION_NOTE_MAX} знаков. Введено ${check.length}${check.missing > 0 ? `, не хватает ${check.missing}` : ""}.`}
        </p>
        <p id={noteHintId} className="t-meta mt-1 text-fg-2">
          Например: «Дело, документы, чаты и лид удалены, контакт и сделка в amoCRM удалены, договор и оплаты
          обезличены, вход отключён». Без имени, телефона и других данных человека: заметка хранится в журнале.
        </p>
      </div>
      <div>
        <label htmlFor={wordId} className="t-label block text-fg">Слово для подтверждения: «выполнено»</label>
        <input
          id={wordId}
          name="confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={word}
          disabled={pending}
          onChange={(event) => setWord(event.target.value)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          className={cn(inputCls, "mt-1 max-w-xs")}
          data-testid="v3-deletion-done-word"
        />
      </div>
      {error ? <p id={errorId} role="alert" className="t-body-compact text-danger">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          className={cn(btnGhostCls, "whitespace-nowrap")}
          disabled={pending}
          onClick={() => {
            setOpen(false); setWord("");
            requestAnimationFrame(() => startRef.current?.focus());
          }}
        >
          Отмена
        </button>
        <button type="submit" className={cn(QUEUE_CONFIRM, "whitespace-nowrap")} disabled={pending || !confirmed}
          aria-describedby={blocker && !pending ? submitHintId : undefined} data-testid="v3-deletion-done-submit">
          {pending ? "Отмечаем…" : "Отметить выполненным"}
        </button>
      </div>
      {blocker && !pending ? (
        <p id={submitHintId} className="t-meta text-fg-2" data-testid="v3-deletion-submit-hint">
          Чтобы отметить выполненным, {blocker}.
        </p>
      ) : null}
    </form>
  );
}
