"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString } from "@/lib/portal/i18n";
import {
  firstUnansweredIndex,
  type LearningAttempt,
  type LearningExplain,
  type LearningLessonView,
  type LearningVerdict,
} from "@/lib/portal/learning";
import {
  completeLearningLessonAction,
  reloadLearningLessonAction,
  saveLearningAnswerAction,
  startLearningLessonAction,
  type LearningActionError,
} from "@/lib/portal/learning-actions";
import { installAssessmentExitGuard } from "@/lib/student-assessment-exit-guard";

import {
  emptyExerciseValue,
  exercisePrompt,
  exerciseValueComplete,
  exerciseValueToAnswer,
  ExerciseForm,
  ExplainPanel,
  type EnglishStrings,
  type ExerciseValue,
} from "./exercises";

/**
 * Урок-раннер (PORT-4c, механика по образцу AssessmentRunner): теория →
 * задания по одному, ответ сохраняется сразу и возвращает вердикт + разбор
 * из save-RPC; черновик резюмируется с первого неотвеченного; выход при
 * несохранённом ответе останавливается exit-guard'ом. Завершение — отдельное
 * действие, доступное после ответа на каждое задание.
 */

type AnsweredEntry = { answer: unknown; verdict: LearningVerdict; explain: LearningExplain };
type LessonOperation = "start" | "answer" | "complete" | "reload";
type PendingSave = {
  requestId: string;
  exerciseId: string;
  exerciseType: string;
  answer: unknown;
  expectedRevision: number;
};

function answeredFromAttempt(attempt: LearningAttempt | null): Record<string, AnsweredEntry> {
  if (!attempt) return {};
  return Object.fromEntries(
    Object.entries(attempt.answers).map(([exerciseId, entry]) => [
      exerciseId,
      { answer: entry.answer, verdict: entry.verdict, explain: entry.explain },
    ]),
  );
}

