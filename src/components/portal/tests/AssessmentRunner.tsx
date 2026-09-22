"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { completeStudentAssessmentAction, readStudentAssessmentAttemptAction, saveStudentAssessmentAction, startStudentAssessmentAction } from "@/lib/student-assessment-actions";
import { assessmentAnswersFingerprint, assessmentPath, type AssessmentActionResult, type AssessmentAnswers, type AssessmentAttempt, type AssessmentCatalog, type AssessmentWriteInput } from "@/lib/student-assessment-contract";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";

import { AssessmentQuestion } from "./AssessmentQuestion";
import { AssessmentResults } from "./AssessmentResults";

type PendingWrite = { input: AssessmentWriteInput; complete: boolean };
type ActionError = Extract<AssessmentActionResult, { ok: false }>;
type FailedAction = ActionError & { operation: "start" | "write" | "reload" };
// Локализация ошибки живёт на рендере по code (tests.error.*); message из
// server action не показывается, поэтому локальная сетевая ошибка несёт код.
const NETWORK_ERROR: ActionError = { ok: false, code: "unavailable", message: "" };

/**
 * Раннер тестов в «Атласе» (PORT-8c). Механика прежнего v3-раннера без
 * изменений контракта: автосохранение с ретраем ТОГО ЖЕ запроса и снимка,
 * exit-guard на несохранённых ответах, завершение — отдельным действием;
 * вердикты и разборы считаются только на сервере. Подписи — неймспейс tests
 * (RU байт-в-байт прежние, KY полный).
 */
