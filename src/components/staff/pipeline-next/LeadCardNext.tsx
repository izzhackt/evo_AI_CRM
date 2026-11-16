import Link from "next/link";
import type { MouseEvent } from "react";

import { DueWord } from "@/components/staff/blocks/DueWord";
import { Initials } from "@/components/staff/blocks/Initials";
import { BOARD_CARD_CLASS } from "@/components/staff/board/Board";
import type { DueWordView } from "@/components/staff/queue/due-bucket";
import { leadLabel } from "@/components/staff/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/staff/pipeline-next/types";

/**
 * Карточка лида на доске нового вида. Четыре данных: имя, срок словом в правом верхнем углу, следующее действие и ответственный
 * (инициалы) в правом нижнем. 15.11.2026 (карточки были перегружены, списки колонок начинались на разной высоте;
 * срок — в правый верхний угол, инициалы — в правый нижний, и в узкой колонке тоже): имя — до двух строк, а не одна (в одну строку в узкой колонке резались
 * фамилии и последние цифры, по которым различаются лиды звонков — ревью 15.11), возраст этапа —
 * только в панели лида («На этапе»). Нажимается вся карточка: ссылка растянута на неё. Те же `data-testid` и `data-lead-*`, что у
 * прежней карточки: на них опираются возврат фокуса, переходы из «Сегодня» и стенды.
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
  const word = terminal ? null : dueWord;
  const showAction = !(terminal && !lead.nextAction);
  const initials = showOwner && owner ? <Initials name={owner} size="sm" /> : null;
  return (
    <article
      data-testid="v3-pipeline-card"
      data-lead-id={lead.id}
      aria-current={selected ? "true" : undefined}
      className={`${BOARD_CARD_CLASS} @container aria-[current=true]:border-control-edge aria-[current=true]:bg-surface-2`}
    >
      {/* Широкая карточка (от 12rem: телефон, фокус на этапе, широкий экран): срок в одной строке с именем, справа. Узкая (шесть
          колонок на ноутбуке): срок уголком над именем, а имя — во всю ширину под ним, иначе от него осталось бы «Айжа…». */}
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 @[12rem]:flex-nowrap">
        <Link
          href={href}
          prefetch={false}
          scroll={false}
          onClick={onOpen}
          title={leadLabel(lead)}
          data-lead-link={lead.id}
          className={`t-item line-clamp-2 min-w-0 flex-1 break-words text-fg after:absolute after:inset-0 after:rounded-ctl ${word ? "basis-full @[12rem]:basis-auto" : ""}`}
        >
          {leadLabel(lead)}
        </Link>
        {word ? (
          <span className="order-first flex shrink-0 basis-full justify-end @[12rem]:order-none @[12rem]:basis-auto">
            <DueWord view={word} />
          </span>
        ) : null}
        {showAction ? null : initials}
      </p>
      {showAction ? (
        <p className="t-meta flex min-w-0 items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate ${lead.nextAction ? "text-fg-2" : "text-fg-3"}`} title={lead.nextAction ?? undefined}>
            {lead.nextAction ?? "Без действия"}
          </span>
          {initials}
        </p>
      ) : null}
    </article>
  );
}
