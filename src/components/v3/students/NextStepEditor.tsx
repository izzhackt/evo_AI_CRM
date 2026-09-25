"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";

import { saveCaseNextActionAction, type CaseNextActionActionState } from "@/lib/platform-case-next-action-actions";
import {
  CASE_NEXT_ACTION_MAX_LENGTH,
  parseCaseNextActionInput,
  type CaseNextActionReceipt,
} from "@/lib/platform-student-case-queue-contract";

import { shiftDay } from "../calendar/types";
import { formatQueueDay, nextFriday } from "../queue/due-bucket";
import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { nextStepChoiceFor, nextStepDirty, nextStepDueFor, nextStepForm, nextStepInputError, oneLineStep, type NextStepEditorRow } from "./next-step-input";
import type { NextStepDueChoice } from "./students-queue-view";

/**
 * Быстрый срок — один выбор из пяти, поэтому одна группа кнопок с общими
 * волосяными границами (без зазоров между ними): пять вариантов помещаются в
 * одну строку и в панели 26rem, и на телефоне 390 px, высота каждой — 44 px,
 * группа растягивается на ширину поля. Выбранный вариант — `.v3-choice`
 * поверх соседей (его рамка видна целиком), фокус — тоже поверх.
 */
const SEGMENT = "v3-choice relative -ms-px inline-flex min-h-11 min-w-0 flex-auto items-center justify-center whitespace-nowrap border border-control-edge bg-surface px-1.5 t-label text-fg-2 first:ms-0 first:rounded-s-ctl last:rounded-e-ctl hover:bg-surface-2 hover:text-fg aria-pressed:z-10 focus-visible:z-20";
/**
 * Шаг — одна строка, но длинный текст виден целиком: поле растёт по тексту и
 * не бывает ниже трёх строк (пустое поле не схлопывается в одну).
 */
const STEP_FIELD = "mt-1 block min-h-24 w-full min-w-0 resize-none rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent aria-[invalid=true]:border-danger disabled:bg-surface-2 disabled:text-fg-3 [field-sizing:content]";

/**
 * Сообщение редактора и его место: ошибка ввода — сразу под своим полем
 * (`aria-describedby` + `aria-invalid`), ответ сервера — над кнопками.
 */
