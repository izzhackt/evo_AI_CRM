"use client";

import type { AssessmentQuestion as Question, StudentAssessmentKey } from "@/lib/student-assessment-contract";

/** Shared question controls; persistence belongs to the containing runner. */
export function AssessmentQuestion({ question, instrumentKey, answer, number, disabled = false, onSelect }: {
  question: Question;
  instrumentKey: StudentAssessmentKey;
  answer?: string;
  number: number;
  disabled?: boolean;
  onSelect: (id: string, value: string) => void;
}) {
  return <fieldset className="min-w-0">
    <legend className="w-full whitespace-pre-line text-base font-medium leading-7 text-fg" lang={instrumentKey === "english36" ? "en" : "ru"}>{instrumentKey === "orvis92" ? `${number}. ` : ""}{question.prompt}</legend>
    {question.passage ? <p lang="en" className="mt-4 whitespace-pre-line rounded-nav bg-surface-2 p-4 text-base leading-7 text-fg-2">{question.passage}</p> : null}
    <div className={`mt-4 ${instrumentKey === "orvis92" ? "grid gap-2 sm:grid-cols-5" : "space-y-3"}`}>
      {question.options.map(option => <label key={option.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-nav border px-4 py-3 text-sm leading-6 transition-colors ${answer === option.id ? "border-accent bg-accent/5 text-fg" : "border-control-edge text-fg-2 hover:bg-surface-2"}`}>
        <input type="radio" name={`question-${question.id}`} value={option.id} checked={answer === option.id} onChange={() => onSelect(question.id, option.id)} disabled={disabled} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" />
        <span lang={instrumentKey === "english36" && option.id !== "unknown" ? "en" : "ru"}>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
