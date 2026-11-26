import Link from "next/link";
import type { MouseEvent } from "react";

import { Icon } from "@/components/icons";
import { BoardColumnCard } from "@/components/staff/board-next/BoardColumnCard";
import { BOARD_EMPTY } from "@/components/staff/board/Board";
import { LeadCardNext } from "@/components/staff/pipeline-next/LeadCardNext";
import { PipelineStageList } from "@/components/staff/pipeline-next/PipelineStageList";
import { COLUMN_STEP, HANDED_VISIBLE_LIMIT, leadDueWord, type StageColumn } from "@/components/staff/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/staff/pipeline-next/types";
import { cn } from "@/lib/utils";

const MORE_LINK = "flex min-h-11 items-center px-1.5 t-item text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Колонка этапа: карточка набора (`BoardColumnCard`) с названием, числом и замком «Есть условия» у этапа с условиями. С фокусом на
 * этапе карточки лежат сеткой (240 px и больше), иначе в колонку шириной с шестую часть страницы. У «Переданных» — последние
 * 20 и «Показать все N» (тот же адрес `?handed=all`, что у прежней доски). Рабочие колонки «Всех этапов» — первые 20 (`columnLimit`),
 * «Показать ещё 20» и «Весь этап · N» — вкладка этапа.
 */
export function PipelineColumn({ column, spread, selectedId, showOwner, today, hrefFor, openLead, handedExpanded, handedHref, onMore, stageHref }: Readonly<{
  column: StageColumn;
  spread: boolean;
  selectedId: string | null;
  showOwner: boolean;
  today: string;
  hrefFor: (lead: PipelineLead) => string;
  openLead: (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => void;
  handedExpanded: boolean;
  handedHref: (expanded: boolean) => string;
  /** Рабочая колонка «Всех этапов»: ещё 20 карточек этого этапа. */
  onMore: () => void;
  /** Вкладка этапа — весь этап одним списком. */
  stageHref: string;
}>) {
  const { stage, inStage, visible } = column;
  const more = stage.terminal && visible.length < inStage.length;
  const less = stage.terminal && handedExpanded && inStage.length > HANDED_VISIBLE_LIMIT;
  const hidden = stage.terminal ? 0 : inStage.length - visible.length;
  // В «Всех этапах» шапки колонок лежат в одной общей строке сетки доски (subgrid, 15.11.2026): название в две строки делает выше все
  // шапки ряда, и списки всех колонок начинаются на одной линии.
  const rows = spread ? undefined : "@[43.75rem]:row-span-2 @[43.75rem]:grid @[43.75rem]:grid-rows-subgrid";
  return (
    <section aria-label={stage.title} data-testid="v3-pipeline-column" data-stage={stage.key} className={cn("min-w-0", rows)}>
      <BoardColumnCard
        className={rows}
        title={stage.title}
        count={inStage.length}
        marker={stage.gate ? <span title="Есть условия" className="inline-flex items-center"><Icon name="lock" size={14} /><span className="sr-only">Есть условия</span></span> : null}
      >
        {/* Вкладка рабочего этапа — список строк (26.11.2026), а не сетка карточек; «Переданы» — прежние карточки. */}
        {spread && !stage.terminal ? (
          <PipelineStageList leads={inStage} selectedId={selectedId} showOwner={showOwner} today={today} hrefFor={hrefFor} openLead={openLead} />
        ) : (
        <ul className={`flex flex-col gap-1.5 ${spread ? "@[43.75rem]:grid @[43.75rem]:grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] @[43.75rem]:content-start" : ""}`}>
          {visible.map((lead) => (
            <li key={lead.id}>
              <LeadCardNext lead={lead} terminal={stage.terminal} selected={lead.id === selectedId} showOwner={showOwner}
                href={hrefFor(lead)} onOpen={openLead(lead)} dueWord={leadDueWord(lead, today)} />
            </li>
          ))}
          {inStage.length === 0 ? <li className="t-meta px-1.5 py-1 text-fg-3">{BOARD_EMPTY.leads}</li> : null}
          {more ? <li className="col-span-full"><Link href={handedHref(true)} prefetch={false} scroll={false} className={MORE_LINK}>Показать все {inStage.length}</Link></li> : null}
          {less ? <li className="col-span-full"><Link href={handedHref(false)} prefetch={false} scroll={false} className={MORE_LINK}>Показать последние {HANDED_VISIBLE_LIMIT}</Link></li> : null}
          {hidden > 0 ? (
            <li className="col-span-full grid gap-0.5 pt-1" data-testid="v3-pipeline-column-more">
              <button type="button" onClick={onMore} className={cn(MORE_LINK, "w-full rounded-ctl border border-border bg-surface justify-center no-underline hover:bg-surface-2")}>
                Показать ещё {Math.min(COLUMN_STEP, hidden)}<span className="sr-only"> — {stage.title}</span>
              </button>
              <Link href={stageHref} prefetch={false} scroll={false} className={cn(MORE_LINK, "justify-center")}>Весь этап · {inStage.length}</Link>
            </li>
          ) : null}
        </ul>
        )}
      </BoardColumnCard>
    </section>
  );
}
