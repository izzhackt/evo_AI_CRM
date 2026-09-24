import Link from "next/link";

import { ADMISSIONS_PIPELINE_STAGES } from "@/lib/platform-admissions-pipeline-contract";
import type { StudentCaseQueueCounts } from "@/lib/platform-student-case-queue-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

import { DIRECTION_LABELS } from "../profile/admissions-view";
import { FilterMenu, type FilterOption } from "../queue/FilterMenu";
import { activeFilterCount } from "../queue/queue-url";
import { QueueToolbar } from "../queue/QueueToolbar";
import { QueueViewTabs } from "../queue/QueueViewTabs";
import { studentsListHref, type StudentsQueueParams, type StudentsTab } from "./students-queue-view";

const DIRECTION_ORDER = ["CN", "MY", "EUROPE", "AE", "TR", "unknown"] as const;

export type CuratorName = Readonly<{ membershipId: string; displayName: string }>;

/**
 * Числа варианта меню. Чтение чисел 241 отдаёт только непустые значения:
 * при удачном чтении отсутствие — это 0 строк после клика; без чтения — нет числа.
 */
function facetCount<T>(counts: StudentCaseQueueCounts | null, list: (counts: StudentCaseQueueCounts) => readonly T[], match: (item: T) => boolean, value: (item: T) => number): number | null {
  if (!counts) return null;
  const item = list(counts).find(match);
  return item ? value(item) : 0;
}

/** Варианты «Куратор ▾»: «Я» первым, затем по имени; имена без дел — из списка кураторов (0 дел). */
export function curatorOptions(params: StudentsQueueParams, counts: StudentCaseQueueCounts | null, names: readonly CuratorName[]): readonly FilterOption[] {
  const entries = new Map<string, { label: string; count: number | null; me: boolean }>();
  for (const curator of counts?.curators ?? []) {
    entries.set(curator.membershipId, { label: curator.isMe ? "Я" : curator.displayName ?? "Куратор без имени", count: curator.count, me: curator.isMe });
  }
  for (const name of names) {
    if (!entries.has(name.membershipId)) entries.set(name.membershipId, { label: name.displayName, count: counts ? 0 : null, me: false });
  }
  if (params.curator && !entries.has(params.curator)) entries.set(params.curator, { label: "Выбранный куратор", count: counts ? 0 : null, me: false });
  const sorted = [...entries.entries()].sort(([, a], [, b]) => Number(b.me) - Number(a.me) || a.label.localeCompare(b.label, "ru"));
  return [
    { key: "all", label: "Все кураторы", href: studentsListHref(params, { curator: null }), selected: params.curator === null },
    ...sorted.map(([id, entry]) => ({ key: id, label: entry.label, count: entry.count, href: studentsListHref(params, { curator: id }), selected: params.curator === id })),
  ];
}

export function StudentsTabs({ tabs }: Readonly<{ tabs: readonly StudentsTab[] }>) {
  // Прежний адрес сводки (`#admissions-summary`) ведёт к ряду вкладок: числа живут здесь.
  return <QueueViewTabs id="admissions-summary" label="Виды списка студентов" tabs={tabs} />;
}

/**
 * Строка инструментов «Студентов»: поиск, «Направление ▾», «Куратор ▾»
 * (Admin), «Этап ▾» и «Сортировка» — в EVO Docs без этапа и сортировки
 * (статусов работы там нет). Числа в меню — из чтения чисел 241.
 */
