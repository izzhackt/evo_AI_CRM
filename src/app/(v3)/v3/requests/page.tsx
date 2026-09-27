import { randomUUID } from "node:crypto";

import { ManualLeadDisclosure, ManualLeadForm, ManualLeadTrigger } from "@/components/v3/ManualLeadForm";
import { PartShell } from "@/components/v3/PartShell";
import { QueueError } from "@/components/v3/queue/QueueStates";
import { RequestsQueueView, type RequestsQueueRead } from "@/components/v3/requests/RequestsQueueView";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parseRequestOpen, parseRequestSelection, type RequestSelection } from "@/lib/requests-queue-contract";
import { readLookPreview } from "@/lib/v3/look-preview";
import { readPipelineOwnerOptions } from "@/lib/v3/pipeline-source";
import { loadScopedRequestsQueue, RequestsQueueSourceError } from "@/lib/v3/requests-queue-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Заявки" };

/**
 * «Заявки» (Э3 плана редизайна, 27.09.2026): очередь разбора. Чтение —
 * `staff_requests_queue_v2` (миграция 250): ответственный, «можно взять»,
 * «Ждут разбора / Все», числа вкладок и последняя заявка. «Взять себе» — та
 * же команда, что у формы решения доски; «Добавить лида» — та же форма
 * ручного лида, что у доски, и единственный сплошной красный страницы.
 */
export default async function RequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireV3PageActor("/v3/requests");
  const params = await searchParams;
  let selection: RequestSelection;
  try { selection = parseRequestSelection(params); }
  catch {
    return <PartShell title="Заявки" dense>
      <QueueError text="Эта ссылка на очередь заявок неверна." retryHref="/v3/requests" />
    </PartShell>;
  }
  const open = parseRequestOpen(params.open);
  // Новый облик (предпросмотр Admin, Э1.3): тот же признак, что `data-look` оболочки.
  const look = (await readLookPreview(actor)) ? "next" as const : undefined;
  const readOnly = isStaffPreview(actor);
  // Та же граница, что у «Добавить лида» на доске: форма и список ответственных.
  const canCreateLead = !readOnly && staffHasPermission(actor, "lead.sales.workflow.manage");
  const [read, owners] = await Promise.all([
    loadScopedRequestsQueue(actor, selection).then(
      (queue): RequestsQueueRead => ({ status: "ready", queue }),
      (error): RequestsQueueRead => ({ status: error instanceof RequestsQueueSourceError ? error.code : "unavailable" }),
    ),
    canCreateLead ? readPipelineOwnerOptions(actor).catch(() => null) : null,
  ]);
  const takeRequestIds = read.status === "ready"
    ? Object.fromEntries(read.queue.rows.flatMap((row) => row.kind === "lead" && row.take ? [[row.leadId, randomUUID()]] : []))
    : {};

  return (
    <ManualLeadDisclosure>
      <PartShell title="Заявки" dense testId="v3-requests" action={canCreateLead ? <ManualLeadTrigger /> : undefined}>
        {canCreateLead ? <ManualLeadForm requestId={randomUUID()} ownerId={actor.membershipId}
          owners={(owners?.rows ?? []).map((owner) => ({ id: owner.membershipId, displayName: owner.displayLabel }))} /> : null}
        <RequestsQueueView
          selection={selection}
          read={read}
          open={open}
          actorMembershipId={actor.membershipId}
          readOnly={readOnly}
          canCreateLead={canCreateLead}
          nowIso={new Date().toISOString()}
          takeRequestIds={takeRequestIds}
          decisionRequestId={randomUUID()}
          look={look}
        />
      </PartShell>
    </ManualLeadDisclosure>
  );
}
