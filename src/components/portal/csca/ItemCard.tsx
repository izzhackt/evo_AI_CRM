"use client";

import { useId, type KeyboardEvent, type ReactNode, type Ref } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { CscaExplain, CscaFigure, CscaItem, CscaOptionId } from "@/lib/portal/csca";

import { Figure } from "./Figure";
import { MathText } from "./MathText";
import { ReportItem } from "./ReportItem";
import { StepReveal } from "./StepReveal";

type Strings = PortalStrings<"csca">;

export type ItemCardState =
  | { kind: "open"; selected: CscaOptionId | null; busy: boolean }
  | {
    kind: "answered";
    selected: CscaOptionId | null;
    correct: boolean;
    explain: CscaExplain;
  };

const KEY_TO_OPTION: Readonly<Record<string, CscaOptionId>> = {
  KeyA: "a", KeyB: "b", KeyC: "c", KeyD: "d",
  Digit1: "a", Digit2: "b", Digit3: "c", Digit4: "d",
  Numpad1: "a", Numpad2: "b", Numpad3: "c", Numpad4: "d",
};

export function optionLetter(id: CscaOptionId): string {
  return id.toUpperCase();
}

function Mark({ kind }: { kind: "ok" | "bad" }) {
  return (
    <svg className="cs-mark" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      {kind === "ok"
        ? <path d="m6 10.2 2.6 2.6L14 7.4" stroke="var(--pt-surface)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="m7 7 6 6M13 7l-6 6" stroke="var(--pt-surface)" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function SkipMark() {
  return (
    <svg className="cs-mark" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Difficulty({ level, strings }: { level: number; strings: Strings }) {
  return (
    <span className="cs-difficulty" role="img" aria-label={formatPortalString(strings.difficulty, { n: String(level) })}>
      {[1, 2, 3].map((dot) => <span key={dot} data-on={dot <= level ? "" : undefined} />)}
    </span>
  );
}

/**
 * Карточка задания CSCA (контракт §5..§7): условие на английском, рисунок,
 * четыре варианта A, B, C, D. Выбор с клавиатуры: стрелки внутри группы, клавиши
 * A, B, C, D или 1, 2, 3, 4 (по физической клавише, раскладка не важна), Enter проверяет.
 * После ответа каждый вариант получает свой разбор RU/KY, решение
 * открывается по шагам, термины внизу. «Сообщить об ошибке» есть всегда.
 */
export function ItemCard({
  item,
  figure,
  locale,
  strings,
  counter,
  state,
  headingRef,
  headingLevel = 2,
  meta,
  footer,
  verdictRef,
  onSelect,
  onSubmit,
}: {
  item: CscaItem;
  figure: CscaFigure | null;
  locale: Locale;
  strings: Strings;
  counter: string;
  state: ItemCardState;
  headingRef?: Ref<HTMLHeadingElement>;
  headingLevel?: 2 | 3;
  meta?: ReactNode;
  footer?: ReactNode;
  verdictRef?: Ref<HTMLParagraphElement>;
  onSelect?: (id: CscaOptionId) => void;
  /** Есть у урока, практики и повторения; у теста на время ответ без проверки. */
  onSubmit?: () => void;
}) {
  const ky = locale === "ky";
  const groupId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (state.kind !== "open" || state.busy) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input[type='text'], .cs-report")) return;
    const option = KEY_TO_OPTION[event.code];
    if (option) {
      event.preventDefault();
      onSelect?.(option);
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>(`input[name="${CSS.escape(groupId)}"][value="${option}"]`)?.focus();
      });
      return;
    }
    if (event.key === "Enter" && onSubmit && state.selected) {
      event.preventDefault();
      onSubmit();
    }
  }

  const explainFor = (id: CscaOptionId) =>
    state.kind === "answered" ? state.explain.options.find((option) => option.id === id) : undefined;

  return (
    <article className="cs-item" data-state={state.kind} data-item-key={item.itemKey} onKeyDown={onKeyDown}>
      <header className="cs-item-head">
        <Heading ref={headingRef} tabIndex={-1} className="cs-item-counter">{counter}</Heading>
        <span className="cs-item-meta">
          <Difficulty level={item.difficulty} strings={strings} />
          <span className="pt-data">{formatPortalString(strings.estSeconds, { n: String(item.estSeconds) })}</span>
          {meta}
        </span>
      </header>

      <MathText as="p" className="cs-item-stem" lang="en" text={item.stemEn} />

      {figure ? <Figure figure={figure} locale={locale} size="item" /> : null}

      {state.kind === "answered" ? (
        // Вердикт сразу под условием: взгляд ещё там, разбор вариантов ниже.
        <p
          ref={verdictRef}
          tabIndex={-1}
          className="cs-verdict"
          data-result={state.selected === null ? "skipped" : state.correct ? "ok" : "bad"}
        >
          {state.selected === null ? <SkipMark /> : <Mark kind={state.correct ? "ok" : "bad"} />}
          <span>
            {state.selected === null
              ? strings.notAnswered
              : state.correct ? strings.verdictCorrect : strings.verdictWrong}
            {!state.correct ? (
              <span className="cs-verdict-key">
                {" · "}
                {formatPortalString(strings.verdictCorrectIs, { option: optionLetter(state.explain.correctOptionId) })}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}

      {state.kind === "open" ? (
        <fieldset className="cs-options" disabled={state.busy}>
          <legend className="pt-sr-only">{strings.optionsLabel}</legend>
          {item.options.map((option) => (
            <label key={option.id} className="cs-option" data-selected={state.selected === option.id ? "" : undefined}>
              <input
                type="radio"
                className="cs-option-input"
                name={groupId}
                value={option.id}
                checked={state.selected === option.id}
                onChange={() => onSelect?.(option.id)}
              />
              <span className="cs-option-letter">{optionLetter(option.id)}</span>
              <MathText className="cs-option-label" lang="en" text={option.label} />
            </label>
          ))}
        </fieldset>
      ) : (
        <ul className="cs-options cs-options-answered" aria-label={strings.optionsLabel}>
          {item.options.map((option) => {
            const isCorrect = state.explain.correctOptionId === option.id;
            const isChosen = state.selected === option.id;
            const mark = isCorrect ? "ok" : isChosen ? "bad" : null;
            const explain = explainFor(option.id);
            return (
              <li key={option.id} className="cs-option" data-mark={mark ?? undefined} data-chosen={isChosen ? "" : undefined}>
                <div className="cs-option-row">
                  <span className="cs-option-letter">{optionLetter(option.id)}</span>
                  <MathText className="cs-option-label" lang="en" text={option.label} />
                  {mark ? <Mark kind={mark} /> : null}
                </div>
                {isChosen || isCorrect ? (
                  <p className="cs-option-tags">
                    {isChosen ? <span>{strings.yourChoice}</span> : null}
                    {isCorrect ? <span>{strings.correctChoice}</span> : null}
                  </p>
                ) : null}
                {explain ? <MathText as="p" className="cs-option-explain" text={ky ? explain.explainKy : explain.explainRu} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      {state.kind === "answered" ? (
        <div className="cs-item-after">
          {state.explain.solutionRu.length > 0 ? (
            <section className="cs-solution" aria-label={strings.solutionHeading}>
              <p className="cs-solution-title">{strings.solutionHeading}</p>
              <StepReveal
                steps={state.explain.solutionRu.map((ru, index) => ({ ru, ky: state.explain.solutionKy[index] ?? ru }))}
                strings={strings}
                locale={locale}
              />
            </section>
          ) : null}
          {state.explain.terms.length > 0 ? (
            <ul className="cs-item-terms" aria-label={strings.itemTerms}>
              {state.explain.terms.map((term) => (
                <li key={term.en}>
                  <span lang="en">{term.en}</span>
                  <span className="cs-item-term-tr">{ky ? term.ky : term.ru}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {footer ? <div className="cs-item-foot">{footer}</div> : null}
      <ReportItem itemKey={item.itemKey} strings={strings} />
    </article>
  );
}
