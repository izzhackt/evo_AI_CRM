import { useDroppable } from "@dnd-kit/core";

import { AdmissionsCardNext } from "@/components/v3/admissions-pipeline-next/AdmissionsCardNext";
import type { MoveTarget } from "@/components/v3/admissions-board/board-model";
import { BoardColumnCard } from "@/components/v3/board-next/BoardColumnCard";
import { BOARD_EMPTY } from "@/components/v3/board/Board";
import { cn } from "@/lib/utils";
import type { AdmissionsPipelineRow, AdmissionsPipelineStage, AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { admissionsPipelineStage } from "@/lib/v3/wording";

/**
 * Колонка этапа: карточка набора (`BoardColumnCard`), в которую можно бросить дело (`useDroppable`). На телефоне виден один этап, названный выбором
 * «Этап» над списком, — заголовок колонки там повторял бы его и скрыт.
 */
export function AdmissionsColumnNext({ stage, rows, tab, showCurator, visibleNarrow, onMove }: Readonly<{
  stage: AdmissionsPipelineStage;
  rows: readonly AdmissionsPipelineRow[];
  tab: AdmissionsPipelineTab;
  showCurator: boolean;
  visibleNarrow: boolean;
  onMove: (studentCaseId: string, target: MoveTarget) => void;
}>) {
  const title = admissionsPipelineStage(stage) ?? stage;
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { title } });
  return (
    <section ref={setNodeRef} aria-label={title} data-testid="v3-admissions-pipeline-column" data-stage={stage}
      className={cn("min-w-0 rounded-card", visibleNarrow ? "block" : "hidden @5xl:block", isOver && "outline-2 -outline-offset-2 outline-dashed outline-control-edge")}>
      <BoardColumnCard title={title} count={rows.length} className={cn(isOver && "bg-surface-2")} headerClassName="@max-5xl:hidden">
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.studentCaseId}>
              <AdmissionsCardNext row={row} tab={tab} showCurator={showCurator} onMove={(target) => onMove(row.studentCaseId, target)} />
            </li>
          ))}
          {rows.length === 0 ? <li className="t-meta px-1.5 py-1 text-fg-3">{BOARD_EMPTY.cases}</li> : null}
        </ul>
      </BoardColumnCard>
    </section>
  );
}
