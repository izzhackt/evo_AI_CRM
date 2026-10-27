import Link from "next/link";
import type { MouseEvent } from "react";

import { Icon } from "@/components/icons";
import { BoardColumnCard } from "@/components/v3/board-next/BoardColumnCard";
import { BOARD_EMPTY } from "@/components/v3/board/Board";
import { LeadCardNext } from "@/components/v3/pipeline-next/LeadCardNext";
import { HANDED_VISIBLE_LIMIT, leadDueWord, type StageColumn } from "@/components/v3/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/v3/pipeline-next/types";

const MORE_LINK = "flex min-h-11 items-center px-1.5 t-item text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Колонка этапа: карточка набора (`BoardColumnCard`) с названием, числом и замком «Есть условия» у этапа с условиями. С фокусом на
 * этапе карточки лежат сеткой (240 px и больше), иначе в колонку шириной с шестую часть страницы. У «Переданных» — последние
 * 20 и «Показать все N» (тот же адрес `?handed=all`, что у прежней доски).
 */
export function PipelineColumn({ column, spread, selectedId, showOwner, today, hrefFor, openLead, handedExpanded, handedHref }: Readonly<{
  column: StageColumn;
  spread: boolean;
  selectedId: string | null;
  showOwner: boolean;
  today: string;
  hrefFor: (lead: PipelineLead) => string;
  openLead: (lead: PipelineLead) => (event: MouseEvent<HTMLAnchorElement>) => void;
  handedExpanded: boolean;
  handedHref: (expanded: boolean) => string;
}>) {
  const { stage, inStage, visible } = column;
  const more = stage.terminal && visible.length < inStage.length;
  const less = stage.terminal && handedExpanded && inStage.length > HANDED_VISIBLE_LIMIT;
  return (
    <section aria-label={stage.title} data-testid="v3-pipeline-column" data-stage={stage.key} className="min-w-0">
      <BoardColumnCard
        title={stage.title}
        count={inStage.length}
        marker={stage.gate ? <span title="Есть условия" className="inline-flex items-center"><Icon name="lock" size={14} /><span className="sr-only">Есть условия</span></span> : null}
      >
        <ul className={`flex flex-col gap-1.5 ${spread ? "@6xl:grid @6xl:grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] @6xl:content-start" : ""}`}>
          {visible.map((lead) => (
            <li key={lead.id}>
              <LeadCardNext lead={lead} terminal={stage.terminal} selected={lead.id === selectedId} showOwner={showOwner}
                href={hrefFor(lead)} onOpen={openLead(lead)} dueWord={leadDueWord(lead, today)} />
            </li>
          ))}
          {inStage.length === 0 ? <li className="t-meta px-1.5 py-1 text-fg-3">{BOARD_EMPTY.leads}</li> : null}
          {more ? <li className="col-span-full"><Link href={handedHref(true)} prefetch={false} scroll={false} className={MORE_LINK}>Показать все {inStage.length}</Link></li> : null}
          {less ? <li className="col-span-full"><Link href={handedHref(false)} prefetch={false} scroll={false} className={MORE_LINK}>Показать последние {HANDED_VISIBLE_LIMIT}</Link></li> : null}
        </ul>
      </BoardColumnCard>
    </section>
  );
}
