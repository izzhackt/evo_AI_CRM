"use client";

import { StatusBadge } from "@/components/kit";
import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import { DueWord } from "../blocks/DueWord";
import type { UniversityListRow } from "./university-list-types";

/** Университет: фото 48 px, название-ссылка на карточку (область — вся ячейка), город и пометки. */
export function UniversityCell({ row }: Readonly<{ row: UniversityListRow }>) {
  return (
    <div data-university-row={row.id} className="relative z-0 flex min-w-0 items-center gap-3 py-0.5">
      {row.thumb}
      <div className="min-w-0">
        <IntentPrefetchLink href={`/v3/universities/${row.id}`} data-queue-open="" title={row.name}
          className="line-clamp-2 break-words t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline hover:underline-offset-4">{row.name}</IntentPrefetchLink>
        <span className="block truncate t-meta text-fg-2">{[row.country, row.city].filter(Boolean).join(" · ")}</span>
        {row.staleOn ? <span className="block t-meta text-warn">Проверено <time dateTime={row.staleOn} className="font-mono tabular-nums">{row.staleOn}</time></span> : null}
        {/* 282: страны вне единого списка (PL, CY и др.) остаются у сотрудников, студенты их не видят. */}
        {row.hidden ? <span className="mt-1 block"><StatusBadge label="Не показывается студентам" /></span> : null}
      </div>
    </div>
  );
}

/** Ближайший подтверждённый срок подачи: дата и слово, под ними программа; нет подтверждённого — так и сказано. */
export function DeadlineCell({ row }: Readonly<{ row: UniversityListRow }>) {
  const deadline = row.deadline;
  if (!deadline) return <span className="t-body-compact text-fg-3" data-deadline="none">Срок не подтверждён</span>;
  const more = deadline.sameDateCount > 0 ? ` · ещё наборов с этой датой: ${deadline.sameDateCount}` : "";
  return (
    <span className="block min-w-0 text-start" data-deadline={deadline.dateTime}>
      <span className="flex flex-wrap items-baseline gap-x-1.5 t-body-compact">
        <time dateTime={deadline.dateTime} className="font-mono tabular-nums text-fg" title={`Срок в поясе ${deadline.zone}, проверен ${deadline.verifiedOn.split("-").reverse().join(".")}`}>{deadline.text}</time>
        <DueWord view={deadline.word} className="text-fg-2" />
      </span>
      <span className="block truncate t-meta text-fg-2" title={`${deadline.program} — ${deadline.intake}${more}`}>{deadline.program}{more}</span>
    </span>
  );
}
