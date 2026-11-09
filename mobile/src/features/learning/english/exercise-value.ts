// Ввод упражнений английского: порт чистых помощников веба (components/portal/english/exercises.tsx,
// файл с вёрсткой и поэтому не подключается напрямую). Проверка ответа только на сервере.
import type { LearningAnswer, LearningExercise, LearningOption } from "@web/lib/portal/learning";

export type ExerciseValue =
  | { kind: "choice"; selected: string | null }
  | { kind: "matching"; matches: (number | null)[] }
  | { kind: "short_answer"; text: string }
  | { kind: "reading"; selected: Record<string, string> };

export function emptyExerciseValue(exercise: LearningExercise): ExerciseValue {
  if (exercise.type === "choice") return { kind: "choice", selected: null };
  if (exercise.type === "matching") return { kind: "matching", matches: (exercise.lefts ?? []).map(() => null) };
  if (exercise.type === "short_answer") return { kind: "short_answer", text: "" };
  return { kind: "reading", selected: {} };
}

export function exerciseValueComplete(exercise: LearningExercise, value: ExerciseValue): boolean {
  if (value.kind === "choice") return value.selected !== null;
  if (value.kind === "matching") {
    const chosen = value.matches.filter((item): item is number => item !== null);
    return chosen.length === value.matches.length && new Set(chosen).size === chosen.length;
  }
  if (value.kind === "short_answer") return value.text.trim().length > 0;
  return (exercise.questions ?? []).every((question) => value.selected[question.id]);
}

export function exerciseValueToAnswer(value: ExerciseValue): LearningAnswer | null {
  if (value.kind === "choice") return value.selected === null ? null : { selected: value.selected };
  if (value.kind === "matching") {
    const matches = value.matches.filter((item): item is number => item !== null);
    return matches.length === value.matches.length ? { matches } : null;
  }
  if (value.kind === "short_answer") return value.text.trim() ? { text: value.text.trim() } : null;
  return Object.keys(value.selected).length > 0 ? { selected: value.selected } : null;
}

export function optionLabel(option: LearningOption, lang: "ru" | "ky"): string {
  if (option.label) return option.label;
  return (lang === "ky" ? option.labelKy : option.labelRu) ?? option.labelRu ?? option.id;
}

export function exercisePrompt(exercise: LearningExercise, lang: "ru" | "ky"): string | null {
  if (exercise.promptEn) return exercise.promptEn;
  return (lang === "ky" ? exercise.promptKy : exercise.promptRu) ?? exercise.promptRu ?? null;
}
