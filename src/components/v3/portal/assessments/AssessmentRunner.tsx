"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeStudentAssessmentAction, readStudentAssessmentAttemptAction, saveStudentAssessmentAction, startStudentAssessmentAction } from "@/lib/student-assessment-actions";
import { assessmentAnswersFingerprint, assessmentPath, type AssessmentActionResult, type AssessmentAnswers, type AssessmentAttempt, type AssessmentCatalog, type AssessmentWriteInput } from "@/lib/student-assessment-contract";
import { AssessmentResults } from "./AssessmentResults";
import { AssessmentQuestion } from "./AssessmentQuestion";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";

const CONTROL = "inline-flex min-h-11 items-center justify-center rounded-nav border px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON = `${CONTROL} border-control-edge text-fg hover:bg-surface-2`;
const PRIMARY = `${CONTROL} border-transparent bg-accent text-on-accent hover:brightness-95`;
type PendingWrite = { input: AssessmentWriteInput; complete: boolean };
type ActionError = Extract<AssessmentActionResult, { ok: false }>;
const NETWORK_ERROR: ActionError = { ok: false, code: "unavailable", message: "Не удалось подтвердить сохранение. Ответы остались на экране. Повторите запрос перед выходом." };

export function AssessmentRunner({ instrument, initialAttempt }: { instrument: AssessmentCatalog["instruments"][number]; initialAttempt: AssessmentAttempt | null }) {
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
  const [error, setError] = useState<ActionError | null>(null);
  const [exitNotice, setExitNotice] = useState<string | null>(null);
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

  const write = useCallback(async (complete = false): Promise<boolean> => {
    const current = attemptRef.current;
    if (busyRef.current || !current || current.status !== "draft") return false;
    busyRef.current = true; setBusy(true); setError(null); setExitNotice(null);
    // Retry an uncertain response using the SAME request and snapshot first.
    const request = pending.current ?? { complete, input: { attemptId: current.attemptId, expectedRevision: current.revision, answers: { ...answersRef.current }, requestId: crypto.randomUUID() } };
    pending.current = request;
    setCompleting(request.complete);
    try {
      const response = await (request.complete ? completeStudentAssessmentAction : saveStudentAssessmentAction)(request.input);
      if (!response.ok) {
        setError(response);
        if (response.code !== "unavailable") { pending.current = null; setCompleting(false); }
        return false;
      }
      attemptRef.current = response.attempt; setAttempt(response.attempt);
      setSaved(assessmentAnswersFingerprint(request.input.answers));
      pending.current = null;
      setCompleting(false); setExitNotice(null);
      if (response.attempt.status === "completed") {
        setAnswers(response.attempt.answers); answersRef.current = response.attempt.answers;
        window.history.replaceState(null, "", `${assessmentPath(response.attempt.instrumentKey)}?attempt=${response.attempt.attemptId}`);
        heading.current?.focus();
      }
      return true;
    } catch { setError(NETWORK_ERROR); return false; }
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
      notify: () => setExitNotice("Переход остановлен: сначала сохраните ответы. Если соединение пропало, дождитесь восстановления и повторите сохранение — ваш ввод остаётся здесь."),
    });
  }, [attempt?.attemptId, attempt?.status]);

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    startRequestId.current ??= crypto.randomUUID();
    try {
      const response = await startStudentAssessmentAction(instrument.instrumentKey, startRequestId.current);
      if (!response.ok) { setError(response); return; }
      const next = response.attempt;
      attemptRef.current = next; setAttempt(next); setAnswers(next.answers); answersRef.current = next.answers;
      setSaved(assessmentAnswersFingerprint(next.answers));
      setPage(Math.floor(Math.max(0, next.questions.findIndex(q => !next.answers[q.id])) / pageSize));
      window.history.replaceState(null, "", `${assessmentPath(next.instrumentKey)}?attempt=${next.attemptId}`);
    } catch { setError(NETWORK_ERROR); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function select(id: string, value: string) {
    if (pending.current?.complete) return;
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
    if (!window.confirm("Загрузить сохранённые ответы? Несохранённые изменения в этой вкладке будут заменены.")) return;
    busyRef.current = true; setBusy(true);
    try {
      const response = await readStudentAssessmentAttemptAction(attemptRef.current.attemptId);
      if (!response.ok) { setError(response); return; }
      attemptRef.current = response.attempt; setAttempt(response.attempt);
      answersRef.current = response.attempt.answers; setAnswers(response.attempt.answers);
      setSaved(assessmentAnswersFingerprint(response.attempt.answers)); pending.current = null; setError(null);
    } catch { setError(NETWORK_ERROR); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function pause() {
    if (busyRef.current || error?.code === "conflict") return;
    if ((dirty || pending.current) && !await write()) return;
    if (assessmentAnswersFingerprint(answersRef.current) !== assessmentAnswersFingerprint(attemptRef.current?.answers ?? {})) return;
    router.push("/portal/tests");
  }

  if (attempt?.status === "completed") return <AssessmentResults attempt={attempt} />;

  const errorNotice = error || exitNotice ? <div role="alert" className="rounded-card border border-border bg-surface-2 p-4 text-sm leading-6 text-fg">
    {error ? <p>{error.message}</p> : null}
    {exitNotice ? <p>{exitNotice}</p> : null}
    {attempt && error?.code === "conflict" ? <button className={`${BUTTON} mt-3`} onClick={() => void loadLatest()} disabled={busy}>Загрузить сохранённую попытку</button> : attempt && error?.code === "unavailable" ? <button className={`${BUTTON} mt-3`} onClick={() => void write()} disabled={busy}>Повторить сохранение</button> : null}
  </div> : null;

  if (!attempt) return <section className="max-w-3xl space-y-6 rounded-card border border-border bg-surface p-5 sm:p-7">
    <div><h2 className="text-xl font-semibold text-fg">Перед началом</h2><ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-fg-2">{instrument.metadata.instructions.map(item => <li key={item}>{item}</li>)}</ul></div>
    <p className="text-sm leading-6 text-fg-2">{instrument.questionCount} заданий. Можно сделать паузу и продолжить позже. Результат не влияет на поступление и не передаётся куратору.</p>
    <details><summary className="min-h-11 cursor-pointer font-medium text-fg">Что важно знать о результате</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-fg-2">{instrument.metadata.limitations.map(item => <li key={item}>{item}</li>)}</ul></details>
    {errorNotice}
    <button className={PRIMARY} disabled={busy} onClick={() => void start()}>{busy ? "Открываем попытку…" : "Начать тест"}</button>
  </section>;

  const review = page >= pageCount;
  return <div className="mx-auto max-w-3xl space-y-5" data-testid="assessment-runner">
    <div className="rounded-card border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="font-medium text-fg">Ответили на {count} из {total}</span><span role="status" aria-live="polite" className="text-fg-3">{busy ? "Сохраняем…" : error ? "Сохранение не подтверждено" : dirty ? "Есть несохранённые ответы" : "Все ответы сохранены"}</span></div>
      <progress value={count} max={total} aria-label={`Прогресс: ${count} из ${total}`} className="mt-3 h-2 w-full accent-accent" />
    </div>
    {errorNotice}
    <section className="rounded-card border border-border bg-surface p-5 sm:p-7">
      <h2 ref={heading} tabIndex={-1} className="scroll-mt-28 text-lg font-semibold text-fg outline-none">{review ? "Готовы завершить?" : instrument.instrumentKey === "english36" ? `Задание ${page + 1} из ${total}` : `Часть ${page + 1} из ${pageCount}`}</h2>
      {review ? <div className="mt-5 space-y-5 text-sm leading-6 text-fg-2">
        <p>{count === total ? "Все вопросы заполнены. После завершения ответы этой попытки нельзя изменить. Результат останется в истории." : `Осталось ответить: ${total - count}. Можно выбрать «Не знаю» в английском тесте — это честнее случайного ответа.`}</p>
        {count < total ? <button className={BUTTON} onClick={() => goTo(Math.floor(attempt.questions.findIndex(q => !answers[q.id]) / pageSize))}>К первому пропущенному вопросу</button> : null}
        <button className={PRIMARY} disabled={busy || count !== total || !!error} onClick={() => void write(true)}>Завершить и получить результат</button>
      </div> : <div className="mt-6 space-y-8">{attempt.questions.slice(page * pageSize, (page + 1) * pageSize).map((question, offset) => <AssessmentQuestion key={question.id} question={question} instrumentKey={instrument.instrumentKey} answer={answers[question.id]} number={page * pageSize + offset + 1} disabled={completing || error?.code === "conflict"} onSelect={select} />)}</div>}
      <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
        <button className={BUTTON} disabled={page === 0 || completing} onClick={() => goTo(page - 1)}>Назад</button>
        {!review ? <button className={PRIMARY} disabled={completing} onClick={() => goTo(page + 1)}>{page + 1 === pageCount ? "Проверить и завершить" : "Далее"}</button> : null}
      </div>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><button className={BUTTON} disabled={busy || error?.code === "conflict"} onClick={() => void pause()}>Сохранить и выйти</button><p className="text-xs leading-5 text-fg-3">Можно вернуться к любому ответу до завершения.</p></div>
  </div>;
}
