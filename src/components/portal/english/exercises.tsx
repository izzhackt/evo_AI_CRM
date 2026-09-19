"use client";

import type { Locale } from "@/lib/i18n-data";
import {
  formatPortalString,
  type PortalStrings,
} from "@/lib/portal/i18n";
import type {
  LearningAnswer,
  LearningExercise,
  LearningExplain,
  LearningOption,
  LearningVerdict,
} from "@/lib/portal/learning";

/**
 * Формы четырёх типов заданий и панель разбора (PORT-4c). Английские
 * формулировки — учебное содержание и не переводятся; интерфейсные подписи —
 * RU/KY. Проверка ответа — только на сервере; здесь лишь сбор ввода.
 */

export type EnglishStrings = PortalStrings<"english">;

export type ExerciseValue =
  | { kind: "choice"; selected: string | null }
  | { kind: "matching"; matches: (number | null)[] }
  | { kind: "short_answer"; text: string }
  | { kind: "reading"; selected: Record<string, string> };

export function emptyExerciseValue(exercise: LearningExercise): ExerciseValue {
  if (exercise.type === "choice") return { kind: "choice", selected: null };
  if (exercise.type === "matching") {
    return { kind: "matching", matches: (exercise.lefts ?? []).map(() => null) };
  }
  if (exercise.type === "short_answer") return { kind: "short_answer", text: "" };
  return { kind: "reading", selected: {} };
}

export function exerciseValueComplete(
  exercise: LearningExercise,
  value: ExerciseValue,
): boolean {
  if (value.kind === "choice") return value.selected !== null;
  if (value.kind === "matching") {
    const chosen = value.matches.filter((item): item is number => item !== null);
    return chosen.length === value.matches.length && new Set(chosen).size === chosen.length;
  }
  if (value.kind === "short_answer") return value.text.trim().length > 0;
  return (exercise.questions ?? []).every((question) => value.selected[question.id]);
}

export function exerciseValueToAnswer(value: ExerciseValue): LearningAnswer | null {
  if (value.kind === "choice") {
    return value.selected === null ? null : { selected: value.selected };
  }
  if (value.kind === "matching") {
    const matches = value.matches.filter((item): item is number => item !== null);
    return matches.length === value.matches.length ? { matches } : null;
  }
  if (value.kind === "short_answer") {
    return value.text.trim() ? { text: value.text.trim() } : null;
  }
  return Object.keys(value.selected).length > 0 ? { selected: value.selected } : null;
}

export function optionLabel(option: LearningOption, locale: Locale): string {
  if (option.label) return option.label;
  return (locale === "ky" ? option.labelKy : option.labelRu) ?? option.labelRu ?? option.id;
}

export function exercisePrompt(exercise: LearningExercise, locale: Locale): string | null {
  if (exercise.promptEn) return exercise.promptEn;
  const localized = locale === "ky" ? exercise.promptKy : exercise.promptRu;
  return localized ?? exercise.promptRu ?? null;
}

