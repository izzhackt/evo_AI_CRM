"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  isCalendarDay,
  type LeadCallPress,
  type LeadCallResultCode,
} from "@/lib/v3/telephony-lead-calls";

import { QUEUE_CONFIRM, QUEUE_FIELD } from "../queue/queue-buttons";

/**
 * Те же «чипы» с нажатым состоянием, что у срока задачи (`ComposerDeadlineField`). На телефоне три чипа
 * делят строку поровну (`grid-cols-3`) и подпись может занять две строки, от `sm` — в ряд по своей ширине.
 */
const CHIP = "v3-choice inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-2 text-center t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:text-fg-3 sm:px-3";
/** Тихое действие строки итога: 44 px по высоте, подчёркнуто — без красного оно остаётся действием. */
const QUIET = "inline-flex min-h-11 items-center t-meta text-fg-2 underline underline-offset-4 hover:text-fg";

/** Слова ответа маршрута (`/api/v3/telephony/calls/[id]/result`) по коду ошибки. */
const FAILURE_COPY: Readonly<Record<string, string>> = Object.freeze({
  authentication_required: "Войдите снова и повторите.",
  forbidden: "Нет права ставить результат этого звонка.",
  preview: "В просмотре роли результат не ставится.",
  not_found: "Звонок не найден.",
  not_answered: "Результат ставят у отвеченного звонка.",
  result_closed: "Результат этого звонка уже нельзя ставить или менять.",
  telephony_off: "Результаты звонков сейчас выключены.",
  invalid_date: "Выберите день не раньше сегодня и не позже чем через год.",
  invalid_request: "Не удалось сохранить: проверьте выбор.",
});
const FALLBACK_FAILURE = "Не удалось сохранить. Повторите.";

type Note = Readonly<{ tone: "ok" | "danger"; text: string }>;

/**
 * Результат звонка одним нажатием («Телефония Beeline KG», срез T5; план §9.4)
 * прямо под строкой звонка, без модального окна: «Дозвонился» (у входящего — «Поговорили») /
 * «Перезвонить позже» + день / «Не интересно». Поставленный результат меняется в течение суток.
 *
 * Строка итога не должна быть стеной кнопок: отмеченный звонок — одна строка «Итог: Дозвонился ·
 * изменить» (три чипа раскрываются по «изменить»); три чипа сразу видны у звонков без итога, которых
 * страница считает свежими (`defaultOpen`: два последних), у старых — ссылка «Отметить итог».
 * «Перезвонить» только запоминает выбранный день, задачу по нему создаёт срез T8, поэтому слов о
 * напоминании здесь нет. Решает база (право, флаги, «свои»/«все», окна): интерфейс лишь показывает её
 * признак `resultEditable` и слова отказа.
 */
export function LeadCallResult({
  callId,
  code,
  callbackOn,
  resultLabel,
  callbackLabel,
  pressWords,
  defaultOpen,
  bounds,
}: Readonly<{
  callId: string;
  code: LeadCallResultCode | null;
  callbackOn: string | null;
  /** Результат словами («Дозвонился», «Перезвонить 18.10») для строки «Итог: …»; null — не отмечен. */
  resultLabel: string | null;
  /** «Перезвонить 18.10» у нажатой кнопки: день виден и свёрнутым. */
  callbackLabel: string | null;
  /** Слова трёх нажатий этого направления (`callPressWords`). */
  pressWords: Readonly<Record<LeadCallPress, string>>;
  /** Чипы видны сразу (звонок без итога из последних); иначе — «Отметить итог» или «Итог: … · изменить». */
  defaultOpen: boolean;
  bounds: Readonly<{ min: string; max: string; fallback: string }>;
}>) {
  const router = useRouter();
  const dayId = useId();
  const labelId = useId();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(callbackOn ?? bounds.fallback);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  async function press(result: LeadCallPress, chosenDay: string | null) {
    if (pending) return;
    setPending(true);
    setNote(null);
    try {
      const response = await fetch(`/api/v3/telephony/calls/${callId}/result`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chosenDay === null ? { result } : { result, callbackOn: chosenDay }),
      });
      if (response.ok) {
        const body = await response.json().then((value: { status?: unknown }) => value, () => ({} as { status?: unknown }));
        setNote({ tone: "ok", text: body.status === "unchanged" ? "Без изменений." : "Сохранено." });
        setPicking(false);
        setExpanded(false);
        router.refresh();
      } else {
        const body = await response.json().then((value: { error?: { code?: unknown } }) => value, () => ({} as { error?: { code?: unknown } }));
        const reason = typeof body.error?.code === "string" ? FAILURE_COPY[body.error.code] : undefined;
        setNote({ tone: "danger", text: reason ?? FALLBACK_FAILURE });
      }
    } catch {
      setNote({ tone: "danger", text: FALLBACK_FAILURE });
    } finally {
      setPending(false);
    }
  }

  const dayValid = isCalendarDay(day) && day >= bounds.min && day <= bounds.max;
  // Чипы свёрнуты по умолчанию у отмеченного и у старого звонка; сворачивать открытые вручную можно всегда,
  // а у свежего звонка без итога чипы и есть задача строки.
  const canCollapse = code !== null || !defaultOpen;
  return (
    <div className="mt-1" data-testid="v3-call-result">
      {!expanded ? (
        code !== null && resultLabel ? (
          <p className="flex min-h-11 flex-wrap items-center gap-x-1.5 t-meta text-fg-2" data-testid="v3-call-result-line">
            <span>Итог: <span className="text-fg">{resultLabel}</span></span>
            <span aria-hidden="true">·</span>
            <button type="button" className={QUIET} aria-expanded={false} onClick={() => setExpanded(true)}>изменить</button>
          </p>
        ) : (
          <button type="button" className={QUIET} aria-expanded={false} onClick={() => setExpanded(true)}>Отметить итог</button>
        )
      ) : (
        <>
          <div className="flex min-h-6 items-center justify-between gap-x-3">
            <p id={labelId} className="t-meta text-fg-2">Итог звонка</p>
            {canCollapse ? (
              <button type="button" className={QUIET} aria-expanded onClick={() => { setExpanded(false); setPicking(false); }}>Свернуть</button>
            ) : null}
          </div>
          <div role="group" aria-labelledby={labelId} className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
            <button type="button" className={CHIP} disabled={pending} aria-pressed={code === "reached"}
              onClick={() => void press("reached", null)}>{pressWords.reached}</button>
            <button type="button" className={CHIP} disabled={pending} aria-pressed={code === "callback"} aria-expanded={picking}
              onClick={() => setPicking((open) => !open)}>{callbackLabel ?? pressWords.callback}</button>
            <button type="button" className={CHIP} disabled={pending} aria-pressed={code === "not_interested"}
              onClick={() => void press("not_interested", null)}>{pressWords.not_interested}</button>
          </div>
          {picking ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label htmlFor={dayId} className="t-label text-fg-2">
                День звонка
                <input id={dayId} type="date" value={day} min={bounds.min} max={bounds.max} required disabled={pending}
                  onChange={(event) => setDay(event.target.value)} className={`${QUEUE_FIELD} w-auto`} />
              </label>
              <button type="button" className={QUEUE_CONFIRM} disabled={pending || !dayValid}
                onClick={() => void press("callback", day)}>
                {pending ? "Сохраняем…" : "Сохранить"}
              </button>
            </div>
          ) : null}
        </>
      )}
      <p role="status" aria-live="polite" className={`t-meta ${note?.tone === "danger" ? "text-danger" : "text-fg-2"}`}>
        {note?.text ?? null}
      </p>
    </div>
  );
}
