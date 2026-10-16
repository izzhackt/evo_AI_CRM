"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type {
  CscaExplain,
  CscaFigure,
  CscaLessonAttempt,
  CscaLessonItem,
  CscaOptionId,
} from "@/lib/portal/csca";
import {
  answerCscaLessonItemAction,
  completeCscaLessonAction,
  reloadCscaLessonAction,
  type CscaActionError,
} from "@/lib/portal/csca-actions";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";

import { ItemCard } from "./ItemCard";

type Strings = PortalStrings<"csca">;
type Answered = { selected: CscaOptionId; correct: boolean; explain: CscaExplain };
type Pending = { requestId: string; exerciseId: string; selected: CscaOptionId };

function answeredFrom(attempt: CscaLessonAttempt | null): Record<string, Answered> {
  if (!attempt) return {};
  return Object.fromEntries(Object.entries(attempt.answers).map(([id, entry]) => [
    id,
    { selected: entry.selected, correct: entry.correct, explain: entry.explain },
  ]));
}

function firstOpen(items: readonly CscaLessonItem[], answered: Readonly<Record<string, Answered>>): number {
  const index = items.findIndex((entry) => !(entry.exerciseId in answered));
  return index === -1 ? items.length : index;
}

export type ItemRunnerLink = { href: string; label: string };

/**
 * Раннер «Проверки» урока и «Практики» (движок 198, тип `item`): задания по
 * одному, ответ финален и сразу возвращает вердикт и разбор каждого варианта
 * с сервера. Первый ответ открывает попытку, последний её завершает (одно
 * действие на ответ, без лишних кругов). Черновик продолжается с первого
 * неотвеченного задания; пройденный урок показывает итог и можно пройти ещё
 * раз. Ошибки уходят в банк повторения на сервере.
 */
