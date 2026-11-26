import { useDroppable } from "@dnd-kit/core";
import { useRef, useState } from "react";

import { AdmissionsCardNext } from "@/components/staff/admissions-pipeline-next/AdmissionsCardNext";
import type { MoveTarget } from "@/components/staff/admissions-board/board-model";
import { BoardColumnCard } from "@/components/staff/board-next/BoardColumnCard";
import { BOARD_EMPTY } from "@/components/staff/board/Board";
import { cn } from "@/lib/utils";
import type { AdmissionsPipelineRow, AdmissionsPipelineStage, AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

const COLUMN_STEP = 20;

/**
 * Колонка этапа: карточка набора (`BoardColumnCard`), в которую можно бросить дело (`useDroppable`). На телефоне виден один этап, названный выбором
 * «Этап» над списком, — заголовок колонки там повторял бы его и скрыт.
 */
export function AdmissionsColumnNext({ stage, rows, tab, showCurator, visibleNarrow, returnTo, onMove }: Readonly<{
  stage: AdmissionsPipelineStage;
  rows: readonly AdmissionsPipelineRow[];
  tab: AdmissionsPipelineTab;
  showCurator: boolean;
  visibleNarrow: boolean;
  returnTo: string;
  onMove: (studentCaseId: string, target: MoveTarget) => void;
}>) {
  const title = admissionsPipelineStage(stage) ?? stage;
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { title } });
  // 26.11.2026: длинная колонка («Документы» — 66 дел) показывает первые 20, «Показать ещё» прибавляет по 20 и ставит фокус на первое
  // новое дело; хвост в пару дел показывается сразу. Перетащить можно и в свёрнутую колонку — бросают на колонку, а не на место в ней.
  const listRef = useRef<HTMLUListElement>(null);
  const [shown, setShown] = useState(COLUMN_STEP);
  const limit = rows.length - shown <= 2 ? rows.length : shown;
  const hidden = rows.length - limit;
  const more = () => {
    setShown(limit + COLUMN_STEP);
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("li > article a[href^='/profile']")[limit]?.focus());
  };
  return (
    <section ref={setNodeRef} aria-label={title} data-testid="v3-admissions-pipeline-column" data-stage={stage}
      className={cn("min-w-0 rounded-card", visibleNarrow ? "block" : "hidden @[43.75rem]:block", isOver && "outline-2 -outline-offset-2 outline-dashed outline-control-edge")}>
      <BoardColumnCard title={title} count={rows.length} className={cn(isOver && "bg-surface-2")} headerClassName="@max-[43.75rem]:hidden">
        <ul ref={listRef} className="flex flex-col gap-1.5">
          {rows.slice(0, limit).map((row) => (
            <li key={row.studentCaseId}>
              <AdmissionsCardNext row={row} tab={tab} showCurator={showCurator} returnTo={returnTo} onMove={(target) => onMove(row.studentCaseId, target)} />
            </li>
          ))}
          {rows.length === 0 ? <li className="t-meta px-1.5 py-1 text-fg-3">{BOARD_EMPTY.cases}</li> : null}
        </ul>
        {hidden > 0 ? (
          <button type="button" onClick={more} data-testid="v3-admissions-column-more"
            className="mt-1.5 flex min-h-11 w-full items-center justify-center rounded-ctl border border-border bg-surface t-item text-fg-2 hover:bg-surface-2 hover:text-fg">
            Показать ещё {Math.min(COLUMN_STEP, hidden)}<span className="sr-only"> — {title}, скрыто {hidden}</span>
          </button>
        ) : null}
      </BoardColumnCard>
    </section>
  );
}
