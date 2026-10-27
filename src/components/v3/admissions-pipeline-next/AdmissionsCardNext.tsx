import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";

import { StatusBadge } from "@/components/kit";
import { AdmissionsCardMenu } from "@/components/v3/admissions-board/AdmissionsCardMenu";
import { caseHref, type MoveTarget } from "@/components/v3/admissions-board/board-model";
import { Initials } from "@/components/v3/blocks/Initials";
import { BOARD_CARD_CLASS } from "@/components/v3/board/Board";
import { cn } from "@/lib/utils";
import type { AdmissionsPipelineRow, AdmissionsPipelineTab } from "@/lib/platform-admissions-pipeline-contract";
import { caseChatAwaitState, country as countryLabel } from "@/lib/v3/wording";

/**
 * Содержимое карточки дела: имя ведёт в дело (ссылка растянута на всю карточку), вторая строка — страна · университет и круг куратора (когда кураторов несколько),
 * третья — состояния словом (просрочено, нужен ответ — ссылка на переписку, ждёт принятия). Одно и то же в доске и в «поднятой»
 * карточке перетаскивания.
 */
export function AdmissionsCardBody({ row, showCurator }: Readonly<{ row: AdmissionsPipelineRow; showCurator: boolean }>) {
  const secondLine = [countryLabel(row.targetCountry), row.primaryInstitutionName].filter((value): value is string => Boolean(value)).join(" · ");
  const curator = showCurator ? row.currentCuratorDisplayName : null;
  const replyWord = caseChatAwaitState("needs_reply")?.toLocaleLowerCase("ru-RU") ?? "";
  const marks = [
    row.overdue ? <StatusBadge key="overdue" label="просрочено" tone="danger" /> : null,
    row.needsReply ? (
      <Link key="reply" href={`/v3/messages?case=${row.studentCaseId}`} prefetch={false} draggable={false} className="v3-chip-link relative inline-flex">
        <StatusBadge label={replyWord} tone="warn" />
      </Link>
    ) : null,
    row.awaitingAck ? <StatusBadge key="ack" label="ждёт принятия" tone="warn" /> : null,
  ].filter((mark) => mark !== null);
  return (
    <>
      <p className="flex min-w-0 pe-10">
        <Link href={caseHref(row.studentCaseId)} prefetch={false} draggable={false} title={row.studentDisplayName}
          className="t-item line-clamp-2 block min-w-0 break-words text-fg after:absolute after:inset-0 after:rounded-ctl hover:underline hover:underline-offset-4">
          {row.studentDisplayName}
        </Link>
      </p>
      {secondLine || curator ? (
        <p className="t-meta flex min-w-0 items-baseline gap-2 pe-8 text-fg-3">
          <span className="min-w-0 flex-1 truncate text-fg-2" title={secondLine || undefined}>{secondLine}</span>
          {curator ? <Initials name={curator} size="sm" /> : null}
        </p>
      ) : null}
      {marks.length > 0 ? <p className="flex flex-wrap gap-1 py-px">{marks}</p> : null}
    </>
  );
}

/**
 * Карточка дела на доске поступления нового вида. Двигается перетаскиванием мышью и пальцем (`@dnd-kit/core`, без перестановки
 * внутри колонки: порядок задаёт сервер) и всегда — меню «⋯ → Переместить в…» (клавиатура и телефон, как у прежней доски).
 */
export function AdmissionsCardNext({ row, tab, showCurator, onMove }: Readonly<{
  row: AdmissionsPipelineRow;
  tab: AdmissionsPipelineTab;
  showCurator: boolean;
  onMove: (target: MoveTarget) => void;
}>) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: row.studentCaseId, data: { name: row.studentDisplayName } });
  return (
    <article ref={setNodeRef} {...listeners} data-testid="v3-admissions-pipeline-card" data-student-case-id={row.studentCaseId}
      className={cn(BOARD_CARD_CLASS, "cursor-grab touch-manipulation active:cursor-grabbing", isDragging && "opacity-40")}>
      <AdmissionsCardBody row={row} showCurator={showCurator} />
      <div className="absolute end-0.5 top-0.5">
        <AdmissionsCardMenu row={row} tab={tab} onMove={onMove} />
      </div>
    </article>
  );
}
