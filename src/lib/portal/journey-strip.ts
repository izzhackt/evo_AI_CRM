/**
 * Полоса «Шаг N из M» на «Главной» (владелец, 10.11.2026): один счёт по шагам ПУТИ СТРАНЫ вместо десяти этапов EVO.
 * Чистая функция без React и Supabase: веб (HomeJourneyCard) и iPhone (JourneyCard) берут одно и то же вычисление.
 *
 * Текущий шаг не выбирается заново: это тот, что `timelineStepProgress` уже отметил «сейчас» в карточке «Путь»
 * (CountryTimeline), поэтому номер и «дальше» совпадают с ней, включая ближайший шаг для колонки доски, которой нет
 * в пути. Номер — `order` шага (позиция в файле пути), всего — число всех шагов; шаг «по желанию» входит в «всего»,
 * но никогда не текущий и не «дальше».
 */
import type { TimelineStepProgress } from "./country-timeline.ts";

export type JourneyStripStep = Readonly<{ id: string; order: number; title: string; optional?: boolean }>;

export type JourneyStrip =
  | Readonly<{ kind: "step"; n: number; total: number; title: string; nextTitle: string | null }>
  | Readonly<{ kind: "complete"; total: number }>;

/** Этапы дела, после которых поступление завершено (словарь `operational_stage`, как в OverviewView). */
const isFinishedStage = (stage: string): boolean => stage.trim() === "completed" || stage.trim() === "closed";

/**
 * `null`: полосы нет (прогресса нет: дела нет, обзор не прочитан или этап до пути). Дело завершено или закрыто, либо все
 * обычные шаги пройдены — `complete` (вместо номера «Поступление завершено»).
 */
export function journeyStrip(
  steps: readonly JourneyStripStep[],
  progress: Readonly<Record<string, TimelineStepProgress>> | null,
  stage?: string | null,
): JourneyStrip | null {
  if (steps.length === 0) return null;
  if (typeof stage === "string" && isFinishedStage(stage)) return { kind: "complete", total: steps.length };
  if (progress === null) return null;
  const index = steps.findIndex((step) => progress[step.id] === "current");
  if (index < 0) return { kind: "complete", total: steps.length };
  const current = steps[index];
  const next = steps.slice(index + 1).find((step) => progress[step.id] !== "optional" && step.optional !== true) ?? null;
  return { kind: "step", n: current.order, total: steps.length, title: current.title, nextTitle: next?.title ?? null };
}