export function ItemRunner({
  lessonId,
  items,
  figures,
  draft,
  latestCompleted,
  locale,
  strings,
  nextLinks,
}: {
  lessonId: string;
  items: CscaLessonItem[];
  figures: Record<string, CscaFigure>;
  draft: CscaLessonAttempt | null;
  latestCompleted: CscaLessonAttempt | null;
  locale: Locale;
  strings: Strings;
  nextLinks: ItemRunnerLink[];
}) {
  const initialAnswered = answeredFrom(draft ?? latestCompleted);
  const [attemptId, setAttemptId] = useState<string | null>(draft?.attemptId ?? null);
  const [revision, setRevision] = useState<number | null>(draft?.revision ?? null);
  const [answered, setAnswered] = useState<Record<string, Answered>>(initialAnswered);
  const [finished, setFinished] = useState<boolean>(!draft && latestCompleted !== null);
  const [index, setIndex] = useState(() => (draft ? firstOpen(items, initialAnswered) : 0));
  const [selected, setSelected] = useState<CscaOptionId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CscaActionError["code"] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [exitNotice, setExitNotice] = useState(false);
  const pending = useRef<Pending | null>(null);
  // Идентификаторы запросов одной попытки живут до «Пройти ещё раз».
  const startRequestId = useRef<string | null>(null);
  const completeRequestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const dirty = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const verdict = useRef<HTMLParagraphElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);

  const total = items.length;
  const current = !finished && index < total ? items[index] : null;
  const currentAnswer = current ? answered[current.exerciseId] : undefined;

  useEffect(() => {
    dirty.current = selected !== null && !currentAnswer;
  });

  useEffect(() => {
    if (finished) return;
    return installAssessmentExitGuard({
      blocked: () => busyRef.current || pending.current !== null || dirty.current,
      notify: () => setExitNotice(true),
    });
  }, [finished]);

  function focus(target: "heading" | "verdict" | "summary") {
    requestAnimationFrame(() => {
      const node = target === "heading" ? heading.current : target === "verdict" ? verdict.current : summaryHeading.current;
      node?.focus({ preventScroll: true });
      node?.closest(".cs-item, .cs-summary")?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  async function reload() {
    const response = await reloadCscaLessonAction(lessonId);
    if (!response.ok) {
      setError(response.code);
      return;
    }
    pending.current = null;
    const source = response.draft ?? response.latestCompleted;
    const next = answeredFrom(source);
    setAnswered(next);
    setAttemptId(response.draft?.attemptId ?? null);
    setRevision(response.draft?.revision ?? null);
    setFinished(!response.draft && response.latestCompleted !== null);
    setIndex(firstOpen(items, next));
    setSelected(null);
    setError(null);
  }

  async function submit() {
    if (busyRef.current || !current || currentAnswer) return;
    const request = (pending.current?.exerciseId === current.exerciseId ? pending.current : null) ?? (selected
      ? { requestId: crypto.randomUUID(), exerciseId: current.exerciseId, selected }
      : null);
    if (!request) return;
    pending.current = request;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setExitNotice(false);
    setAnnouncement("");
    try {
      const response = await answerCscaLessonItemAction({
        lessonId,
        attemptId,
        expectedRevision: revision,
        startRequestId: (startRequestId.current ??= crypto.randomUUID()),
        exerciseId: request.exerciseId,
        selected: request.selected,
        requestId: request.requestId,
        completeRequestId: (completeRequestId.current ??= crypto.randomUUID()),
      });
      if (!response.ok) {
        if (response.code === "conflict" || response.code === "already_answered") {
          setError(response.code);
          pending.current = null;
          return;
        }
        if (response.code !== "unavailable") pending.current = null;
        setError(response.code);
        return;
      }
      pending.current = null;
      setAttemptId(response.completed ? null : response.attemptId);
      setRevision(response.completed ? null : response.receipt.revision);
      setAnswered((previous) => ({
        ...previous,
        [response.receipt.exerciseId]: {
          selected: request.selected,
          correct: response.receipt.correct,
          explain: response.receipt.explain,
        },
      }));
      setSelected(null);
      setAnnouncement(response.receipt.correct ? strings.verdictCorrect : strings.verdictWrong);
      focus("verdict");
    } catch {
      setError("unavailable");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Черновик, где отвечено всё, но завершение не дошло (сбой сети): завершаем. */
  async function finishDraft() {
    if (busyRef.current || attemptId === null || revision === null) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await completeCscaLessonAction({
        attemptId,
        expectedRevision: revision,
        requestId: (completeRequestId.current ??= crypto.randomUUID()),
      });
      if (!response.ok) {
        setError(response.code);
        return;
      }
      setAttemptId(null);
      setRevision(null);
      focus("summary");
    } catch {
      setError("unavailable");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function goTo(nextIndex: number) {
    setSelected(null);
    setAnnouncement("");
    setError(null);
    if (nextIndex >= total) {
      setFinished(true);
      focus("summary");
      return;
    }
    setIndex(nextIndex);
    focus("heading");
  }

  function restart() {
    startRequestId.current = null;
    completeRequestId.current = null;
    pending.current = null;
    setAttemptId(null);
    setRevision(null);
    setAnswered({});
    setFinished(false);
    setIndex(0);
    setSelected(null);
    setError(null);
    focus("heading");
  }

  const errorText = error ? {
    conflict: strings.errorConflict,
    already_answered: strings.errorAlreadyAnswered,
    denied: strings.errorDenied,
    unavailable: strings.errorUnavailable,
  }[error as "conflict"] ?? strings.errorInvalid : null;

  const progress = (
    <ol className="cs-run-progress" aria-label={formatPortalString(strings.answeredCount, {
      answered: String(Object.keys(answered).length),
      total: String(total),
    })}>
      {items.map((entry, entryIndex) => {
        const result = answered[entry.exerciseId];
        const state = result ? (result.correct ? "ok" : "bad") : !finished && entryIndex === index ? "current" : "todo";
        const label = `${formatPortalString(strings.itemCounter, { n: String(entryIndex + 1), total: String(total) })}${result ? `, ${result.correct ? strings.verdictCorrect : strings.verdictWrong}` : ""}`;
        return (
          <li key={entry.exerciseId} data-state={state}>
            {result ? (
              <button
                type="button"
                className="cs-run-seg"
                aria-label={label}
                aria-current={!finished && entryIndex === index ? "step" : undefined}
                onClick={() => {
                  setFinished(false);
                  goTo(entryIndex);
                }}
              />
            ) : (
              <span className="cs-run-seg" aria-label={label} role="img" />
            )}
          </li>
        );
      })}
    </ol>
  );

  const errorNotice = errorText || exitNotice ? (
    <div role="alert" className="cs-alert">
      {errorText ? <p>{errorText}</p> : null}
      {exitNotice ? <p>{strings.exitBlocked}</p> : null}
      {error === "conflict" || error === "already_answered" ? (
        <button type="button" className="pt-btn-ghost" onClick={() => void reload()}>{strings.reload}</button>
      ) : error === "unavailable" ? (
        <button type="button" className="pt-btn-ghost" disabled={busy} onClick={() => void submit()}>{strings.retry}</button>
      ) : null}
    </div>
  ) : null;

  if (finished || !current) {
    const correct = items.filter((entry) => answered[entry.exerciseId]?.correct).length;
    const wrong = items.filter((entry) => answered[entry.exerciseId] && !answered[entry.exerciseId].correct).length;
    return (
      <div className="cs-runner">
        {progress}
        <section className="cs-summary" aria-labelledby="cs-summary-title">
          <h2 ref={summaryHeading} tabIndex={-1} id="cs-summary-title" className="cs-summary-title">
            {formatPortalString(strings.summaryScore, { correct: String(correct), total: String(total) })}
          </h2>
          <p className="cs-summary-body">{wrong > 0 ? strings.summaryMistakes : strings.summaryNoMistakes}</p>
          {attemptId !== null ? (
            <>
              {errorNotice}
              <div className="cs-summary-actions">
                <button type="button" className="pt-btn" disabled={busy} onClick={() => void finishDraft()}>
                  {busy ? strings.checking : strings.finishLesson}
                </button>
              </div>
            </>
          ) : null}
          <div className="cs-summary-actions" hidden={attemptId !== null}>
            {nextLinks.map((link, linkIndex) => (
              <Link key={link.href} className={linkIndex === 0 ? "pt-btn" : "pt-btn-ghost"} href={link.href}>{link.label}</Link>
            ))}
            <button type="button" className="pt-btn-ghost" onClick={restart}>{strings.repeatCheck}</button>
          </div>
        </section>
      </div>
    );
  }

  const nextIndex = index + 1 < total ? index + 1 : firstOpen(items, answered);
  const figure = current.figureKey ? figures[current.figureKey] ?? null : null;
  const counter = formatPortalString(strings.itemCounter, { n: String(index + 1), total: String(total) });
  return (
    <div className="cs-runner">
      {progress}
      <p className="pt-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? strings.checking : announcement}
      </p>
      <ItemCard
        key={current.exerciseId}
        item={current}
        figure={figure}
        locale={locale}
        strings={strings}
        counter={counter}
        headingRef={heading}
        verdictRef={verdict}
        state={currentAnswer
          ? { kind: "answered", selected: currentAnswer.selected, correct: currentAnswer.correct, explain: currentAnswer.explain }
          : { kind: "open", selected, busy }}
        onSelect={(id) => {
          // Новый выбор после сбоя: прежний запрос больше не повторяем.
          if (pending.current?.selected !== id) pending.current = null;
          setSelected(id);
        }}
        onSubmit={() => void submit()}
        footer={
          <>
            {errorNotice}
            <div className="cs-item-actions">
              {currentAnswer ? (
                <button type="button" className="pt-btn" onClick={() => goTo(nextIndex)}>
                  {nextIndex >= total ? strings.toSummary : strings.nextItem}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="pt-btn"
                    aria-disabled={busy || selected === null ? true : undefined}
                    onClick={() => {
                      if (!busy && selected) void submit();
                    }}
                  >
                    {busy ? strings.checking : strings.checkAnswer}
                  </button>
                  <span className="cs-item-hint">{selected ? strings.keyboardHint : strings.chooseFirst}</span>
                </>
              )}
            </div>
          </>
        }
      />
    </div>
  );
}
