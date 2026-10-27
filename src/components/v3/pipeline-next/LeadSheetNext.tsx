import Link from "next/link";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { CloseRecordMenu } from "@/components/v3/closure/Closure";
import { LeadSheetBody } from "@/components/v3/pipeline-next/LeadSheetBody";
import { leadLabel } from "@/components/v3/pipeline-next/pipeline-next-model";
import type { PipelineLead, PipelineStage } from "@/components/v3/pipeline-next/types";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { LeadClosureReceipt } from "@/lib/platform-closure-contract";
import type { PlatformSalesOwnerOption, PlatformSalesStage } from "@/lib/platform-sales-contract";
import { closureWords } from "@/lib/v3/wording";
import { withPipelineReturn } from "@/lib/v3/pipeline-return";

type Props = Readonly<{
  lead: PipelineLead;
  open: boolean;
  today: string;
  stage: PipelineStage | undefined;
  workflowStages: readonly Readonly<{ key: PlatformSalesStage; title: string }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestId: string;
  returnTo: string;
  saved: boolean;
  onClose: () => void;
  onSaved: () => void;
  onLeadClosed: (receipt: LeadClosureReceipt) => void;
  onCloseAutoFocus: (event: Event) => void;
}>;

/**
 * Лид в панели `DetailSheet` вместо боковой панели прежней доски: открывается нажатием на карточку (адрес `?lead=` меняется без
 * запроса к серверу), «Открыть карточку лида» и «⋯ → Закрыть лид» — в подвале панели. Закрытие лида — прежняя команда (246).
 */
export function LeadSheetNext({ lead, open, today, stage, onClose, onLeadClosed, onCloseAutoFocus, returnTo, ...body }: Props) {
  const terminal = stage?.terminal ?? false;
  const owner = lead.workflow.currentOwnerDisplayName;
  const canClose = !isStaffPreview(body.actor) && staffHasPermission(body.actor, "lead.sales.workflow.manage");
  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={leadLabel(lead)}
      description={`${stage?.title ?? ""} · ${owner ? `Ответственный: ${owner}` : "Ответственный не назначен"}`}
      footer={
        <>
          <Button variant="outline" asChild>
            <Link href={withPipelineReturn(lead.href, returnTo)} prefetch={false}>Открыть карточку лида</Link>
          </Button>
          {canClose ? (
            <CloseRecordMenu kind="lead" subjectId={lead.workflow.leadId} subjectName={leadLabel(lead)} expectedVersion={lead.workflow.workflowVersion}
              blockedReason={terminal ? closureWords.lead.handedOff : null} onClosed={onLeadClosed} />
          ) : null}
        </>
      }
    >
      <LeadSheetBody lead={lead} today={today} terminal={terminal} {...body} />
    </DetailSheet>
  );
}
