"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  clockOffsetMs,
  formatClock,
  remainingSeconds,
  testSavePayload,
  type CscaOptionId,
  type CscaTestAttempt,
  type CscaTestKind,
  type CscaTestMeta,
} from "@/lib/portal/csca";
import {
  completeCscaTestAction,
  readCscaTestAttemptAction,
  saveCscaTestAction,
  startCscaTestAction,
} from "@/lib/portal/csca-actions";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";

import { durationLabel } from "./format";
import { ItemCard } from "./ItemCard";
import { TestResultView, type TitleMaps } from "./TestResultView";

type Strings = PortalStrings<"csca">;
type Phase = "intro" | "starting" | "running" | "finishing" | "result";
type SaveStatus = "idle" | "saving" | "saved" | "retrying";
type SaveRequest = {
  requestId: string;
  expectedRevision: number;
  answers: Record<string, CscaOptionId>;
  flags: string[];
  itemSeconds: Record<string, number>;
};

export type TimedTestForm = {
  formId: string;
  kind: CscaTestKind;
  metadata: CscaTestMeta;
  durationSeconds: number;
  allowEarlyFinish: boolean;
  itemsTotal: number;
  hasDraft: boolean;
};

const SAVE_BATCH_MS = 10_000;
const SAVE_ON_MOVE_MS = 2_000;
const RETRY_MS = 3_000;

// Часы читаются только в обработчиках событий и таймерах, не при отрисовке.
const clockNow = () => Date.now();
const perfNow = () => performance.now();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Тест на время (контракт §7): старт и срок ставит сервер, клиент только
 * показывает «Осталось» по своим часам с поправкой на serverNow. Ответы
 * можно менять до конца; сохранение пачкой раз в 10 с, при переходе между
 * заданиями не чаще раза в 2 с и при уходе страницы в фон, запросы строго
 * по очереди с актуальной ревизией, повтор после сбоя тем же запросом.
 * Пробный тест (allowEarlyFinish = false) кнопки «Завершить» не имеет:
 * когда время выходит, клиент сам отправляет ответы. Разбор приходит только
 * в ответе завершения.
 */
