"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { saveCaseNextActionAction, type CaseNextActionActionState } from "@/lib/platform-case-next-action-actions";
import {
  CASE_NEXT_ACTION_MAX_LENGTH,
  parseCaseNextActionInput,
  type CaseNextActionReceipt,
} from "@/lib/platform-student-case-queue-contract";

import { shiftDay } from "../calendar/types";
import { formatQueueDay, nextFriday } from "../queue/due-bucket";
import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { nextStepChoiceFor, nextStepDueFor, nextStepForm, nextStepInputError, oneLineStep, type NextStepEditorRow } from "./next-step-input";
import type { NextStepDueChoice } from "./students-queue-view";

const CHIP = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";
/** Шаг — одна строка, но длинный текст виден целиком: поле в несколько строк без переносов. */
const STEP_FIELD = "mt-1 block min-h-11 w-full min-w-0 resize-none rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent aria-[invalid=true]:border-danger disabled:bg-surface-2 disabled:text-fg-3 [field-sizing:content]";

type Feedback = Readonly<{ tone: "ok" | "danger"; text: string; stale: boolean }>;

/**
 * «Следующий шаг» в «Быстром просмотре»: одна строка текста и срок с
 * быстрыми вариантами. Сохраняет существующее действие #1054 с request id и
 * ожидаемой версией; «сохранено» — только по квитанции сервера. Неизвестный
 * исход повторяется тем же request id (сервер не сохранит шаг дважды);
 * конфликт версии предлагает «Обновить», набранный текст остаётся.
 */
export function NextStepEditor({
  row,
  today,
  requestId: initialRequestId,
  onSaved,
}: Readonly<{
  row: NextStepEditorRow;
  /** Сегодня в Бишкеке (из чтения 241). */
  today: string;
  requestId: string;
  onSaved: (receipt: CaseNextActionReceipt) => void;
}>) {
  const router = useRouter();
  const fieldId = useId();
  const hasStep = row.nextAction !== null;
  const [text, setText] = useState(row.nextAction ?? "");
  const [choice, setChoice] = useState<NextStepDueChoice>(nextStepChoiceFor(row.nextActionDueOn, hasStep, today));
  const [date, setDate] = useState(row.nextActionDueOn ?? today);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [pending, setPending] = useState(false);
  // Синхронный замок: второй быстрый Enter не дожидается рендера с `pending`.
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [baseline, setBaseline] = useState({ text: row.nextAction ?? "", due: row.nextActionDueOn ?? "", version: row.admissionsVersion });
  const [serverMoved, setServerMoved] = useState(false);

  const due = nextStepDueFor(choice, date, today);
  const dirty = text.trim() !== baseline.text || due !== baseline.due;

  // Строка перечитана (своё сохранение или «Обновить» после конфликта):
  // черновик без правок принимает новое значение, правленый — остаётся, а
  // рядом видно, что сейчас записано в деле.
  if (row.admissionsVersion !== baseline.version) {
    const serverText = row.nextAction ?? "";
    const serverDue = row.nextActionDueOn ?? "";
    setBaseline({ text: serverText, due: serverDue, version: row.admissionsVersion });
    if (!dirty || (text.trim() === serverText && due === serverDue)) {
      setText(serverText);
      setChoice(nextStepChoiceFor(row.nextActionDueOn, row.nextAction !== null, today));
      setDate(row.nextActionDueOn ?? today);
      setServerMoved(false);
    } else {
      setServerMoved(true);
    }
  }

  async function send(nextText: string, nextDue: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFeedback(null);
    try {
      const state: CaseNextActionActionState = await saveCaseNextActionAction(
        { status: "idle", requestId, message: null, receipt: null },
        nextStepForm(row, nextText, nextDue, requestId),
      );
      setRequestId(state.requestId);
      if (state.status === "saved" && state.receipt) {
        setFeedback({ tone: "ok", text: state.message ?? "Следующий шаг сохранён.", stale: false });
        setServerMoved(false);
        onSaved(state.receipt);
      } else {
        setFeedback({ tone: "danger", text: state.message ?? "Не удалось сохранить шаг. Повторите.", stale: state.status === "stale" });
      }
    } catch {
      // Ответа нет — исход неизвестен: тот же request id повторит запись, а не создаст вторую.
      setFeedback({ tone: "danger", text: "Не удалось подтвердить сохранение. Повторите: повтор не сохранит шаг дважды.", stale: false });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = nextStepInputError(text, choice, date, hasStep);
    if (error) { setFeedback({ tone: "danger", text: error, stale: false }); return; }
    if (!parseCaseNextActionInput(text, due)) {
      setFeedback({ tone: "danger", text: `Шаг — одна строка до ${CASE_NEXT_ACTION_MAX_LENGTH} символов.`, stale: false });
      return;
    }
    void send(text, due);
  }

  const friday = nextFriday(today);
  // Когда пятница — завтра, второй кнопки на тот же день нет.
  const chips: readonly (readonly [NextStepDueChoice, string])[] = [
    ["today", "Сегодня"],
    ["tomorrow", "Завтра"],
    ...(friday !== shiftDay(today, 1) ? [["friday", `Пт ${formatQueueDay(friday, today)}`] as const] : []),
    ["date", "Дата…"],
    ["none", "Без срока"],
  ];
  const errorId = `${fieldId}-feedback`;
  const invalid = feedback?.tone === "danger" && !feedback.stale;

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="space-y-3" data-testid="v3-next-step-editor">
      <div>
        <label htmlFor={fieldId} className="block t-label text-fg">Шаг</label>
        <textarea
          id={fieldId}
          value={text}
          rows={2}
          onChange={(event) => setText(oneLineStep(event.target.value))}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            // Enter сохраняет (шаг — одна строка); Shift+Enter переноса тоже не вставляет.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!event.shiftKey) event.currentTarget.form?.requestSubmit();
          }}
          maxLength={CASE_NEXT_ACTION_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="done"
          disabled={pending}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={feedback ? errorId : undefined}
          className={STEP_FIELD}
        />
      </div>
      <fieldset className="min-w-0" disabled={pending}>
        <legend className="t-label text-fg">Срок</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {chips.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)} className={CHIP}>
              {label}
            </button>
          ))}
        </div>
        {choice === "date" ? (
          <label className="mt-3 block t-label text-fg-2">
            Дата
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-invalid={invalid && !date ? true : undefined} className={`${QUEUE_FIELD} aria-[invalid=true]:border-danger`} />
          </label>
        ) : null}
      </fieldset>
      {serverMoved ? (
        <p className="t-body-compact text-fg-2">
          Сейчас в деле: {baseline.text || "шаг не задан"}{baseline.due ? ` · ${formatQueueDay(baseline.due, today)}` : ""}. Сохраните, чтобы заменить.
        </p>
      ) : null}
      {feedback ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p id={errorId} role={feedback.tone === "ok" ? "status" : "alert"} className={`t-body-compact ${feedback.tone === "ok" ? "text-ok" : "text-danger"}`}>
            {feedback.text}
          </p>
          {feedback.stale ? <button type="button" onClick={() => router.refresh()} className={QUEUE_SECONDARY}>Обновить</button> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !dirty} className={QUEUE_CONFIRM}>{pending ? "Сохраняем…" : "Сохранить"}</button>
        {hasStep ? (
          <button type="button" disabled={pending} onClick={() => void send("", "")} className={QUEUE_SECONDARY}>Снять шаг</button>
        ) : null}
      </div>
    </form>
  );
}
