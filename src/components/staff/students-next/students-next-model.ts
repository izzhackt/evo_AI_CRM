/**
 * «Студенты» и EVO Docs в «Новом виде»: чистые модели над теми же чтениями, что у прежнего вида (`students-queue-view`):
 * строки таблицы, плитки сроков, меню фильтров и поиск. Ни запросов, ни React — страница и тест зовут одни и те же функции.
 */
import { ADMISSIONS_PIPELINE_STAGES } from "@/lib/platform-admissions-pipeline-contract";
import type { StudentCaseQueueCounts, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import type { LinkFilterBarData, LinkFilterMenu } from "../list-next/link-filters-model";
import { DIRECTION_LABELS } from "../profile/admissions-view";
import { curatorOptions, type CuratorName } from "../students/StudentsQueueHead";
import { studentsRowMeta } from "../students/StudentsQueueTable";
import { studentsListHref, studentsStepView, type StudentsQueueParams } from "../students/students-queue-view";

const DIRECTION_ORDER = ["CN", "MY", "EUROPE", "AE", "TR", "unknown"] as const;

/** Строка таблицы: само чтение дела и слова, по которым таблица сортирует. */
export type NextStudentRow = Readonly<{
  id: string;
  row: StudentCaseQueueRow;
  name: string;
  meta: string;
  stage: string | null;
  /** Порядок по сроку шага: сначала с датой, потом без даты, потом без шага (как у чтения 241). */
  dueSort: number;
}>;

export function studentRows(rows: readonly StudentCaseQueueRow[]): NextStudentRow[] {
  return rows.map((row) => {
    const rank = row.nextAction === null ? 2 : row.nextActionDueOn === null ? 1 : 0;
    const day = row.nextActionDueOn ? Date.parse(row.nextActionDueOn) : 0;
    return {
      id: row.studentCaseId, row, name: row.studentDisplayName, meta: studentsRowMeta(row),
      stage: admissionsPipelineStage(row.pipelineStage), dueSort: rank * 1e13 + (Number.isFinite(day) ? day : 0),
    };
  });
}

export type StudentTile = Readonly<{ key: string; label: string; value: number; tone: "neutral" | "warn" | "danger" }>;

const TILES = [["overdue", "Просрочено", "danger"], ["today", "Сегодня", "neutral"], ["this_week", "На этой неделе", "neutral"], ["no_step", "Без шага", "warn"]] as const;

/** Плитки сроков вместо заголовков групп: только числа из чтения чисел (нет чтения — нет плиток) и только там, где ведётся шаг. */
export function studentTiles(params: StudentsQueueParams, counts: StudentCaseQueueCounts | null): readonly StudentTile[] {
  if (!counts || params.mode !== "queue" || params.sort === "updated" || !studentsStepView(params.view)) return [];
  return TILES.map(([key, label, tone]) => ({ key, label, value: counts.bands[key], tone })).filter((tile) => tile.value > 0);
}

/** Число варианта меню: при удачном чтении отсутствие — 0 строк после нажатия; без чтения — числа нет. */
function facet<T>(counts: StudentCaseQueueCounts | null, list: readonly T[] | undefined, match: (item: T) => boolean, value: (item: T) => number): number | null {
  if (!counts || !list) return null;
  const item = list.find(match);
  return item ? value(item) : 0;
}

/** Скрытые поля поиска: вид и фильтры остаются, страница и открытая запись сбрасываются (как у прежней строки инструментов). */
export function studentsSearchHidden(params: StudentsQueueParams): Record<string, string | null> {
  const queue = params.mode === "queue";
  return {
    section: queue ? null : "docs",
    view: !queue || params.view !== params.defaultView ? params.view : null,
    direction: params.direction,
    curator: params.curator,
    stage: queue ? params.stage : null,
    sort: queue && params.sort === "updated" ? "updated" : null,
  };
}

/** Меню «Направление», «Куратор», «Этап», «Сортировка»: те же значения и адреса, что у прежней строки инструментов. */
export function studentsFilterBar(params: StudentsQueueParams, counts: StudentCaseQueueCounts | null, names: readonly CuratorName[], curatorFilter: boolean): LinkFilterBarData {
  const queue = params.mode === "queue";
  const menus: LinkFilterMenu[] = [{
    key: "direction", label: "Направление", valueLabel: params.direction ? DIRECTION_LABELS[params.direction] : null,
    options: [
      { key: "all", label: "Все направления", href: studentsListHref(params, { direction: null }), selected: params.direction === null },
      ...DIRECTION_ORDER.map((direction) => ({
        key: direction, label: DIRECTION_LABELS[direction], href: studentsListHref(params, { direction }), selected: params.direction === direction,
        count: facet(counts, counts?.directions, (item) => item.direction === direction, (item) => item.count),
      })),
    ],
  }];
  if (curatorFilter || params.curator) {
    const options = curatorOptions(params, counts, names);
    menus.push({ key: "curator", label: "Куратор", valueLabel: options.find((option) => option.key === params.curator)?.label ?? null, options });
  }
  if (queue) {
    menus.push({
      key: "stage", label: "Этап", valueLabel: params.stage ? admissionsPipelineStage(params.stage) : null,
      options: [
        { key: "all", label: "Все этапы", href: studentsListHref(params, { stage: null }), selected: params.stage === null },
        ...ADMISSIONS_PIPELINE_STAGES.flatMap((stage) => {
          const label = admissionsPipelineStage(stage);
          return label ? [{
            key: stage, label, href: studentsListHref(params, { stage }), selected: params.stage === stage,
            count: facet(counts, counts?.stages, (item) => item.pipelineStage === stage, (item) => item.count),
          }] : [];
        }),
      ],
    });
    if (studentsStepView(params.view)) {
      menus.push({
        key: "sort", label: "Сортировка", valueLabel: params.sort === "updated" ? "по обновлению" : "по сроку",
        options: [
          { key: "due", label: "По сроку шага", href: studentsListHref(params, { sort: null }), selected: params.sort === "due" },
          { key: "updated", label: "По обновлению", href: studentsListHref(params, { sort: "updated" }), selected: params.sort === "updated" },
        ],
      });
    }
  }
  const active = [params.query, params.direction, params.curator, queue ? params.stage : null, queue && params.sort === "updated" ? "updated" : null].filter(Boolean).length;
  return { menus, resetHref: active ? studentsListHref(params, { query: null, direction: null, curator: null, stage: null, sort: null }) : null };
}