type Feedback = Readonly<{ tone: "ok" | "danger"; text: string; field: "step" | "date" | null; stale: boolean }>;

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
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Фокус был в форме перед отправкой или «Обновить»: после ответа он
  // возвращается в поле шага, а не падает на страницу (кнопки «Снять шаг» и
  // «Обновить» могли исчезнуть).
  const restoreFocus = useRef(false);
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
  // Конфликт версии: пока дело не перечитано, «Сохранить» недоступна, главная кнопка — «Обновить».
  const [refreshing, startRefresh] = useTransition();
  const [refreshed, setRefreshed] = useState(false);

  const due = nextStepDueFor(choice, date, today);
  const dirty = nextStepDirty(text, due, baseline);

  // Строка перечитана (своё сохранение или «Обновить» после конфликта):
  // черновик без правок принимает новое значение, правленый — остаётся, а
  // рядом видно, что сейчас записано в деле.
  if (row.admissionsVersion !== baseline.version) {
    const serverText = row.nextAction ?? "";
    const serverDue = row.nextActionDueOn ?? "";
    setBaseline({ text: serverText, due: serverDue, version: row.admissionsVersion });
    // Новая версия прочитана — конфликт разрешён: его сообщение больше не правда.
    if (feedback?.stale) setFeedback(null);
    setRefreshed(false);
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
    restoreFocus.current = Boolean(formRef.current?.contains(document.activeElement));
    setPending(true);
    setFeedback(null);
    setRefreshed(false);
    try {
      const state: CaseNextActionActionState = await saveCaseNextActionAction(
        { status: "idle", requestId, message: null, receipt: null },
        nextStepForm(row, nextText, nextDue, requestId),
      );
      setRequestId(state.requestId);
      if (state.status === "saved" && state.receipt) {
        setFeedback({ tone: "ok", text: state.message ?? "Следующий шаг сохранён.", field: null, stale: false });
        setServerMoved(false);
        onSaved(state.receipt);
      } else {
        setFeedback({ tone: "danger", text: state.message ?? "Не удалось сохранить шаг. Повторите.", field: null, stale: state.status === "stale" });
      }
    } catch {
      // Ответа нет — исход неизвестен: тот же request id повторит запись, а не создаст вторую.
      setFeedback({ tone: "danger", text: "Не удалось подтвердить сохранение. Повторите: повтор не сохранит шаг дважды.", field: null, stale: false });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter в поле отправляет форму и при недоступной «Сохранить»: без правок
    // и до перечитывания после конфликта версии записывать нечего.
    if (!dirty || locked) return;
    const error = nextStepInputError(text, choice, date, hasStep);
    if (error) { setFeedback({ tone: "danger", text: error, field: choice === "date" && !date ? "date" : "step", stale: false }); return; }
    if (!parseCaseNextActionInput(text, due)) {
      setFeedback({ tone: "danger", text: `Шаг — одна строка до ${CASE_NEXT_ACTION_MAX_LENGTH} символов.`, field: "step", stale: false });
      return;
    }
    void send(text, due);
  }

  function refresh() {
    restoreFocus.current = Boolean(formRef.current?.contains(document.activeElement));
    setRefreshed(true);
    startRefresh(() => router.refresh());
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
  const stepErrorId = `${fieldId}-error`;
  const dateErrorId = `${fieldId}-date-error`;
  const stepError = feedback?.tone === "danger" && feedback.field === "step" ? feedback.text : null;
  const dateError = feedback?.tone === "danger" && feedback.field === "date" ? feedback.text : null;
  const server = feedback && feedback.field === null ? feedback : null;
  // Конфликт: пока дело не перечитано, сохранять нечем — чужая версия победит снова.
  const locked = Boolean(server?.stale) && (!refreshed || refreshing);

  useEffect(() => {
    if (pending || refreshing || !restoreFocus.current) return;
    restoreFocus.current = false;
    // Человек сам ушёл фокусом дальше, пока шёл ответ, — не забираем его назад.
    const active = document.activeElement;
    if (active === null || active === document.body || formRef.current?.contains(active)) fieldRef.current?.focus();
  }, [pending, refreshing]);

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-busy={pending} className="space-y-3" data-testid="v3-next-step-editor">
      <div>
        <label htmlFor={fieldId} className="block t-label text-fg">Шаг</label>
        <textarea
          ref={fieldRef}
          id={fieldId}
          value={text}
          rows={3}
          onChange={(event) => {
            setText(oneLineStep(event.target.value));
            if (feedback?.field === "step") setFeedback(null);
          }}
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
          aria-invalid={stepError ? true : undefined}
          aria-describedby={stepError ? stepErrorId : undefined}
          className={STEP_FIELD}
        />
        {stepError ? <p id={stepErrorId} role="alert" className="mt-1 t-body-compact text-danger">{stepError}</p> : null}
      </div>
      <fieldset className="min-w-0" disabled={pending}>
        <legend className="t-label text-fg">Срок</legend>
        <div className="mt-1 flex">
          {chips.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={choice === value} onClick={() => { setChoice(value); if (feedback?.field === "date") setFeedback(null); }} className={SEGMENT}>
              {label}
            </button>
          ))}
        </div>
        {choice === "date" ? (
          <label className="mt-3 block t-label text-fg-2">
            Дата
            <input
              type="date"
              value={date}
              onChange={(event) => { setDate(event.target.value); if (feedback?.field === "date") setFeedback(null); }}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? dateErrorId : undefined}
              className={`${QUEUE_FIELD} aria-[invalid=true]:border-danger`}
            />
          </label>
        ) : null}
        {dateError ? <p id={dateErrorId} role="alert" className="mt-1 t-body-compact text-danger">{dateError}</p> : null}
      </fieldset>
      {serverMoved ? (
        <p className="t-body-compact text-fg-2">
          Сейчас в деле: {baseline.text || "шаг не задан"}{baseline.due ? ` · ${formatQueueDay(baseline.due, today)}` : ""}. Сохраните, чтобы заменить.
        </p>
      ) : null}
      {server ? (
        <p role={server.tone === "ok" ? "status" : "alert"} className={`t-body-compact ${server.tone === "ok" ? "text-ok" : "text-danger"}`}>
          {server.text}
          {server.stale && text.trim() ? <span className="text-fg"> Ваш текст остался в поле.</span> : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {locked ? (
          <button type="button" onClick={refresh} className={QUEUE_CONFIRM}>Обновить</button>
        ) : null}
        <button type="submit" disabled={pending || !dirty || locked} className={locked ? QUEUE_SECONDARY : QUEUE_CONFIRM}>{pending ? "Сохраняем…" : "Сохранить"}</button>
        {hasStep ? (
          <button type="button" disabled={pending || locked} onClick={() => void send("", "")} className={QUEUE_SECONDARY}>Снять шаг</button>
        ) : null}
      </div>
    </form>
  );
}
