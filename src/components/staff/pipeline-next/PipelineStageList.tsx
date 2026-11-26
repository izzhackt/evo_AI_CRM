"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent } from "react";

import { DueWord } from "@/components/staff/blocks/DueWord";
import { leadDueWord, leadLabel } from "@/components/staff/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/staff/pipeline-next/types";
import { plural } from "@/components/staff/queue/bulk-run";
import { source as sourceWord } from "@/lib/v3/wording";

/** Сколько строк этапа видно сразу и сколько добавляет «Показать ещё». */
export const STAGE_LIST_STEP = 50;
/** Источник словом из `wording.ts` с заглавной: в столбце это подпись, а не часть фразы. */
const sourceLabel = (key: string) => { const word = sourceWord(key); return word ? word[0].toUpperCase() + word.slice(1) : "—"; };
const GRID = "@[43.75rem]:grid @[43.75rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_7rem_6rem] @[43.75rem]:items-center @[43.75rem]:gap-4";

/**
 * Этап одним списком (26.11.2026: вкладка этапа рисовала сетку из сотен одинаковых карточек «Номер … / Без действия»). Строка — лид,
 * следующее действие со сроком словом, ответственный, источник и сколько дней на этапе; на телефоне — те же данные в две строки.
 * Нажимается вся строка (ссылка растянута), открывается та же панель лида. Первые 50, «Показать ещё 50» — фокус на первую новую.
 */
export function PipelineStageList({ leads, selectedId, showOwner, today, hrefFor, openLead }: Readonly<{
  leads: readonly PipelineLead[];
  selectedId: string | null;
  showOwner: boolean;
  today: string;
  hrefFor: (lead: PipelineLead) => string;
  openLead: (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => void;
}>) {
  const listRef = useRef<HTMLUListElement>(null);
  const selectedAt = selectedId === null ? -1 : leads.findIndex((lead) => lead.id === selectedId);
  const [shown, setShown] = useState(STAGE_LIST_STEP);
  const limit = Math.max(shown, selectedAt + 1);
  const visible = leads.slice(0, limit);
  const hidden = leads.length - visible.length;
  const more = () => {
    setShown(limit + STAGE_LIST_STEP);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("a[data-lead-link]")[limit]?.focus());
  };
  return (
    <div className="@container min-w-0" data-testid="v3-pipeline-stage-list">
      <div aria-hidden="true" className={`hidden px-3 pb-2 t-meta text-fg-3 ${GRID}`}>
        <span>Лид</span><span>Следующее действие</span><span>{showOwner ? "Ответственный" : ""}</span><span>Источник</span><span className="text-end">На этапе</span>
      </div>
      <ul ref={listRef} className="divide-y divide-border rounded-ctl border border-border bg-surface">
        {visible.map((lead) => {
          const word = leadDueWord(lead, today);
          const owner = lead.workflow.currentOwnerDisplayName;
          const days = lead.stageAgeDays;
          return (
            <li key={lead.id} data-testid="v3-pipeline-row" data-lead-id={lead.id} aria-current={lead.id === selectedId ? "true" : undefined}
              className={`relative grid min-h-12 gap-0.5 px-3 py-2 hover:bg-surface-2 aria-[current=true]:bg-surface-2 ${GRID}`}>
              <Link href={hrefFor(lead)} prefetch={false} scroll={false} onClick={openLead(lead)} data-lead-link={lead.id}
                className="t-item min-w-0 truncate text-fg after:absolute after:inset-0" title={leadLabel(lead)}>
                {leadLabel(lead)}
              </Link>
              <span className="flex min-w-0 items-baseline gap-2 t-body-compact">
                <span className={`min-w-0 truncate ${lead.nextAction ? "text-fg-2" : "text-fg-3"}`} title={lead.nextAction ?? undefined}>
                  <span className="sr-only">Следующее действие: </span>{lead.nextAction ?? "Без действия"}
                </span>
                {word ? <span className="shrink-0"><DueWord view={word} /></span> : null}
              </span>
              {/* Телефон: источник и дни на этапе — одной строкой под действием (столбцов нет). */}
              <span aria-hidden="true" className="t-meta text-fg-3 @[43.75rem]:hidden">{sourceLabel(lead.source)}{days === null ? "" : ` · ${days} ${plural(days, { one: "день", few: "дня", many: "дней" })} на этапе`}</span>
              <span className="min-w-0 truncate t-meta text-fg-2 @max-[43.75rem]:hidden">
                {showOwner ? <><span className="sr-only">Ответственный: </span>{owner ?? "Не назначен"}</> : null}
              </span>
              <span className="t-meta text-fg-2 @max-[43.75rem]:hidden"><span className="sr-only">Источник: </span>{sourceLabel(lead.source)}</span>
              <span className="t-meta tabular-nums text-fg-2 @[43.75rem]:text-end @max-[43.75rem]:hidden">
                {days === null ? "—" : <><span className="sr-only">На этапе: </span>{days} {plural(days, { one: "день", few: "дня", many: "дней" })}</>}
              </span>
            </li>
          );
        })}
        {leads.length === 0 ? <li className="px-3 py-3 t-meta text-fg-3">Нет лидов</li> : null}
      </ul>
      {hidden > 0 ? (
        <button type="button" onClick={more} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-ctl border border-border bg-surface t-item text-fg-2 hover:bg-surface-2 hover:text-fg">
          Показать ещё {Math.min(STAGE_LIST_STEP, hidden)} из {hidden}
        </button>
      ) : null}
    </div>
  );
}
