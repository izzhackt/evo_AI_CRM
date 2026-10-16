"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  clockOffsetMs,
  formatClock,
  itemSecondsChanged,
  laterClockOffset,
  remainingSeconds,
  serverAcceptsSave,
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
type FlushOptions = { settle?: boolean };
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
  /** Открытый черновик этой формы с главной трека (`tests[].draft`). */
  draftAttemptId: string | null;
};

const SAVE_BATCH_MS = 10_000;
const SAVE_ON_MOVE_MS = 2_000;
const RETRY_MS = 3_000;

// Часы читаются только в обработчиках событий и таймерах, не при отрисовке.
// Время страницы монотонное: перевод часов компьютера отсчёт не двигает
// (как ContinuousClock на iPhone); поправка до сервера в offsetRef (§7.2).
const monoNow = () => performance.now();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Тест на время (контракт §7): старт и срок ставит сервер, клиент только
 * показывает «Осталось» по своим часам с поправкой на serverNow. Ответы
 * можно менять до конца; сохранение пачкой раз в 10 с, при переходе между
 * заданиями не чаще раза в 2 с и при уходе страницы в фон, запросы строго
 * по очереди с актуальной ревизией, повтор после сбоя тем же запросом, после
 * него сразу текущее состояние. Время на задании сохраняется и тогда, когда
 * ответы не менялись (завершение, уход). Завершение не теряет ответы, не
 * ушедшие из-за сети, пока сервер ещё принимает сохранения. Пробный тест
 * (allowEarlyFinish = false) кнопки «Завершить» не имеет: когда время
 * выходит, клиент сам отправляет ответы. Разбор приходит только в ответе
 * завершения. «Продолжить тест» сначала читает известный черновик: если его
 * срок вышел, виден итог этой попытки, а не новая попытка.
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
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialResult ? "result" : "intro");
  // Черновик с главной: «Продолжить тест» читает его первым, один раз.
  const [knownDraft, setKnownDraft] = useState<string | null>(form.draftAttemptId);
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
  const offsetRef = useRef<number | null>(null);
  const answersRef = useRef<Record<string, CscaOptionId>>({});
  const flagsRef = useRef<string[]>([]);
  const secondsRef = useRef<Record<string, number>>({});
  const sentSecondsRef = useRef<Record<string, number>>({});
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
  const flushRef = useRef<(options?: FlushOptions) => Promise<void>>(async () => {});
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const adopt = useCallback((next: CscaTestAttempt, receivedAt: number) => {
    attemptRef.current = next;
    revisionRef.current = next.revision;
    // Чтение попытки и старт несут свежий serverNow: отсчёт ставится по нему.
    offsetRef.current = clockOffsetMs(next.serverNow, receivedAt);
    answersRef.current = { ...next.answers };
    flagsRef.current = [...next.flags];
    secondsRef.current = { ...next.itemSeconds };
    sentSecondsRef.current = { ...next.itemSeconds };
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
    const now = monoNow();
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
    const response = await readCscaTestAttemptAction(current.attemptId);
    const receivedAt = monoNow();
    if (!response.ok) return null;
    if (response.attempt.status === "completed") {
      showResult(response.attempt);
      return response.attempt;
    }
    adopt(response.attempt, receivedAt);
    return response.attempt;
  }, [adopt, showResult]);

  const flush = useCallback(async (options?: FlushOptions): Promise<void> => {
    while (savingRef.current) await savingRef.current;
    const current = attemptRef.current;
    if (!current || current.status !== "draft") return;
    if (options?.settle) {
      // Завершение и уход: время на задании после последнего изменения тоже
      // состояние, его надо сохранить и без новых ответов (§7.3).
      settleSeconds();
      if (itemSecondsChanged(current.items, secondsRef.current, sentSecondsRef.current)) dirtyRef.current = true;
    }
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
        sentSecondsRef.current = request.itemSeconds;
        dirtyRef.current = false;
      }
      setSaveStatus("saving");
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
      const receivedAt = monoNow();
      lastSaveAtRef.current = receivedAt;
      if (response.ok) {
        retryRef.current = null;
        revisionRef.current = response.receipt.revision;
        // По квитанции отсчёт назад не переводится (§7.2).
        offsetRef.current = laterClockOffset(offsetRef.current, clockOffsetMs(response.receipt.serverNow, receivedAt));
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
      // Сначала несохранённое (§7.4): повтор после сбоя, текущее состояние и
      // время на задании. Пока сервер принимает сохранения, тест не
      // завершается без ответов, которые не ушли из-за сети.
      for (;;) {
        await flush({ settle: true });
        const latest = attemptRef.current;
        if (!latest || latest.status !== "draft") return;
        if (!dirtyRef.current && !retryRef.current) break;
        const now = monoNow();
        const offset = offsetRef.current ?? 0;
        if (!serverAcceptsSave(latest.deadlineAt, latest.graceSeconds, offset, now)) break;
        if (remainingSeconds(latest.deadlineAt, offset, now) > 0) {
          // Досрочно и без связи: назад к заданиям, сохранение повторится само.
          setError(strings.finishUnsent);
          setPhase("running");
          return;
        }
        // Время вышло, запас ещё идёт: повторяем отправку, потом завершаем.
        await wait(RETRY_MS);
      }
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

  function run(draft: CscaTestAttempt, receivedAt: number) {
    adopt(draft, receivedAt);
    const firstOpen = draft.items.findIndex((entry) => !(entry.itemKey in draft.answers));
    const startIndex = firstOpen === -1 ? 0 : firstOpen;
    indexRef.current = startIndex;
    setIndex(startIndex);
    enteredAtRef.current = monoNow();
    setRemaining(remainingSeconds(draft.deadlineAt, offsetRef.current ?? 0, monoNow()));
    setPhase("running");
    requestAnimationFrame(() => heading.current?.focus());
  }

  /**
   * «Пройти ещё раз» после итога: снова вступление с новой попыткой. Ссылка
   * на тот же адрес не помогала: страница оставалась тем же экземпляром с
   * итогом на экране.
   */
  function restart() {
    attemptRef.current = null;
    revisionRef.current = 0;
    offsetRef.current = null;
    answersRef.current = {};
    flagsRef.current = [];
    secondsRef.current = {};
    sentSecondsRef.current = {};
    dirtyRef.current = false;
    retryRef.current = null;
    enteredAtRef.current = null;
    indexRef.current = 0;
    startRequestId.current = null;
    setKnownDraft(null);
    setAttempt(null);
    setAnswers({});
    setFlags([]);
    setIndex(0);
    setRemaining(null);
    setSaveStatus("idle");
    setError(null);
    setNotice(null);
    setMinuteNotice("");
    setPhase("intro");
    router.replace(`/portal/csca/math/test/${form.formId}`, { scroll: true });
  }

  async function start() {
    setPhase("starting");
    setError(null);
    if (knownDraft) {
      // «Продолжить тест»: сначала тот самый черновик. Если его срок вышел,
      // чтение завершает его на сервере (§7.5), и ученик видит итог и разбор
      // этой попытки, а не новый тест с полным временем.
      let read: Awaited<ReturnType<typeof readCscaTestAttemptAction>>;
      try {
        read = await readCscaTestAttemptAction(knownDraft);
      } catch {
        read = { ok: false, code: "unavailable" };
      }
      const receivedAt = monoNow();
      if (!read.ok) {
        setError(read.code === "denied" ? strings.errorDenied : strings.errorUnavailable);
        setPhase("intro");
        return;
      }
      setKnownDraft(null);
      if (read.attempt.status === "completed") {
        showResult(read.attempt);
        return;
      }
      run(read.attempt, receivedAt);
      return;
    }
    startRequestId.current ??= crypto.randomUUID();
    let response: Awaited<ReturnType<typeof startCscaTestAction>>;
    try {
      response = await startCscaTestAction(form.formId, startRequestId.current);
    } catch {
      response = { ok: false, code: "unavailable" };
    }
    const receivedAt = monoNow();
    if (!response.ok) {
      setError(response.code === "denied" ? strings.errorDenied : strings.errorUnavailable);
      setPhase("intro");
      return;
    }
    startRequestId.current = null;
    if (response.attempt.status === "completed") {
      // Сервер отдаёт завершённую попытку, если черновик формы истёк (§7.1).
      showResult(response.attempt);
      return;
    }
    run(response.attempt, receivedAt);
  }

  // Часы: только отображение, срок держит сервер.
  useEffect(() => {
    if (phase !== "running" && phase !== "finishing") return;
    const tick = () => {
      const current = attemptRef.current;
      if (!current || current.status !== "draft") return;
      const left = remainingSeconds(current.deadlineAt, offsetRef.current ?? 0, monoNow());
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
        void flush({ settle: true });
      } else {
        enteredAtRef.current = monoNow();
      }
    };
    const onPageHide = () => {
      void flush({ settle: true });
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

  // Уход по ссылке кабинета, когда несохранённым осталось только время на
  // задании: сначала короткое сохранение, потом переход. Запрос, начатый
  // после перехода, роутер обрывает. Слушатель стоит после защиты выхода:
  // несохранённые ответы по-прежнему останавливают переход там.
  useEffect(() => {
    if (phase !== "running") return;
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      if (link.href.split("#")[0] === window.location.href.split("#")[0]) return;
      const current = attemptRef.current;
      // Несохранённые ответы, повтор или запрос в пути: решает защита выхода.
      if (!current || current.status !== "draft" || savingRef.current || finalizingRef.current
        || dirtyRef.current || retryRef.current) return;
      settleSeconds();
      if (!itemSecondsChanged(current.items, secondsRef.current, sentSecondsRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const href = link.href;
      void Promise.race([flush({ settle: true }), wait(1_500)]).then(() => router.push(href));
    };
    document.addEventListener("click", onLinkClick, true);
    return () => document.removeEventListener("click", onLinkClick, true);
  }, [flush, phase, router, settleSeconds]);

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
    enteredAtRef.current = monoNow();
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    setConfirming(false);
    if (dirtyRef.current && monoNow() - lastSaveAtRef.current >= SAVE_ON_MOVE_MS) void flush();
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
            <button type="button" className="pt-btn-ghost" onClick={restart}>{strings.repeat}</button>
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
            {phase === "starting" ? strings.testStarting : knownDraft ? strings.testResume : strings.testBegin}
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
