import Link from "next/link";
import { useEffect, useRef } from "react";

import { KeyFacts } from "@/components/kit";
import { DueWord } from "@/components/v3/blocks/DueWord";
import { StageTrack } from "@/components/v3/blocks/StageTrack";
import { PipelineDecisionForm } from "@/components/v3/PipelineDecisionForm";
import { leadDueWord } from "@/components/v3/pipeline-next/pipeline-next-model";
import type { PipelineLead } from "@/components/v3/pipeline-next/types";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { PlatformSalesOwnerOption, PlatformSalesStage } from "@/lib/platform-sales-contract";

const NOTE_TIME = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" });

/**
 * Тело панели лида нового вида: дорожка этапа, три факта (действие, срок, возраст этапа), последняя заметка и прежняя форма
 * решения (`PipelineDecisionForm`: поля, проверка, действие и версия те же). Права — подсказка кнопкам, решает сервер.
 */
export function LeadSheetBody({ lead, today, terminal, workflowStages, ownerOptions, ownerOptionsHaveMore, actor, actorMembershipId, requestId, saved, onSaved }: Readonly<{
  lead: PipelineLead;
  today: string;
  terminal: boolean;
  workflowStages: readonly Readonly<{ key: PlatformSalesStage; title: string }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestId: string;
  saved: boolean;
  onSaved: () => void;
}>) {
  const savedRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (saved) savedRef.current?.scrollIntoView({ block: "nearest" });
  }, [saved]);
  const real = !isStaffPreview(actor);
  const dueDate = lead.nextActionAt && lead.workflow.nextActionDueDate ? lead.workflow.nextActionDueDate : null;
  return (
    <div className="grid gap-4">
      <StageTrack kind="sales" current={lead.stageKey} caption={false} />
      <KeyFacts columns={2} facts={[
        { label: "Действие", value: lead.nextAction ?? <span className="text-fg-3">Без следующего действия</span> },
        { label: "Срок", value: dueDate ? <><time dateTime={dueDate} className="font-mono tabular-nums">{lead.nextActionAt}</time>{" "}{terminal ? null : <DueWord view={leadDueWord(lead, today)} />}</> : null },
        { label: "На этапе", value: !terminal && lead.stageAgeDays !== null ? `${lead.stageAgeDays} дн` : null },
      ]} />
      {real && staffHasPermission(actor, "staff.task.read") ? (
        <Link href={`/v3/tasks?lead=${lead.workflow.leadId}&create=staff`} prefetch={false} className="t-item inline-flex min-h-11 w-fit items-center text-fg-2 underline underline-offset-4 hover:text-fg">
          Задача по лиду
        </Link>
      ) : null}
      {lead.latestNote ? (
        <section aria-label="Последняя заметка" className="border-t border-border pt-3">
          <h3 className="t-caption text-fg-3">Последняя заметка</h3>
          <p className="t-body-compact mt-1 line-clamp-6 whitespace-pre-wrap break-words text-fg-2">{lead.latestNote.body}</p>
          <p className="t-meta mt-1 truncate text-fg-3">
            {lead.latestNote.authorDisplayName}{" · "}
            <time dateTime={lead.latestNote.createdAt} className="font-mono tabular-nums">{NOTE_TIME.format(new Date(lead.latestNote.createdAt))}</time>
          </p>
        </section>
      ) : null}
      {!terminal && real && staffHasPermission(actor, "lead.sales.workflow.manage") ? (
        <div className="border-t border-border pt-3">
          <PipelineDecisionForm key={`${lead.workflow.leadId}:${lead.workflow.workflowVersion}`} lead={lead.workflow} stages={workflowStages}
            ownerOptions={ownerOptions} ownerOptionsHaveMore={ownerOptionsHaveMore} actor={actor} actorMembershipId={actorMembershipId}
            requestId={requestId} onSaved={onSaved} />
          {saved ? <p ref={savedRef} role="status" className="t-body-compact mt-2 text-ok">Решение сохранено.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
