"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString } from "@/lib/portal/i18n";
import type { LearningReviewCheck, LearningReviewItem } from "@/lib/portal/learning";
import {
  checkLearningReviewAction,
  type LearningActionError,
} from "@/lib/portal/learning-actions";

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
 * Режим повторения (PORT-4c): задания из собственного банка ошибок, та же
 * механика «ответ → мгновенный вердикт и разбор» (learning_review_check_v1).
 * Ничего не сохраняется — банк отражает завершённые попытки уроков.
 */
export function ReviewRunner({
  items,
  locale,
  strings,
}: {
  items: LearningReviewItem[];
  locale: Locale;
  strings: EnglishStrings;
}) {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<ExerciseValue | null>(null);
  const [checks, setChecks] = useState<Record<string, { check: LearningReviewCheck; answer: unknown }>>({});
  const [busy, setBusy] = useState(false);
  const [resultAnnouncement, setResultAnnouncement] = useState("");
  const [error, setError] = useState<LearningActionError["code"] | null>(null);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const current = index < items.length ? items[index] : null;
  const checkedCount = Object.keys(checks).length;

  async function submit() {
    if (busy || busyRef.current || !current || checks[current.exerciseId]) return;
    const currentValue = value ?? emptyExerciseValue(current);
    const answer = exerciseValueToAnswer(currentValue);
    if (!answer) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setResultAnnouncement("");
    try {
      const response = await checkLearningReviewAction({
        exerciseId: current.exerciseId,
        exerciseType: current.type,
        answer,
      });
      if (!response.ok) {
        setError(response.code);
        return;
      }
      setChecks((previous) => ({
        ...previous,
        [current.exerciseId]: { check: response.check, answer },
      }));
      setValue(null);
      // A11y (PORT-6a): успешная проверка заменяет кнопку «Ответить»
      // разбором — переносим фокус на заголовок шага, как уже делает
      // кнопка «Далее», иначе фокус молча падает на <body>.
      requestAnimationFrame(() => {
        heading.current?.focus();
        setResultAnnouncement(response.check.verdict.correct ? strings.verdictCorrect : strings.verdictWrong);
      });
    } catch {
      setError("unavailable");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <section className="pt-lesson-card">
        <h2 className="pt-section-title">
          {formatPortalString(strings.reviewDone, {
            done: String(checkedCount),
            total: String(items.length),
          })}
        </h2>
        <div className="pt-lesson-actions">
          <Link className="pt-btn" href="/portal/english">{strings.backToModule}</Link>
        </div>
      </section>
    );
  }

  const checked = checks[current.exerciseId];
  const currentValue = value ?? emptyExerciseValue(current);
  const submittable = exerciseValueComplete(current, currentValue);

  return (
    <div className="pt-lesson-flow">
      {/*
        A11y (PORT-6a): role="status" убран — счётчик уже объявляется
        переносом фокуса на sr-only заголовок ниже, live-область на том же
        тексте дублировала каждое объявление.
      */}
      <p className="pt-ex-progress">
        {formatPortalString(strings.exerciseCounter, {
          n: String(index + 1),
          total: String(items.length),
        })}
        {" · "}
        {formatPortalString(strings.reviewItemFrom, { n: String(current.lessonOrderIndex) })}
        <span role="status" aria-live="polite" aria-atomic="true">
          {busy ? ` · ${strings.saving}` : resultAnnouncement ? ` · ${resultAnnouncement}` : ""}
        </span>
      </p>
      <section className="pt-lesson-card">
        <h2 ref={heading} tabIndex={-1} className="pt-sr-only">
          {formatPortalString(strings.exerciseCounter, {
            n: String(index + 1),
            total: String(items.length),
          })}
        </h2>
        {checked ? (
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
              verdict={checked.check.verdict}
              explain={checked.check.explain}
              answer={checked.answer}
            />
          </div>
        ) : (
          <ExerciseForm
            exercise={current}
            locale={locale}
            strings={strings}
            value={currentValue}
            disabled={busy}
            onChange={setValue}
          />
        )}
        {error ? (
          <div role="alert" className="pt-alert">
            <p>{strings[({
              conflict: "errorConflict",
              invalid: "errorInvalid",
              denied: "errorDenied",
              unavailable: "errorUnavailable",
            } as const)[error]]}</p>
          </div>
        ) : null}
        <div className="pt-lesson-actions">
          {checked ? (
            <button
              type="button"
              className="pt-btn"
              onClick={() => {
                setIndex(index + 1);
                setValue(null);
                setResultAnnouncement("");
                requestAnimationFrame(() => heading.current?.focus());
              }}
            >
              {strings.nextButton}
            </button>
          ) : (
            <button
              type="button"
              className="pt-btn"
              disabled={!submittable}
              aria-disabled={busy || !submittable}
              onClick={() => void submit()}
            >
              {busy ? strings.saving : strings.answerButton}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
