"use client";

import type { AssessmentQuestion as Question, StudentAssessmentKey } from "@/lib/student-assessment-contract";

/**
 * Общие контролы вопроса в «Атласе» (PORT-8c); персистентность — забота
 * содержащего раннера. Контент вопроса приходит из read model со своей
 * локалью: английские задания помечаются lang="en", русский контент — "ru".
 */
export function AssessmentQuestion({ question, instrumentKey, answer, number, disabled = false, onSelect }: {
  question: Question;
  instrumentKey: StudentAssessmentKey;
  answer?: string;
  number: number;
  disabled?: boolean;
  onSelect: (id: string, value: string) => void;
}) {
  return (
    <fieldset className="pt-run-question">
      <legend className="pt-run-legend" lang={instrumentKey === "english36" ? "en" : "ru"}>
        {instrumentKey === "orvis92" ? `${number}. ` : ""}
        {question.prompt}
      </legend>
      {question.passage ? (
        <p lang="en" className="pt-read-passage pt-run-passage">{question.passage}</p>
      ) : null}
      <div className={instrumentKey === "orvis92" ? "pt-run-options-scale" : "pt-ex-options"}>
        {question.options.map((option) => (
          <label key={option.id} className="pt-ex-option">
            <input
              type="radio"
              name={`question-${question.id}`}
              value={option.id}
              checked={answer === option.id}
              onChange={() => onSelect(question.id, option.id)}
              disabled={disabled}
            />
            <span lang={instrumentKey === "english36" && option.id !== "unknown" ? "en" : "ru"}>
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