function OptionList({
  name,
  options,
  locale,
  selected,
  disabled,
  onSelect,
  labelId,
}: {
  name: string;
  options: LearningOption[];
  locale: Locale;
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  /** id вопроса-абзаца перед списком — программная связь группы с вопросом. */
  labelId?: string;
}) {
  return (
    // A11y (PORT-6a, WCAG 1.3.1/H71): группа радио-кнопок программно связана
    // со своим вопросом через radiogroup + aria-labelledby — тот же паттерн,
    // что уже используется в LanguageForm.
    <div role="radiogroup" aria-labelledby={labelId}>
      <ul className="pt-ex-options">
        {options.map((option) => (
          <li key={option.id}>
            <label className="pt-ex-option">
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected === option.id}
                disabled={disabled}
                onChange={() => onSelect(option.id)}
              />
              {/*
                A11y (PORT-6a): option.label — непереведённая английская форма
                (проверяемое учебное содержание); lang="en" даёт корректное
                произношение скринридером, как у promptEn/passageEn выше.
              */}
              <span lang={option.label ? "en" : undefined}>{optionLabel(option, locale)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExerciseForm({
  exercise,
  locale,
  strings,
  value,
  disabled,
  onChange,
}: {
  exercise: LearningExercise;
  locale: Locale;
  strings: EnglishStrings;
  value: ExerciseValue;
  disabled: boolean;
  onChange: (value: ExerciseValue) => void;
}) {
  const prompt = exercisePrompt(exercise, locale);

  if (exercise.type === "choice" && value.kind === "choice") {
    const promptId = `exercise-${exercise.exerciseId}-prompt`;
    return (
      <div>
        {prompt ? <p id={promptId} className="pt-ex-prompt" lang={exercise.promptEn ? "en" : undefined}>{prompt}</p> : null}
        <OptionList
          name={`exercise-${exercise.exerciseId}`}
          options={exercise.options ?? []}
          locale={locale}
          selected={value.selected}
          disabled={disabled}
          onSelect={(id) => onChange({ kind: "choice", selected: id })}
          labelId={prompt ? promptId : undefined}
        />
      </div>
    );
  }

  if (exercise.type === "matching" && value.kind === "matching") {
    const instruction = locale === "ky" ? exercise.instructionKy : exercise.instructionRu;
    const rights = exercise.rights ?? [];
    return (
      <div>
        {instruction ? <p className="pt-ex-prompt">{instruction}</p> : null}
        <p className="pt-ex-hint">{strings.matchingHint}</p>
        <ul className="pt-match-list">
          {(exercise.lefts ?? []).map((left, index) => {
            const used = new Set(
              value.matches.filter((item, itemIndex) => item !== null && itemIndex !== index),
            );
            return (
              <li key={left} className="pt-match-row">
                <span className="pt-match-left" lang="en">{left}</span>
                <select
                  aria-label={formatPortalString(strings.matchingPairLabel, { left })}
                  className="pt-input"
                  disabled={disabled}
                  value={value.matches[index] === null ? "" : String(value.matches[index])}
                  onChange={(event) => {
                    const next = [...value.matches];
                    next[index] = event.target.value === "" ? null : Number(event.target.value);
                    onChange({ kind: "matching", matches: next });
                  }}
                >
                  <option value="">{strings.matchingEmptyOption}</option>
                  {rights.map((right, rightIndex) => (
                    <option
                      key={`${right.rightRu}-${rightIndex}`}
                      value={rightIndex}
                      disabled={used.has(rightIndex)}
                    >
                      {locale === "ky" ? right.rightKy : right.rightRu}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (exercise.type === "short_answer" && value.kind === "short_answer") {
    return (
      <div>
        {prompt ? <p className="pt-ex-prompt" lang={exercise.promptEn ? "en" : undefined}>{prompt}</p> : null}
        <label className="pt-field">
          <span className="pt-field-label">{strings.shortAnswerLabel}</span>
          <input
            className="pt-input"
            type="text"
            lang="en"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={300}
            disabled={disabled}
            value={value.text}
            onChange={(event) => onChange({ kind: "short_answer", text: event.target.value })}
          />
        </label>
        <p className="pt-ex-hint">{strings.shortAnswerHint}</p>
      </div>
    );
  }

  if (exercise.type === "reading" && value.kind === "reading") {
    return (
      <div>
        <h3 className="pt-ex-subheading">{strings.readingPassageHeading}</h3>
        <blockquote className="pt-read-passage" lang="en">{exercise.passageEn}</blockquote>
        <ol className="pt-read-questions">
          {(exercise.questions ?? []).map((question) => (
            <li key={question.id}>
              <p id={`exercise-${exercise.exerciseId}-${question.id}-prompt`} className="pt-ex-prompt" lang="en">{question.promptEn}</p>
              <OptionList
                name={`exercise-${exercise.exerciseId}-${question.id}`}
                options={question.options}
                locale={locale}
                selected={value.selected[question.id] ?? null}
                disabled={disabled}
                onSelect={(id) =>
                  onChange({ kind: "reading", selected: { ...value.selected, [question.id]: id } })}
                labelId={`exercise-${exercise.exerciseId}-${question.id}-prompt`}
              />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return null;
}

function explainText(
  entry: { explainRu: string; explainKy: string },
  locale: Locale,
): string {
  return locale === "ky" ? entry.explainKy : entry.explainRu;
}

/**
 * Разбор отвеченного задания: вердикт, правильный ответ и объяснения.
 * Появляется только после ответа — до него сервер разбор не отдаёт вовсе.
 */
export function ExplainPanel({
  exercise,
  locale,
  strings,
  verdict,
  explain,
  answer,
}: {
  exercise: LearningExercise;
  locale: Locale;
  strings: EnglishStrings;
  verdict: LearningVerdict;
  explain: LearningExplain;
  answer?: unknown;
}) {
  const heading = verdict.correct ? strings.verdictCorrect : strings.verdictWrong;

  let body: React.ReactNode = null;
  if (exercise.type === "choice" && explain.options) {
    const selected = answer && typeof answer === "object" && "selected" in answer
      ? String((answer as { selected: unknown }).selected)
      : null;
    const correctOption = (exercise.options ?? []).find(
      (option) => option.id === explain.correctOptionId,
    );
    const shown = explain.options.filter(
      (option) => option.id === explain.correctOptionId || option.id === selected,
    );
    body = (
      <div>
        {!verdict.correct && correctOption ? (
          <p className="pt-ex-correct-answer">
            {strings.correctAnswerLabel}: <strong lang="en">{optionLabel(correctOption, locale)}</strong>
          </p>
        ) : null}
        <ul className="pt-ex-explain-list">
          {shown.map((option) => (
            <li key={option.id}>{explainText(option, locale)}</li>
          ))}
        </ul>
      </div>
    );
  } else if (exercise.type === "matching" && explain.pairs) {
    body = (
      <div>
        <ul className="pt-ex-explain-pairs">
          {explain.pairs.map((pair, index) => (
            <li key={pair.leftEn} className={verdict.perPair?.[index] === false ? "pt-ex-pair-wrong" : undefined}>
              <span lang="en">{pair.leftEn}</span>
              {" — "}
              <span>{locale === "ky" ? pair.rightKy : pair.rightRu}</span>
            </li>
          ))}
        </ul>
        {explain.explainRu && explain.explainKy ? (
          <p>{explainText({ explainRu: explain.explainRu, explainKy: explain.explainKy }, locale)}</p>
        ) : null}
      </div>
    );
  } else if (exercise.type === "short_answer") {
    body = (
      <div>
        {explain.answer ? (
          <p className="pt-ex-correct-answer">
            {strings.correctAnswerLabel}: <strong lang="en">{explain.answer}</strong>
          </p>
        ) : null}
        {explain.explainRu && explain.explainKy ? (
          <p>{explainText({ explainRu: explain.explainRu, explainKy: explain.explainKy }, locale)}</p>
        ) : null}
      </div>
    );
  } else if (exercise.type === "reading" && explain.questions) {
    const selected = answer && typeof answer === "object" && "selected" in answer
      ? (answer as { selected: Record<string, unknown> }).selected
      : {};
    body = (
      <ol className="pt-read-questions">
        {explain.questions.map((question) => {
          const source = (exercise.questions ?? []).find((item) => item.id === question.id);
          const correctOption = source?.options.find(
            (option) => option.id === question.correctOptionId,
          );
          const chosen = typeof selected?.[question.id] === "string"
            ? String(selected[question.id])
            : null;
          const shown = question.options.filter(
            (option) => option.id === question.correctOptionId || option.id === chosen,
          );
          const questionCorrect = verdict.perQuestion?.[question.id] === true;
          return (
            <li key={question.id}>
              <p className="pt-ex-prompt" lang="en">{source?.promptEn}</p>
              <p className={questionCorrect ? "pt-ex-verdict-ok" : "pt-ex-verdict-bad"}>
                {questionCorrect ? strings.verdictCorrect : strings.verdictWrong}
                {!questionCorrect && correctOption
                  ? <> · {strings.correctAnswerLabel}: <strong lang="en">{optionLabel(correctOption, locale)}</strong></>
                  : null}
              </p>
              <ul className="pt-ex-explain-list">
                {shown.map((option) => (
                  <li key={option.id}>{explainText(option, locale)}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section
      className={verdict.correct ? "pt-ex-explain pt-ex-explain-ok" : "pt-ex-explain pt-ex-explain-bad"}
      role="status"
    >
      <h3 className="pt-ex-explain-heading">{heading}</h3>
      {body}
    </section>
  );
}
