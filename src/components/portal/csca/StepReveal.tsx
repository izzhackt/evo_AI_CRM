"use client";

import { useRef, useState } from "react";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";

import { MathText } from "./MathText";

type Strings = PortalStrings<"csca">;

/**
 * Разбор по шагам (контракт §13, `example`, и разбор задания §6): «Следующий
 * шаг» открывает следующую строку, «Показать решение» открывает всё сразу.
 * Новый шаг получает фокус, чтобы читалка экрана прочла именно его.
 */
export function StepReveal({
  steps,
  answer,
  strings,
  locale,
  answerLabel,
}: {
  steps: { ru: string; ky: string }[];
  answer?: string;
  strings: Strings;
  locale: Locale;
  answerLabel?: string;
}) {
  const [shown, setShown] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const done = shown >= steps.length;

  function reveal(next: number) {
    const focusIndex = shown;
    setShown(Math.min(next, steps.length));
    requestAnimationFrame(() => {
      const item = list.current?.children.item(focusIndex) as HTMLElement | null;
      item?.focus();
    });
  }

  return (
    <div className="cs-steps">
      {shown > 0 ? (
        <ol ref={list} className="cs-steps-list">
          {steps.slice(0, shown).map((step, index) => (
            <li key={index} tabIndex={-1} className="cs-step">
              <span className="cs-step-n" aria-hidden="true">{index + 1}</span>
              <span className="pt-sr-only">{formatPortalString(strings.exampleStep, { n: String(index + 1) })}. </span>
              <MathText className="cs-step-text" text={locale === "ky" ? step.ky : step.ru} />
            </li>
          ))}
        </ol>
      ) : <ol ref={list} className="cs-steps-list" hidden />}
      {done && answer ? (
        <p className="cs-step-answer">
          <span className="cs-step-answer-label">{answerLabel ?? strings.answerLabel}</span>
          <MathText text={answer} />
        </p>
      ) : null}
      {!done ? (
        <div className="cs-steps-actions">
          <button type="button" className="pt-btn-ghost" onClick={() => reveal(shown + 1)}>
            {strings.nextSolutionStep}
          </button>
          <button type="button" className="cs-text-btn" onClick={() => reveal(steps.length)}>
            {strings.showSolution}
          </button>
        </div>
      ) : null}
    </div>
  );
}