export function AssessmentRunner({ instrument, initialAttempt, locale }: {
  instrument: AssessmentCatalog["instruments"][number];
  initialAttempt: AssessmentAttempt | null;
  locale: Locale;
}) {
  const strings = getPortalStrings("tests", locale);
  const router = useRouter();
  const [attempt, setAttempt] = useState(initialAttempt);
  const attemptRef = useRef(initialAttempt);
  const [answers, setAnswers] = useState<AssessmentAnswers>(initialAttempt?.answers ?? {});
  const answersRef = useRef(answers);
  const [saved, setSaved] = useState(assessmentAnswersFingerprint(answers));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pending = useRef<PendingWrite | null>(null);
  const startRequestId = useRef<string | null>(null);
  const [error, setError] = useState<FailedAction | null>(null);
  const [exitNotice, setExitNotice] = useState(false);
  const [completing, setCompleting] = useState(false);
  const pageSize = instrument.instrumentKey === "english36" ? 1 : 4;
  const firstUnanswered = initialAttempt?.questions.findIndex(q => !initialAttempt.answers[q.id]) ?? 0;
  const [page, setPage] = useState(Math.floor(Math.max(0, firstUnanswered) / pageSize));
  const heading = useRef<HTMLHeadingElement>(null);
  const fingerprint = assessmentAnswersFingerprint(answers);
  const dirty = attempt?.status === "draft" && fingerprint !== saved;
  const count = attempt?.questions.filter(q => answers[q.id] !== undefined).length ?? 0;
  const total = attempt?.questions.length ?? instrument.questionCount;
  const pageCount = Math.ceil(total / pageSize);
  const reloadRequired = error?.code === "conflict" || error?.operation === "reload";

  const write = useCallback(async (complete = false): Promise<boolean> => {
    const current = attemptRef.current;
    if (busyRef.current || !current || current.status !== "draft") return false;
    busyRef.current = true; setBusy(true); setError(null); setExitNotice(false);
    // Retry an uncertain response using the SAME request and snapshot first.
    const request = pending.current ?? { complete, input: { attemptId: current.attemptId, expectedRevision: current.revision, answers: { ...answersRef.current }, requestId: crypto.randomUUID() } };
    pending.current = request;
    setCompleting(request.complete);
    try {
      const response = await (request.complete ? completeStudentAssessmentAction : saveStudentAssessmentAction)(request.input);
      if (!response.ok) {
        setError({ ...response, operation: "write" });
        if (response.code !== "unavailable") { pending.current = null; setCompleting(false); }
        return false;
      }
      attemptRef.current = response.attempt; setAttempt(response.attempt);
      setSaved(assessmentAnswersFingerprint(request.input.answers));
      pending.current = null;
      setCompleting(false); setExitNotice(false);
      if (response.attempt.status === "completed") {
        setAnswers(response.attempt.answers); answersRef.current = response.attempt.answers;
        window.history.replaceState(null, "", `${assessmentPath(response.attempt.instrumentKey)}?attempt=${response.attempt.attemptId}`);
        heading.current?.focus();
      }
      return true;
    } catch { setError({ ...NETWORK_ERROR, operation: "write" }); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    if (!dirty || busy || error || attempt?.status !== "draft") return;
    const timer = window.setTimeout(() => { void write(); }, 650);
    return () => window.clearTimeout(timer);
  }, [dirty, fingerprint, busy, error, attempt?.status, write]);

  useEffect(() => {
    if (!attempt?.attemptId || attempt.status !== "draft") return;
    return installAssessmentExitGuard({
      blocked: () => attemptRef.current?.status === "draft" && (busyRef.current || pending.current !== null
        || assessmentAnswersFingerprint(answersRef.current) !== assessmentAnswersFingerprint(attemptRef.current.answers)),
      notify: () => setExitNotice(true),
    });
  }, [attempt?.attemptId, attempt?.status]);

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    startRequestId.current ??= crypto.randomUUID();
    try {
      const response = await startStudentAssessmentAction(instrument.instrumentKey, startRequestId.current);
      if (!response.ok) { setError({ ...response, operation: "start" }); return; }
      const next = response.attempt;
      attemptRef.current = next; setAttempt(next); setAnswers(next.answers); answersRef.current = next.answers;
      setSaved(assessmentAnswersFingerprint(next.answers));
      setPage(Math.floor(Math.max(0, next.questions.findIndex(q => !next.answers[q.id])) / pageSize));
      window.history.replaceState(null, "", `${assessmentPath(next.instrumentKey)}?attempt=${next.attemptId}`);
    } catch { setError({ ...NETWORK_ERROR, operation: "start" }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function select(id: string, value: string) {
    if (pending.current?.complete || reloadRequired) return;
    const next = { ...answersRef.current, [id]: value };
    answersRef.current = next; setAnswers(next);
  }

  function goTo(next: number) {
    if (pending.current?.complete) return;
    setPage(next);
    requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "start" }); });
  }

  async function loadLatest() {
    if (busyRef.current || !attemptRef.current) return;
    // Explicit confirmation prevents silently discarding the displayed local edits.
    if (!window.confirm(strings.confirmReload)) return;
    busyRef.current = true; setBusy(true);
    try {
      const response = await readStudentAssessmentAttemptAction(attemptRef.current.attemptId);
      if (!response.ok) { setError({ ...response, operation: "reload" }); return; }
      attemptRef.current = response.attempt; setAttempt(response.attempt);
      answersRef.current = response.attempt.answers; setAnswers(response.attempt.answers);
      setSaved(assessmentAnswersFingerprint(response.attempt.answers)); pending.current = null; setError(null);
      setExitNotice(false);
    } catch { setError({ ...NETWORK_ERROR, operation: "reload" }); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function pause() {
    if (busyRef.current || reloadRequired) return;
    if ((dirty || pending.current) && !await write()) return;
    if (assessmentAnswersFingerprint(answersRef.current) !== assessmentAnswersFingerprint(attemptRef.current?.answers ?? {})) return;
    router.push("/portal/tests");
  }

  if (attempt?.status === "completed") return <AssessmentResults attempt={attempt} locale={locale} />;

  const errorNotice = error || exitNotice ? (
    <div role="alert" className="pt-run-alert">
      {error ? <p>{error.operation === "reload" && error.code === "unavailable" ? strings.reloadUnavailable : strings[`error.${error.code}`]}</p> : null}
      {exitNotice ? <p>{reloadRequired ? strings.reloadBeforeExit : strings.exitBlocked}</p> : null}
      {attempt && (error?.code === "conflict" || (error?.code === "unavailable" && error.operation === "reload")) ? (
        <button type="button" className="pt-btn-ghost" onClick={() => void loadLatest()} disabled={busy}>{strings.loadSaved}</button>
      ) : attempt && error?.code === "unavailable" && error.operation === "write" ? (
        <button type="button" className="pt-btn-ghost" onClick={() => void write()} disabled={busy}>{strings.retrySave}</button>
      ) : null}
    </div>
  ) : null;

  if (!attempt) return (
    <section className="pt-run-card pt-run-intro">
      <div>
        <h2 className="pt-run-heading">{strings.introHeading}</h2>
        <ul className="pt-run-bullets">{instrument.metadata.instructions.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
      <p className="pt-run-text">{formatPortalString(strings.introMeta, { count: String(instrument.questionCount) })}</p>
      <details className="pt-run-limits">
        <summary className="pt-res-summary-line">{strings.introLimits}</summary>
        <ul className="pt-run-bullets">{instrument.metadata.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      </details>
      {errorNotice}
      <button type="button" className="pt-btn pt-run-start" disabled={busy} onClick={() => void start()}>
        {busy ? strings.startBusy : strings.startButton}
      </button>
    </section>
  );

  const review = page >= pageCount;
  return (
    <div className="pt-run" data-testid="assessment-runner">
      <div className="pt-run-bar">
        <div className="pt-run-bar-row">
          <span className="pt-run-count">{formatPortalString(strings.answeredOf, { count: String(count), total: String(total) })}</span>
          <span role="status" aria-live="polite" className="pt-run-status">
            {busy ? (reloadRequired ? strings.statusLoadingSaved : strings.statusSaving) : error ? strings.statusUnconfirmed : dirty ? strings.statusDirty : strings.statusSaved}
          </span>
        </div>
        <progress
          value={count}
          max={total}
          aria-label={formatPortalString(strings.progressAria, { count: String(count), total: String(total) })}
          className="pt-progress"
        />
      </div>
      {errorNotice}
      <section className="pt-run-card">
        <h2 ref={heading} tabIndex={-1} className="pt-run-heading">
          {review
            ? strings.reviewHeading
            : instrument.instrumentKey === "english36"
              ? formatPortalString(strings.taskOf, { n: String(page + 1), total: String(total) })
              : formatPortalString(strings.partOf, { n: String(page + 1), parts: String(pageCount) })}
        </h2>
        {review ? (
          <div className="pt-run-review">
            <p>{count === total ? strings.reviewAllAnswered : formatPortalString(strings.reviewRemaining, { count: String(total - count) })}</p>
            {count < total ? (
              <button type="button" className="pt-btn-ghost" onClick={() => goTo(Math.floor(attempt.questions.findIndex(q => !answers[q.id]) / pageSize))}>
                {strings.toFirstUnanswered}
              </button>
            ) : null}
            <button type="button" className="pt-btn" disabled={busy || count !== total || !!error} onClick={() => void write(true)}>
              {strings.completeButton}
            </button>
          </div>
        ) : (
          <div className="pt-run-questions">
            {attempt.questions.slice(page * pageSize, (page + 1) * pageSize).map((question, offset) => (
              <AssessmentQuestion
                key={question.id}
                question={question}
                instrumentKey={instrument.instrumentKey}
                answer={answers[question.id]}
                number={page * pageSize + offset + 1}
                disabled={completing || reloadRequired}
                onSelect={select}
              />
            ))}
          </div>
        )}
        <div className="pt-run-nav">
          <button type="button" className="pt-btn-ghost" disabled={page === 0 || completing} onClick={() => goTo(page - 1)}>{strings.back}</button>
          {!review ? (
            <button type="button" className="pt-btn" disabled={completing} onClick={() => goTo(page + 1)}>
              {page + 1 === pageCount ? strings.checkAndFinish : strings.next}
            </button>
          ) : null}
        </div>
      </section>
      <div className="pt-run-footer">
        <button type="button" className="pt-btn-ghost" disabled={busy || reloadRequired} onClick={() => void pause()}>{strings.saveAndExit}</button>
        <p className="pt-run-note">{strings.returnNote}</p>
      </div>
    </div>
  );
}
