import { STUDY_COUNTRY_UNDECIDED, studyCountryOptions } from "../study-countries.ts";
import {
  TIMELINE_UNDECIDED,
  selectCountryTimeline,
  timelineStepProgress,
  todayForTimeline,
  type CountryTimelineView,
  type TimelineStepProgress,
} from "./country-timeline.ts";
import { TIMELINE_MODULE_ROUTES } from "./timeline-module-routes.ts";

/**
 * «Путь поступления» студента (S4, план §8.4; контракт docs/portal/country-timeline-contract.md §7). С 08.11.2026
 * полный путь живёт на «Поступлении», а «Главная» показывает его карточку: обе страницы берут путь отсюда, чтобы
 * выбор пути и прогресс не разошлись. Сервер выбирает и локализует путь сам; клиенту уходит только он.
 */
export type StudentJourney = Readonly<{
  /** Путь выбранной страны; `null`, если страны нет. */
  view: CountryTimelineView | null;
  /** Прогресс по этапу дела; `null`: дела нет или его обзор не прочитан. */
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
}>;

export function selectStudentJourney({ country, stage, boardStage, locale, now }: Readonly<{
  country: string | null;
  /** Этап дела (`operational_stage`); `undefined`: обзор дела не прочитан, прогресс не показываем. */
  stage: string | null | undefined;
  /** Колонка доски своего дела (357): уточняет шаг среди шагов одного этапа; нет — первый шаг этапа. */
  boardStage?: string | null;
  locale: string;
  now: Date;
}>): StudentJourney {
  const view = country
    ? selectCountryTimeline(country, {
      locale,
      today: todayForTimeline(now),
      modules: TIMELINE_MODULE_ROUTES,
    })
    : null;
  // 08.11.2026 (владелец): пройденные шаги и текущий — по этапу своего дела; без дела прогресса нет.
  const progress = view && stage !== undefined ? timelineStepProgress(view.steps, stage, boardStage) : null;
  return { view, progress };
}

/** Шесть стран и «Пока не решил» для выбора страны пути (код UNDECIDED пути вместо кода анкеты). */
export function timelineCountryOptions(locale: string): readonly Readonly<{ code: string; label: string }>[] {
  return studyCountryOptions(locale, { undecided: true }).map((option) => ({
    code: option.code === STUDY_COUNTRY_UNDECIDED ? TIMELINE_UNDECIDED : option.code,
    label: option.label,
  }));
}