export function TimedTestRunner({
  form,
  locale,
  strings,
  titles,
  initialResult,
  homeHref,
}: {
  form: TimedTestForm;
  locale: Locale;
  strings: Strings;
  titles: TitleMaps;
  initialResult: CscaTestAttempt | null;
  homeHref: string;
}) {
  const ky = locale === "ky";
  const [phase, setPhase] = useState<Phase>(initialResult ? "result" : "intro");
  const [attempt, setAttempt] = useState<CscaTestAttempt | null>(initialResult);
  const [answers, setAnswers] = useState<Record<string, CscaOptionId>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minuteNotice, setMinuteNotice] = useState("");

  const attemptRef = useRef<CscaTestAttempt | null>(null);
  const revisionRef = useRef(0);
  const offsetRef = useRef(0);
  const answersRef = useRef<Record<string, CscaOptionId>>({});
  const flagsRef = useRef<string[]>([]);
  const secondsRef = useRef<Record<string, number>>({});
  const enteredAtRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<void> | null>(null);
  const retryRef = useRef<SaveRequest | null>(null);
  const lastSaveAtRef = useRef(0);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizingRef = useRef(false);
  const startRequestId = useRef<string | null>(null);
  const finalizeRef = useRef<() => Promise<void>>(async () => {});
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const adopt = useCallback((next: CscaTestAttempt, receivedAt: number) => {
    attemptRef.current = next;
    revisionRef.current = next.revision;
    offsetRef.current = clockOffsetMs(next.serverNow, receivedAt);
    answersRef.current = { ...next.answers };
    flagsRef.current = [...next.flags];
    secondsRef.current = { ...next.itemSeconds };
    dirtyRef.current = false;
    retryRef.current = null;
    setAttempt(next);
    setAnswers({ ...next.answers });
    setFlags([...next.flags]);
  }, []);

  /** Время на текущем задании копится, пока страница видна. */
  const settleSeconds = useCallback(() => {
    const current = attemptRef.current?.items[indexRef.current];
    if (!current || enteredAtRef.current === null) return;
    const now = performance.now();
    const spent = (now - enteredAtRef.current) / 1000;
    enteredAtRef.current = document.visibilityState === "visible" ? now : null;
    if (spent <= 0) return;
    secondsRef.current = {
      ...secondsRef.current,
      [current.itemKey]: Math.min(3600, (secondsRef.current[current.itemKey] ?? 0) + spent),
    };
  }, []);

  const showResult = useCallback((completed: CscaTestAttempt) => {
    attemptRef.current = completed;
    setAttempt(completed);
    setPhase("result");
    setConfirming(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("attempt", completed.attemptId);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Адрес без attempt не мешает: итог уже на экране.
    }
    requestAnimationFrame(() => resultHeading.current?.focus());
  }, []);

  const reloadAttempt = useCallback(async (): Promise<CscaTestAttempt | null> => {
    const current = attemptRef.current;
    if (!current) return null;
    const receivedAt = Date.now();
    const response = await readCscaTestAttemptAction(current.attemptId);
    if (!response.ok) return null;
    if (response.attempt.status === "completed") {
      showResult(response.attempt);
      return response.attempt;
    }
    adopt(response.attempt, receivedAt);
    return response.attempt;
  }, [adopt, showResult]);

  const flush = useCallback(async (): Promise<void> => {
    while (savingRef.current) await savingRef.current;
    const current = attemptRef.current;
    if (!current || current.status !== "draft") return;
    if (!dirtyRef.current && !retryRef.current) return;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    const run = (async () => {
      let request = retryRef.current;
      if (!request) {
        settleSeconds();
        request = {
          requestId: crypto.randomUUID(),
          expectedRevision: revisionRef.current,
          ...testSavePayload(current.items, answersRef.current, flagsRef.current, secondsRef.current),
        };
        dirtyRef.current = false;
      }
      setSaveStatus("saving");
      const receivedAt = Date.now();
      let response: Awaited<ReturnType<typeof saveCscaTestAction>>;
      try {
        response = await saveCscaTestAction({
          attemptId: current.attemptId,
          expectedRevision: request.expectedRevision,
          itemKeys: current.items.map((entry) => entry.itemKey),
          answers: request.answers,
          flags: request.flags,
          itemSeconds: request.itemSeconds,
          requestId: request.requestId,
        });
      } catch {
        response = { ok: false, code: "unavailable" };
      }
      lastSaveAtRef.current = Date.now();
      if (response.ok) {
        retryRef.current = null;
        revisionRef.current = response.receipt.revision;
        offsetRef.current = clockOffsetMs(response.receipt.serverNow, receivedAt);
        setSaveStatus("saved");
        return;
      }
      if (response.code === "unavailable") {
        // Тот же запрос: сервер мог его уже принять, повтор вернёт ту же квитанцию.
        retryRef.current = request;
        setSaveStatus("retrying");
        batchTimerRef.current = setTimeout(() => void flushRef.current(), RETRY_MS);
        return;
      }
      retryRef.current = null;
      if (response.code === "conflict") {
        setNotice(strings.errorConflict);
        await reloadAttempt();
        setSaveStatus("saved");
        return;
      }
      if (response.code === "test_completed") {
        setSaveStatus("idle");
        await reloadAttempt();
        return;
      }
      if (response.code === "deadline_passed") {
        // Срок держит сервер: отправляем то, что сохранено до срока.
        setSaveStatus("idle");
        void finalizeRef.current();
        return;
      }
      setSaveStatus("idle");
      setError(response.code === "denied" ? strings.errorDenied : strings.errorInvalid);
    })();
    savingRef.current = run;
    try {
      await run;
    } finally {
      if (savingRef.current === run) savingRef.current = null;
    }
    if (dirtyRef.current && !retryRef.current) await flushRef.current();
  }, [reloadAttempt, settleSeconds, strings]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (batchTimerRef.current) return;
    batchTimerRef.current = setTimeout(() => {
      batchTimerRef.current = null;
      void flush();
    }, SAVE_BATCH_MS);
  }, [flush]);

  const finalize = useCallback(async () => {
    if (finalizingRef.current) return;
    const current = attemptRef.current;
    if (!current) return;
    finalizingRef.current = true;
    setPhase("finishing");
    setConfirming(false);
    setError(null);
    try {
      await flush();
      let completeRequest = { requestId: crypto.randomUUID(), expectedRevision: revisionRef.current };
      for (let attemptNo = 0; attemptNo < 12; attemptNo += 1) {
        if (completeRequest.expectedRevision !== revisionRef.current) {
          completeRequest = { requestId: crypto.randomUUID(), expectedRevision: revisionRef.current };
        }
        let response: Awaited<ReturnType<typeof completeCscaTestAction>>;
        try {
          response = await completeCscaTestAction({
            attemptId: current.attemptId,
            expectedRevision: completeRequest.expectedRevision,
            requestId: completeRequest.requestId,
          });
        } catch {
          response = { ok: false, code: "unavailable" };
        }
        if (response.ok) {
          showResult(response.attempt);
          return;
        }
        if (response.code === "conflict" || response.code === "test_completed") {
          const fresh = await reloadAttempt();
          if (fresh?.status === "completed") return;
          continue;
        }
        if (response.code === "early_finish_forbidden" || response.code === "unavailable") {
          // Часы клиента чуть впереди сервера или нет сети: срок держит сервер.
          await wait(response.code === "unavailable" ? RETRY_MS : 1_500);
          continue;
        }
        setError(response.code === "denied" ? strings.errorDenied : strings.errorInvalid);
        setPhase("running");
        return;
      }
      setError(strings.errorUnavailable);
      setPhase("running");
    } finally {
      finalizingRef.current = false;
    }
  }, [flush, reloadAttempt, showResult, strings]);

  useEffect(() => {
    finalizeRef.current = finalize;
  }, [finalize]);

  async function start() {
    setPhase("starting");
    setError(null);
    startRequestId.current ??= crypto.randomUUID();
    const receivedAt = clockNow();
    let response: Awaited<ReturnType<typeof startCscaTestAction>>;
    try {
      response = await startCscaTestAction(form.formId, startRequestId.current);
    } catch {
      response = { ok: false, code: "unavailable" };
    }
    if (!response.ok) {
      setError(response.code === "denied" ? strings.errorDenied : strings.errorUnavailable);
      setPhase("intro");
      return;
    }
    startRequestId.current = null;
    if (response.attempt.status === "completed") {
      showResult(response.attempt);
      return;
    }
    adopt(response.attempt, receivedAt);
    const firstOpen = response.attempt.items.findIndex((entry) => !(entry.itemKey in response.attempt.answers));
    const startIndex = firstOpen === -1 ? 0 : firstOpen;
    indexRef.current = startIndex;
    setIndex(startIndex);
    enteredAtRef.current = perfNow();
    setRemaining(remainingSeconds(response.attempt.deadlineAt, offsetRef.current, clockNow()));
    setPhase("running");
    requestAnimationFrame(() => heading.current?.focus());
  }

  // Часы: только отображение, срок держит сервер.
  useEffect(() => {
    if (phase !== "running" && phase !== "finishing") return;
    const tick = () => {
      const current = attemptRef.current;
      if (!current || current.status !== "draft") return;
      const left = remainingSeconds(current.deadlineAt, offsetRef.current, Date.now());
      setRemaining(left);
      if (left === 60) setMinuteNotice(formatPortalString(strings.remainingAria, { time: formatClock(60) }));
      if (left === 0) void finalize();
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [finalize, phase, strings]);

  // Уход в фон: сохранить сразу; время задания не копится, пока страница скрыта.
  useEffect(() => {
    if (phase !== "running") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        settleSeconds();
        enteredAtRef.current = null;
        if (dirtyRef.current) void flush();
      } else {
        enteredAtRef.current = performance.now();
      }
    };
    const onPageHide = () => {
      if (dirtyRef.current) void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush, phase, settleSeconds]);

  useEffect(() => {
    if (phase !== "running" && phase !== "finishing") return;
    return installAssessmentExitGuard({
      blocked: () => finalizingRef.current || savingRef.current !== null || dirtyRef.current || retryRef.current !== null,
      notify: () => {
        setNotice(strings.exitBlocked);
        void flush();
      },
    });
  }, [flush, phase, strings]);

  useEffect(() => () => {
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
  }, []);

  function choose(itemKey: string, option: CscaOptionId) {
    answersRef.current = { ...answersRef.current, [itemKey]: option };
    setAnswers(answersRef.current);
    scheduleSave();
  }

  function toggleFlag(itemKey: string) {
    flagsRef.current = flagsRef.current.includes(itemKey)
      ? flagsRef.current.filter((flag) => flag !== itemKey)
      : [...flagsRef.current, itemKey];
    setFlags(flagsRef.current);
    scheduleSave();
  }

  function move(nextIndex: number) {
    const current = attemptRef.current;
    if (!current || nextIndex < 0 || nextIndex >= current.items.length) return;
    settleSeconds();
    enteredAtRef.current = perfNow();
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    setConfirming(false);
    if (dirtyRef.current && clockNow() - lastSaveAtRef.current >= SAVE_ON_MOVE_MS) void flush();
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }

  const title = ky ? form.metadata.title_ky : form.metadata.title_ru;

  if (phase === "result" && attempt?.result) {
    return (
      <TestResultView
        attempt={attempt}
        locale={locale}
        strings={strings}
        titles={titles}
        headingRef={resultHeading}
        actions={
          <>
            <Link className="pt-btn" href={homeHref}>{strings.backToTopics}</Link>
            <Link className="pt-btn-ghost" href={`/portal/csca/math/test/${form.formId}`}>{strings.repeat}</Link>
          </>
        }
      />
    );
  }

  if (phase === "intro" || phase === "starting" || !attempt) {
    return (
      <section className="cs-test-intro" aria-labelledby="cs-test-intro-title">
        <h2 id="cs-test-intro-title" className="cs-test-intro-title">{title}</h2>
        <p className="cs-test-intro-lead">{ky ? form.metadata.intro_ky : form.metadata.intro_ru}</p>
        <dl className="cs-facts">
          <div><dt>{strings.testIntroItems}</dt><dd className="pt-data">{form.itemsTotal}</dd></div>
          <div><dt>{strings.testIntroTime}</dt><dd className="pt-data">{durationLabel(form.durationSeconds, strings)}</dd></div>
          <div>
            <dt>{strings.testIntroEarly}</dt>
            <dd>{form.allowEarlyFinish ? strings.testIntroEarlyYes : strings.testIntroEarlyNo}</dd>
          </div>
        </dl>
        <ul className="cs-rules">
          <li>{strings.testRuleChange}</li>
          <li>{strings.testRuleSave}</li>
          <li>{strings.testRuleClock}</li>
          <li>{form.allowEarlyFinish ? strings.testRuleReview : strings.testRuleMock}</li>
        </ul>
        {error ? <p role="alert" className="cs-alert">{error}</p> : null}
        <div className="cs-test-intro-actions">
          <button type="button" className="pt-btn" disabled={phase === "starting"} onClick={() => void start()}>
            {phase === "starting" ? strings.testStarting : form.hasDraft ? strings.testResume : strings.testBegin}
          </button>
          <Link className="cs-text-btn" href={homeHref}>{strings.backToTopics}</Link>
        </div>
      </section>
    );
  }

  const items = attempt.items;
  const current = items[index];
  const total = items.length;
  const answeredCount = items.filter((entry) => entry.itemKey in answers).length;
  const flagged = flags.includes(current.itemKey);
  const low = remaining !== null && remaining <= 60;
  const saveText = {
    idle: strings.saveIdle,
    saving: strings.saveSaving,
    saved: strings.saveSaved,
    retrying: strings.saveRetrying,
  }[saveStatus];

  return (
    <div className="cs-test" data-phase={phase}>
      <div className="cs-test-bar">
        <div className="cs-test-bar-main">
          <p className="cs-test-bar-title">
            {formatPortalString(strings.answeredCount, { answered: String(answeredCount), total: String(total) })}
          </p>
          <p className="cs-test-save" role="status">{phase === "finishing" ? (remaining === 0 ? strings.timeUp : strings.finishing) : saveText}</p>
        </div>
        <div className="cs-clock" data-low={low ? "" : undefined}>
          <span className="cs-clock-label">{strings.remaining}</span>
          <span
            className="cs-clock-time"
            role="timer"
            aria-label={formatPortalString(strings.remainingAria, { time: formatClock(remaining ?? 0) })}
          >
            {formatClock(remaining ?? 0)}
          </span>
        </div>
        <span className="pt-sr-only" aria-live="polite">{minuteNotice}</span>
      </div>

      <nav className="cs-navigator" aria-label={strings.navigatorLabel}>
        <ol>
          {items.map((entry, entryIndex) => {
            const isAnswered = entry.itemKey in answers;
            const isFlagged = flags.includes(entry.itemKey);
            const parts = [
              formatPortalString(strings.navItem, { n: String(entryIndex + 1) }),
              isAnswered ? strings.navAnswered : strings.navUnanswered,
              ...(isFlagged ? [strings.navFlagged] : []),
            ];
            return (
              <li key={entry.itemKey}>
                <button
                  type="button"
                  className="cs-nav-cell"
                  data-answered={isAnswered ? "" : undefined}
                  data-flagged={isFlagged ? "" : undefined}
                  aria-current={entryIndex === index ? "step" : undefined}
                  aria-label={parts.join(", ")}
                  disabled={phase === "finishing"}
                  onClick={() => move(entryIndex)}
                >
                  <span aria-hidden="true">{entryIndex + 1}</span>
                  {isFlagged ? <FlagIcon className="cs-nav-flag" /> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="cs-navigator-legend" aria-hidden="true">
          <span className="cs-legend-answered">{strings.legendAnswered}</span>
          <span className="cs-legend-flagged"><FlagIcon className="cs-legend-flag" />{strings.legendFlagged}</span>
        </p>
      </nav>

      {notice ? <p className="cs-notice" role="status">{notice}</p> : null}
      {error ? <p role="alert" className="cs-alert">{error}</p> : null}

      <ItemCard
        key={current.itemKey}
        item={current}
        figure={current.figureKey ? attempt.figures[current.figureKey] ?? null : null}
        locale={locale}
        strings={strings}
        counter={formatPortalString(strings.itemCounter, { n: String(index + 1), total: String(total) })}
        headingRef={heading}
        state={{ kind: "open", selected: answers[current.itemKey] ?? null, busy: phase === "finishing" }}
        onSelect={(option) => choose(current.itemKey, option)}
        footer={
          <div className="cs-test-controls">
            <button
              type="button"
              className="cs-flag-btn"
              aria-pressed={flagged}
              disabled={phase === "finishing"}
              onClick={() => toggleFlag(current.itemKey)}
            >
              <FlagIcon className="cs-flag-icon" />
              {strings.flag}
            </button>
            <span className="cs-test-move">
              <button type="button" className="pt-btn-ghost" disabled={index === 0 || phase === "finishing"} onClick={() => move(index - 1)}>
                {strings.prev}
              </button>
              <button type="button" className="pt-btn-ghost" disabled={index + 1 >= total || phase === "finishing"} onClick={() => move(index + 1)}>
                {strings.next}
              </button>
            </span>
          </div>
        }
      />

      <div className="cs-test-finish">
        {attempt.allowEarlyFinish ? (
          confirming ? (
            <div className="cs-confirm" role="group" aria-labelledby="cs-confirm-text">
              <p id="cs-confirm-text">
                {formatPortalString(strings.finishConfirm, { answered: String(answeredCount), total: String(total) })}
              </p>
              <div className="cs-confirm-actions">
                <button type="button" className="pt-btn" onClick={() => void finalize()} disabled={phase === "finishing"}>
                  {phase === "finishing" ? strings.finishing : strings.finishYes}
                </button>
                <button type="button" className="pt-btn-ghost" onClick={() => setConfirming(false)} disabled={phase === "finishing"}>
                  {strings.finishNo}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="pt-btn-ghost" onClick={() => setConfirming(true)} disabled={phase === "finishing"}>
              {strings.finish}
            </button>
          )
        ) : (
          <p className="cs-test-mock-note">{strings.mockNoFinish}</p>
        )}
      </div>
    </div>
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 14.5V2M3.5 2.5h8.5l-1.8 3 1.8 3H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
