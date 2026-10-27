import Link from "next/link";
import type { MouseEvent } from "react";

import { DueWord } from "@/components/v3/blocks/DueWord";
import { Initials } from "@/components/v3/blocks/Initials";
import { BOARD_CARD_CLASS } from "@/components/v3/board/Board";
import type { DueWordView } from "@/components/v3/queue/due-bucket";
import { leadLabel, stageAgeCopy } from "@/components/v3/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/v3/pipeline-next/types";

/**
 * Карточка лида на доске нового вида. Четыре данных: имя, следующее действие, срок словом и ответственный (инициалы; возраст
 * этапа — тихой строкой). Нажимается вся карточка: ссылка растянута на неё. Те же `data-testid` и `data-lead-*`, что у прежней
 * карточки: на них опираются возврат фокуса, переходы из «Сегодня» и стенды.
 */
export function LeadCardNext({ lead, terminal, selected, showOwner, href, onOpen, dueWord }: Readonly<{
  lead: PipelineLead;
  terminal: boolean;
  selected: boolean;
  showOwner: boolean;
  href: string;
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
  dueWord: DueWordView | null;
}>) {
  const owner = lead.workflow.currentOwnerDisplayName;
  const age = terminal ? null : lead.stageAgeDays;
  const word = terminal ? null : dueWord;
  const showAction = !(terminal && !lead.nextAction);
  const initials = showOwner && owner ? <Initials name={owner} size="sm" /> : null;
  return (
    <article
      data-testid="v3-pipeline-card"
      data-lead-id={lead.id}
      aria-current={selected ? "true" : undefined}
      className={`${BOARD_CARD_CLASS} aria-[current=true]:border-control-edge aria-[current=true]:bg-surface-2`}
    >
      <p className="flex min-w-0 items-baseline gap-2">
        <Link
          href={href}
          prefetch={false}
          scroll={false}
          onClick={onOpen}
          title={leadLabel(lead)}
          data-lead-link={lead.id}
          className="t-item line-clamp-2 min-w-0 flex-1 break-words text-fg after:absolute after:inset-0 after:rounded-ctl"
        >
          {leadLabel(lead)}
        </Link>
        {showAction ? null : initials}
      </p>
      {showAction ? (
        <p className="t-meta flex min-w-0 items-baseline gap-2 text-fg-3">
          <span className={`min-w-0 flex-1 truncate ${lead.nextAction ? "text-fg-2" : ""}`} title={lead.nextAction ?? undefined}>
            {lead.nextAction ?? "Без действия"}
          </span>
          {initials}
        </p>
      ) : null}
      {word || age !== null ? (
        <p className="t-meta flex flex-wrap items-baseline gap-x-2 text-fg-3">
          <DueWord view={word} />
          {age !== null ? <span>{stageAgeCopy(age)}</span> : null}
        </p>
      ) : null}
    </article>
  );
}
