/**
 * Досье дела (миграция 382, инструмент `get_case_dossier`): третий этап — «шаг пути поступления страны» («3 из 7, Малайзия»).
 *
 * Пути стран лежат в `src/content/timelines/*.json` и считаются в приложении (`country-timeline.ts`), а база их не видит.
 * Поэтому функция базы отдаёт `timeline_step: null` и ключи (`keys.country_code`, `keys.operational_stage`,
 * `keys.pipeline_stage`), а обработчик MCP вызывает `attachDossierTimelineStep` и подмешивает ответ той же функцией выбора шага,
 * что и кабинет студента (`timelineStepProgress`): правило «сейчас» не дублируется.
 *
 * Чистый модуль без server-only: его читают обработчик MCP и тесты.
 */
import {
  TIMELINE_STAGE_KEYS,
  selectCountryTimeline,
  timelineStepProgress,
  todayForTimeline,
} from "../portal/country-timeline.ts";
import { STUDY_COUNTRY_CODES } from "../study-countries.ts";

export const DOSSIER_TIMELINE_LABEL = "Шаг пути поступления страны (по файлу пути, не то же самое, что этап процесса и колонка доски)";

export type DossierTimelineStep = Readonly<{
  label: string;
  /** «3 из 7, Малайзия»; общий маршрут: «3 из 7, Малайзия (общий маршрут)». */
  text: string;
  position: number;
  of: number;
  country: string;
  title: string;
  /** Все шаги пройдены. */
  finished: boolean;
  /** `country` — утверждённый путь страны; `general` — общий маршрут, потому что путь страны не утверждён (правило кабинета). */
  route: "country" | "general";
}>;

export type DossierTimelineResult =
  | Readonly<{ step: DossierTimelineStep; note: null }>
  | Readonly<{ step: null; note: string }>;

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Шаг пути по ключам досье. Маршрут выбирает та же `selectCountryTimeline`, что в кабинете студента: утверждённый файл страны,
 * иначе общий маршрут. Ничего не угадывает: нет страны из шести или этапа в путях — `step: null` и причина.
 */
export function dossierTimelineStep(keys: unknown, today: string = todayForTimeline()): DossierTimelineResult {
  const record = typeof keys === "object" && keys !== null && !Array.isArray(keys) ? (keys as Record<string, unknown>) : {};
  const code = textOrNull(record.country_code);
  if (code === null || !STUDY_COUNTRY_CODES.includes(code)) {
    return { step: null, note: "Страна дела не из шести стран продукта: пути поступления для неё нет." };
  }
  const view = selectCountryTimeline(code, { today });
  if (view === null) return { step: null, note: "Путь для этой страны не выбран." };

  const stage = textOrNull(record.operational_stage);
  const board = textOrNull(record.pipeline_stage);
  const regular = view.steps.filter((step) => !step.optional);
  const country = view.countryName ?? code;

  let current: number;
  let finished = false;
  if (stage === "completed") {
    // Поступление завершено: все шаги пройдены (этого этапа нет среди ключей путей).
    current = regular.length - 1;
    finished = true;
  } else {
    if (stage === null || !(TIMELINE_STAGE_KEYS as readonly string[]).includes(stage)) {
      return { step: null, note: "Этап процесса дела вне шагов пути (до приёма, закрыт или индивидуальный): шаг не определён." };
    }
    const progress = timelineStepProgress(view.steps, stage, board);
    if (progress === null) return { step: null, note: "Шаг пути для этого этапа не определён." };
    current = regular.findIndex((step) => progress[step.id] === "current");
    if (current < 0) {
      current = regular.length - 1;
      finished = true;
    }
  }
  if (regular.length === 0 || current < 0) return { step: null, note: "В пути страны нет шагов." };
  return {
    step: {
      label: DOSSIER_TIMELINE_LABEL,
      text: `${current + 1} из ${regular.length}, ${country}${view.kind === "general" ? " (общий маршрут)" : ""}`,
      position: current + 1,
      of: regular.length,
      country,
      title: regular[current].title,
      finished,
      route: view.kind,
    },
    note: null,
  };
}

/**
 * Ответ `get_case_dossier` с шагом пути. Любая другая форма (не объект, нет `keys`) возвращается как есть:
 * инструмент не должен падать из-за подмеса.
 */
export function attachDossierTimelineStep(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const result = dossierTimelineStep(record.keys);
  return { ...record, timeline_step: result.step, ...(result.note === null ? {} : { timeline_step_note: result.note }) };
}