export function LessonRunner({
  view,
  locale,
  strings,
}: {
  view: LearningLessonView;
  locale: Locale;
  strings: EnglishStrings;
}) {
  const exercises = view.lesson.exercises;
  const [attempt, setAttempt] = useState<LearningAttempt | null>(view.draft);
  const [answered, setAnswered] = useState<Record<string, AnsweredEntry>>(
    () => answeredFromAttempt(view.draft),
  );
  const [completed, setCompleted] = useState<LearningAttempt | null>(
    view.draft ? null : view.latestCompleted,
  );
  const [phase, setPhase] = useState<"intro" | "exercises">(
    view.draft && Object.keys(view.draft.answers).length > 0 ? "exercises" : "intro",
  );
  const [index, setIndex] = useState(() =>
    view.draft ? firstUnansweredIndex(exercises, view.draft.answers) : 0);
  const [value, setValue] = useState<ExerciseValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState("");
  const [error, setError] = useState<LearningActionError["code"] | null>(null);
  const failedOperation = useRef<LessonOperation | null>(null);
  const [exitNotice, setExitNotice] = useState(false);
  const pendingSave = useRef<PendingSave | null>(null);
  const startRequestId = useRef<string | null>(null);
  const completeRequestId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const answeredCount = Object.keys(answered).length;
  const total = exercises.length;
  const current = index < total ? exercises[index] : null;
  const currentEntry = current ? answered[current.exerciseId] : undefined;

  const currentValue = useMemo<ExerciseValue | null>(() => {
    if (!current || currentEntry) return null;
    return value ?? emptyExerciseValue(current);
  }, [current, currentEntry, value]);

  useEffect(() => {
    dirtyRef.current = currentValue !== null && current !== null
      && exerciseValueToAnswer(currentValue) !== null && !currentEntry;
  });

  useEffect(() => {
    if (completed || !attempt || attempt.status !== "draft") return;
    return installAssessmentExitGuard({
      blocked: () => busyRef.current || pendingSave.current !== null || dirtyRef.current,
      notify: () => setExitNotice(true),
    });
  }, [attempt, completed]);

  function focusHeading(result?: string) {
    requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: "start" });
      if (result) setResultAnnouncement(result);
    });
  }

  function reportFailure(code: LearningActionError["code"], operation: LessonOperation) {
    failedOperation.current = operation;
    setError(code);
  }

  function retryFailedOperation() {
    if (busyRef.current) return;
    switch (failedOperation.current) {
      case "start": void start(); break;
      case "answer": void submitAnswer(); break;
      case "complete": void complete(); break;
      case "reload": void reloadDraft(); break;
    }
  }

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true;
    failedOperation.current = null;
    setBusy(true);
    setError(null);
    setResultAnnouncement("");
    startRequestId.current ??= crypto.randomUUID();
    try {
      const response = await startLearningLessonAction(view.lesson.lessonId, startRequestId.current);
      if (!response.ok) {
        reportFailure(response.code, "start");
        return;
      }
      setAttempt(response.attempt);
      setAnswered(answeredFromAttempt(response.attempt));
      setCompleted(null);
      setIndex(firstUnansweredIndex(exercises, response.attempt.answers));
      setPhase("exercises");
      focusHeading();
    } catch {
      reportFailure("unavailable", "start");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (busy || busyRef.current || !attempt || !current || currentEntry) return;
    const request = pendingSave.current ?? (() => {
      if (!currentValue) return null;
      const answer = exerciseValueToAnswer(currentValue);
      if (!answer) return null;
      return {
        requestId: crypto.randomUUID(),
        exerciseId: current.exerciseId,
        exerciseType: current.type,
        answer,
        expectedRevision: attempt.revision,
      };
    })();
    if (!request) return;
    pendingSave.current = request;
    busyRef.current = true;
    failedOperation.current = null;
    setBusy(true);
    setError(null);
    setExitNotice(false);
    setResultAnnouncement("");
    try {
      const response = await saveLearningAnswerAction({
        attemptId: attempt.attemptId,
        expectedRevision: request.expectedRevision,
        exerciseId: request.exerciseId,
        exerciseType: request.exerciseType,
        answer: request.answer,
        requestId: request.requestId,
      });
      if (!response.ok) {
        reportFailure(response.code, "answer");
        if (response.code !== "unavailable") pendingSave.current = null;
        return;
      }
      pendingSave.current = null;
      setAttempt({ ...attempt, revision: response.save.revision });
      setAnswered((previous) => ({
        ...previous,
        [response.save.exerciseId]: {
          answer: request.answer,
          verdict: response.save.verdict,
          explain: response.save.explain,
        },
      }));
      setValue(null);
      // A11y (PORT-6a): успешный ответ заменяет кнопку «Ответить» разбором —
      // без переноса фокуса он молча падал на <body>. Тот же focusHeading(),
      // что уже используют start()/complete().
      focusHeading(response.save.verdict.correct ? strings.verdictCorrect : strings.verdictWrong);
    } catch {
      reportFailure("unavailable", "answer");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function complete() {
    if (busyRef.current || !attempt) return;
    busyRef.current = true;
    failedOperation.current = null;
    setBusy(true);
    setError(null);
    completeRequestId.current ??= crypto.randomUUID();
    try {
      const response = await completeLearningLessonAction({
        attemptId: attempt.attemptId,
        expectedRevision: attempt.revision,
        requestId: completeRequestId.current,
      });
      if (!response.ok) {
        reportFailure(response.code, "complete");
        if (response.code !== "unavailable") completeRequestId.current = null;
        return;
      }
      setCompleted(response.attempt);
      setAttempt(null);
      focusHeading();
    } catch {
      reportFailure("unavailable", "complete");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reloadDraft() {
    if (busyRef.current) return;
    busyRef.current = true;
    failedOperation.current = null;
    setBusy(true);
    try {
      const response = await reloadLearningLessonAction(view.lesson.lessonId);
      if (!response.ok) {
        reportFailure(response.code, "reload");
        return;
      }
      pendingSave.current = null;
      setError(null);
      setAttempt(response.attempt);
      setAnswered(answeredFromAttempt(response.attempt));
      setIndex(firstUnansweredIndex(exercises, response.attempt.answers));
      setValue(null);
    } catch {
      reportFailure("unavailable", "reload");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const errorNotice = error || exitNotice ? (
    <div role="alert" className="pt-alert">
      {error ? <p>{strings[({
        conflict: "errorConflict",
        invalid: "errorInvalid",
        denied: "errorDenied",
        unavailable: "errorUnavailable",
      } as const)[error]]}</p> : null}
      {exitNotice ? <p>{strings.exitBlocked}</p> : null}
      {error === "conflict" ? (
        <button type="button" className="pt-btn-ghost" disabled={busy} onClick={() => void reloadDraft()}>
          {strings.reloadDraft}
        </button>
      ) : error === "unavailable" ? (
        // Повторяем именно отказавшую операцию; её request_id и снимок сохранены.
        <button
          type="button"
          className="pt-btn-ghost"
          disabled={busy}
          onClick={retryFailedOperation}
        >
          {strings.retry}
        </button>
      ) : null}
    </div>
  ) : null;

  if (completed) {
    return (
      <CompletionView
        attempt={completed}
        view={view}
        locale={locale}
        strings={strings}
        busy={busy}
        errorNotice={errorNotice}
        onRepeat={() => {
          startRequestId.current = null;
          completeRequestId.current = null;
          setCompleted(null);
          setAttempt(null);
          setAnswered({});
          setValue(null);
          setIndex(0);
          setPhase("intro");
          void start();
        }}
      />
    );
  }

  if (phase === "intro") {
    const meta = view.lesson.metadata;
    return (
      <section className="pt-lesson-card">
        <h2 ref={heading} tabIndex={-1} className="pt-section-title">{strings.goalHeading}</h2>
        <p className="pt-lesson-goal">{locale === "ky" ? meta.goal_ky : meta.goal_ru}</p>
        <h2 className="pt-section-title">{strings.theoryHeading}</h2>
        <div className="pt-theory">
          {view.lesson.theory.map((block, blockIndex) => (
            <div key={blockIndex} className="pt-theory-block">
              <p>{locale === "ky" ? block.text_ky : block.text_ru}</p>
              <ul className="pt-theory-examples">
                {block.examples.map((example) => (
                  <li key={example.en}>
                    <span lang="en">{example.en}</span>
                    <span className="pt-theory-translation">
                      {locale === "ky" ? example.ky : example.ru}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {errorNotice}
        <button
          type="button"
          className="pt-btn"
          disabled={busy}
          onClick={() => {
            if (attempt) {
              setPhase("exercises");
              setIndex(firstUnansweredIndex(exercises, attempt.answers));
              focusHeading();
              return;
            }
            void start();
          }}
        >
          {busy ? strings.saving : attempt ? strings.continueLesson : strings.startLesson}
        </button>
      </section>
    );
  }

  // Все задания отвечены — экран завершения попытки.
  if (!current) {
    return (
      <section className="pt-lesson-card">
        <h2 ref={heading} tabIndex={-1} className="pt-section-title">{strings.finishButton}</h2>
        <p className="pt-lesson-goal">{strings.finishHint}</p>
        {errorNotice}
        <button
          type="button"
          className="pt-btn"
          disabled={busy || answeredCount !== total || !attempt}
          onClick={() => void complete()}
        >
          {busy ? strings.saving : strings.finishButton}
        </button>
      </section>
    );
  }

  const submittable = currentValue !== null && exerciseValueComplete(current, currentValue);
  return (
    <div className="pt-lesson-flow">
      {/*
        Счётчик объявляется переносом фокуса на заголовок. Постоянная live-область
        обновляет только сохранение и короткий подтверждённый вердикт; подробный
        разбор не объявляется целиком. Вердикт обновляется после переноса фокуса.
      */}
      <p className="pt-ex-progress">
        {formatPortalString(strings.exerciseCounter, { n: String(index + 1), total: String(total) })}
        <span role="status" aria-live="polite" aria-atomic="true">
          {busy ? ` · ${strings.saving}` : resultAnnouncement ? ` · ${resultAnnouncement}` : ""}
        </span>
      </p>
      <section className="pt-lesson-card">
        <h2 ref={heading} tabIndex={-1} className="pt-sr-only">
          {formatPortalString(strings.exerciseCounter, { n: String(index + 1), total: String(total) })}
        </h2>
        {currentEntry ? (
          <div>
            {exercisePrompt(current, locale) ? (
              <p className="pt-ex-prompt" lang={current.promptEn ? "en" : undefined}>
                {exercisePrompt(current, locale)}
              </p>
            ) : null}
            <ExplainPanel
              exercise={current}
              locale={locale}
              strings={strings}
              verdict={currentEntry.verdict}
              explain={currentEntry.explain}
              answer={currentEntry.answer}
            />
          </div>
        ) : (
          <ExerciseForm
            exercise={current}
            locale={locale}
            strings={strings}
            value={currentValue ?? emptyExerciseValue(current)}
            disabled={busy}
            onChange={setValue}
          />
        )}
        {errorNotice}
        <div className="pt-lesson-actions">
          {currentEntry ? (
            <button
              type="button"
              className="pt-btn"
              onClick={() => {
                setIndex(index + 1);
                setValue(null);
                setResultAnnouncement("");
                focusHeading();
              }}
            >
              {index + 1 === total ? strings.toCompletion : strings.nextButton}
            </button>
          ) : (
            <button
              type="button"
              className="pt-btn"
              disabled={!submittable}
              aria-disabled={busy || !submittable}
              onClick={() => void submitAnswer()}
            >
              {busy ? strings.saving : strings.answerButton}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Итог урока: собирается из результатов заданий попытки (решение PORT-4a —
 * отдельного статического экрана итога в v1 нет). Показывает долю верных и
 * полный разбор каждого задания.
 */
function CompletionView({
  attempt,
  view,
  locale,
  strings,
  busy,
  errorNotice,
  onRepeat,
}: {
  attempt: LearningAttempt;
  view: LearningLessonView;
  locale: Locale;
  strings: EnglishStrings;
  busy: boolean;
  errorNotice: React.ReactNode;
  onRepeat: () => void;
}) {
  const result = attempt.result;
  const wrongCount = result?.wrongExerciseIds.length ?? 0;
  return (
    <div className="pt-lesson-flow">
      <section className="pt-lesson-card">
        <h2 tabIndex={-1} className="pt-section-title">{strings.completionHeading}</h2>
        {result ? (
          <p className="pt-completion-share">
            {formatPortalString(strings.completionShare, {
              correct: String(result.correctCount),
              total: String(result.exercisesTotal),
            })}
          </p>
        ) : null}
        <p className="pt-lesson-goal">
          {wrongCount === 0
            ? strings.completionNoMistakes
            : formatPortalString(strings.completionMistakes, { count: String(wrongCount) })}
        </p>
        {errorNotice}
        <div className="pt-lesson-actions">
          {wrongCount > 0 ? (
            <Link className="pt-btn" href="/portal/english/review">{strings.reviewEntry}</Link>
          ) : null}
          <button type="button" className="pt-btn-ghost" disabled={busy} onClick={onRepeat}>
            {strings.repeatLesson}
          </button>
          <Link className="pt-btn-ghost" href="/portal/english">{strings.backToModule}</Link>
        </div>
      </section>
      <ol className="pt-completion-list">
        {view.lesson.exercises.map((exercise, exerciseIndex) => {
          const entry = attempt.answers[exercise.exerciseId];
          if (!entry) return null;
          return (
            <li key={exercise.exerciseId} className="pt-lesson-card">
              <p className="pt-ex-progress">
                {formatPortalString(strings.exerciseCounter, {
                  n: String(exerciseIndex + 1),
                  total: String(view.lesson.exercises.length),
                })}
              </p>
              {exercisePrompt(exercise, locale) ? (
                <p className="pt-ex-prompt" lang={exercise.promptEn ? "en" : undefined}>
                  {exercisePrompt(exercise, locale)}
                </p>
              ) : null}
              <ExplainPanel
                exercise={exercise}
                locale={locale}
                strings={strings}
                verdict={entry.verdict}
                explain={entry.explain}
                answer={entry.answer}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