export function StudentsToolbar({
  params,
  counts,
  curatorFilter,
  curatorNames,
}: Readonly<{
  params: StudentsQueueParams;
  counts: StudentCaseQueueCounts | null;
  /** «Куратор ▾» — у Admin (и у всех, если фильтр уже в адресе). */
  curatorFilter: boolean;
  curatorNames: readonly CuratorName[];
}>) {
  const queue = params.mode === "queue";
  const curator = params.curator ? curatorOptions(params, counts, curatorNames).find((option) => option.key === params.curator) : null;
  const filters = <>
    <FilterMenu
      label="Направление"
      valueLabel={params.direction ? DIRECTION_LABELS[params.direction] : null}
      clearHref={studentsListHref(params, { direction: null })}
      options={[
        { key: "all", label: "Все направления", href: studentsListHref(params, { direction: null }), selected: params.direction === null },
        ...DIRECTION_ORDER.map((direction) => ({
          key: direction,
          label: DIRECTION_LABELS[direction],
          href: studentsListHref(params, { direction }),
          selected: params.direction === direction,
          count: facetCount(counts, (value) => value.directions, (item) => item.direction === direction, (item) => item.count),
        })),
      ]}
    />
    {curatorFilter || params.curator ? (
      <FilterMenu
        label="Куратор"
        valueLabel={curator?.label ?? null}
        clearHref={studentsListHref(params, { curator: null })}
        options={curatorOptions(params, counts, curatorNames)}
      />
    ) : null}
    {queue ? (
      <FilterMenu
        label="Этап"
        valueLabel={params.stage ? admissionsPipelineStage(params.stage) : null}
        clearHref={studentsListHref(params, { stage: null })}
        options={[
          { key: "all", label: "Все этапы", href: studentsListHref(params, { stage: null }), selected: params.stage === null },
          ...ADMISSIONS_PIPELINE_STAGES.map((stage) => ({
            key: stage,
            label: admissionsPipelineStage(stage) ?? stage,
            href: studentsListHref(params, { stage }),
            selected: params.stage === stage,
            count: facetCount(counts, (value) => value.stages, (item) => item.pipelineStage === stage, (item) => item.count),
          })),
        ]}
      />
    ) : null}
    {queue ? (
      <FilterMenu
        label="Сортировка"
        valueLabel={params.sort === "updated" ? "по обновлению" : "по сроку"}
        options={[
          { key: "due", label: "По сроку шага", href: studentsListHref(params, { sort: null }), selected: params.sort === "due" },
          { key: "updated", label: "По обновлению", href: studentsListHref(params, { sort: "updated" }), selected: params.sort === "updated" },
        ]}
      />
    ) : null}
  </>;
  // В EVO Docs порядок всегда «по обновлению» и выбором не считается.
  const active = activeFilterCount([params.query, params.direction, params.curator, queue ? params.stage : null, queue && params.sort === "updated" ? "updated" : null]);
  const hidden: Record<string, string | null> = {
    section: params.mode === "docs" ? "docs" : null,
    view: params.view !== params.defaultView ? params.view : null,
    direction: params.direction,
    curator: params.curator,
    stage: queue ? params.stage : null,
    sort: queue && params.sort === "updated" ? "updated" : null,
  };
  return (
    <QueueToolbar
      search={{
        action: "/v3/profile", name: "q", defaultValue: params.query ?? "", placeholder: "Студент или страна",
        label: "Найти студента", hidden,
      }}
      filters={filters}
      activeCount={active}
      resetHref={active ? studentsListHref(params, { query: null, direction: null, curator: null, stage: null, sort: null }) : null}
      keys={queue ? [[["Shift", "Enter"], "открыть дело"]] : []}
    />
  );
}

/** «Счётчики недоступны, список работает. Повторить» — числа не выдумываются. */
export function StudentsCountsUnavailable({ retryHref }: Readonly<{ retryHref: string }>) {
  return (
    <p role="status" className="t-body-compact text-fg-2">
      Счётчики недоступны, список работает. <Link href={retryHref} className="underline underline-offset-4">Повторить</Link>
    </p>
  );
}

/** Адрес не разобран: что не получилось и как вернуться к списку. */
export function StudentsFilterRejected({ resetHref }: Readonly<{ resetHref: string }>) {
  return (
    <div role="alert" data-testid="v3-student-case-filter-rejected" className="space-y-1 border-y border-border py-8">
      <p className="t-item text-danger">Не удалось применить фильтры.</p>
      <p className="t-body-compact text-fg-2">Проверьте адрес или <Link href={resetHref} className="underline underline-offset-4">сбросьте фильтры</Link>.</p>
    </div>
  );
}
