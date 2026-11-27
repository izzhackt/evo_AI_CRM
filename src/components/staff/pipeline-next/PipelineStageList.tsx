"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent } from "react";

import { DueWord } from "@/components/staff/blocks/DueWord";
import { LeadTestBadge } from "@/components/staff/LeadTestBadge";
import { leadDueWord, leadLabel } from "@/components/staff/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/staff/pipeline-next/types";

/** Сколько строк этапа видно сразу и сколько добавляет «Показать ещё». */
export const STAGE_LIST_STEP = 50;
/** От 43.75rem рамки списка — столбцы; уже (телефон) — те же данные стопкой, ничего не скрыто. Столбца ответственного нет, когда `showOwner` выключен. */
const GRID = "@[43.75rem]:grid @[43.75rem]:items-center @[43.75rem]:gap-4";
const COLUMNS = {
  withOwner: "@[43.75rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)]",
  withoutOwner: "@[43.75rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)]",
} as const;

/**
 * Этап одним списком (26.11.2026: вкладка этапа рисовала сетку из сотен одинаковых карточек «Номер … / Без действия»). Строка показывает
 * то же, что карточка доски, и не больше: лид, следующее действие со сроком словом и ответственного (полным именем, «Не назначен», пока
 * его нет; при фильтре «Мои» `showOwner` выключен — ответственного нет ни здесь, ни на карточке). Источника и «на этапе N дн» в строке нет:
 * возраст этапа — только в панели лида (решение владельца 15.11.2026, подтверждено 27.11.2026). На компьютере — столбцы, на телефоне те же
 * данные тремя короткими строками: имя, действие со сроком, ответственный. Нажимается вся строка (ссылка растянута), открывается та же
 * панель лида. Первые 50, «Показать ещё 50» — фокус на первую новую.
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
  const grid = `${GRID} ${showOwner ? COLUMNS.withOwner : COLUMNS.withoutOwner}`;
  const more = () => {
    setShown(limit + STAGE_LIST_STEP);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("a[data-lead-link]")[limit]?.focus());
  };
  return (
    <div className="@container min-w-0" data-testid="v3-pipeline-stage-list">
      <div aria-hidden="true" className={`hidden px-3 pb-2 t-meta text-fg-3 ${grid}`}>
        <span>Лид</span><span>Следующее действие</span>{showOwner ? <span>Ответственный</span> : null}
      </div>
      <ul ref={listRef} className="divide-y divide-border rounded-ctl border border-border bg-surface">
        {visible.map((lead) => {
          const word = leadDueWord(lead, today);
          const owner = lead.workflow.currentOwnerDisplayName;
          return (
            <li key={lead.id} data-testid="v3-pipeline-row" data-lead-id={lead.id} aria-current={lead.id === selectedId ? "true" : undefined}
              className={`relative grid min-h-12 gap-0.5 px-3 py-2 hover:bg-surface-2 aria-[current=true]:bg-surface-2 ${grid}`}>
              <Link href={hrefFor(lead)} prefetch={false} scroll={false} onClick={openLead(lead)} data-lead-link={lead.id}
                className="t-item line-clamp-2 min-w-0 break-words text-fg after:absolute after:inset-0" title={leadLabel(lead)}>
                {leadLabel(lead)}
                {lead.isTest ? <LeadTestBadge className="ml-1.5 align-middle" /> : null}
              </Link>
              <span className="flex min-w-0 items-baseline gap-2 t-body-compact">
                <span className={`min-w-0 truncate ${lead.nextAction ? "text-fg-2" : "text-fg-3"}`} title={lead.nextAction ?? undefined}>
                  <span className="sr-only">Следующее действие: </span>{lead.nextAction ?? "Без действия"}
                </span>
                {word ? <span className="shrink-0"><DueWord view={word} /></span> : null}
              </span>
              {showOwner ? <span className="min-w-0 truncate t-meta text-fg-2"><span className="sr-only">Ответственный: </span>{owner ?? "Не назначен"}</span> : null}
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
