import { randomUUID } from "node:crypto";
import Link from "next/link";

import { EmptyState, PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ManualLeadDisclosure, ManualLeadForm, ManualLeadTrigger } from "@/components/v3/ManualLeadForm";
import { PartShell } from "@/components/v3/PartShell";
import { QueueError } from "@/components/v3/queue/QueueStates";
import { RequestsQueueView, type RequestsQueueRead } from "@/components/v3/requests/RequestsQueueView";
import { RequestsNextView } from "@/components/v3/requests-next/RequestsNextView";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { parseRequestOpen, parseRequestSelection, type RequestSelection } from "@/lib/requests-queue-contract";
import { requestEmptyWhat } from "@/lib/v3/requests-view";
import { readPipelineOwnerOptions } from "@/lib/v3/pipeline-source";
import { loadScopedRequestsQueue, RequestsQueueSourceError } from "@/lib/v3/requests-queue-source";
import { readDialOptions } from "@/lib/v3/telephony-dial-source";
import { readRequestCallLines } from "@/lib/v3/telephony-request-calls-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Заявки" };

/**
 * «Заявки» (Э3 плана редизайна, 27.09.2026): очередь разбора. Чтение —
 * `staff_requests_queue_v3` (телефония T9; v2 из миграции 250 + лиды `phone_call`
 * и вкладка «Звонки» при включённой телефонии): ответственный, «можно взять»,
 * «Ждут разбора / Все», числа вкладок и последняя заявка. «Взять себе» — та
 * же команда, что у формы решения доски; «Добавить лида» — та же форма
 * ручного лида, что у доски, и единственный сплошной красный страницы.
 */
export default async function RequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireV3PageActor("/v3/requests");
  const params = await searchParams;
  // «Новый вид» (переключатель администратора): те же чтения и права, другая расстановка — таблица и панель записи.
  const next = await isNextUi(actor);
  let selection: RequestSelection;
  try { selection = parseRequestSelection(params); }
  catch {
    if (next) {
      return <PageShell title="Заявки" testId="v3-requests">
        <div role="alert" className="rounded-card border border-border bg-surface" data-testid="queue-error">
          <EmptyState tone="danger" title="Эта ссылка на очередь заявок неверна."
            action={<Button variant="outline" asChild><Link href="/v3/requests">Повторить</Link></Button>} />
        </div>
      </PageShell>;
    }
    return <PartShell title="Заявки" dense>
      <QueueError text="Эта ссылка на очередь заявок неверна." retryHref="/v3/requests" />
    </PartShell>;
  }
  const open = parseRequestOpen(params.open);
  const readOnly = isStaffPreview(actor);
  // Та же граница, что у «Добавить лида» на доске: форма и список ответственных.
  const canCreateLead = !readOnly && staffHasPermission(actor, "lead.sales.workflow.manage");
  const [read, owners, dial] = await Promise.all([
    loadScopedRequestsQueue(actor, selection).then(
      (queue): RequestsQueueRead => ({ status: "ready", queue }),
      (error): RequestsQueueRead => ({ status: error instanceof RequestsQueueSourceError ? error.code : "unavailable" }),
    ),
    // Сбой чтения ответственных — null: форма скажет, что список не загрузился.
    canCreateLead ? readPipelineOwnerOptions(actor).catch(() => null) : null,
    // «Звонки» (T9): исход звонка в строке и «Позвонить» — только когда телефония в интерфейсе включена и набор открыт.
    // Читается вместе с очередью, а не после неё: отдельного ожидания на каждый заход нет (сбой чтения — «выключено»).
    readDialOptions(actor),
  ]);
  const callLines = read.status === "ready" && read.queue.phoneCalls ? await readRequestCallLines(actor, read.queue.rows) : {};
  const takeRequestIds = read.status === "ready"
    ? Object.fromEntries(read.queue.rows.flatMap((row) => row.kind === "lead" && row.take ? [[row.leadId, randomUUID()]] : []))
    : {};

  if (next) {
    return (
      <ManualLeadDisclosure>
        <PageShell
          title="Заявки"
          testId="v3-requests"
          help={[
            "Очередь разбора: кто пришёл, откуда и взял ли кто-нибудь. Поиск и сортировка работают по строкам этой страницы; остальные страницы — ссылками под таблицей.",
            // Что сюда приходит — только из видов, которые читает роль (прежде стояло в пустой очереди).
            read.status === "ready" ? requestEmptyWhat(read.queue, selection.source) : null,
          ].filter(Boolean).join(" ")}
          actions={canCreateLead ? <ManualLeadTrigger /> : undefined}
        >
          {canCreateLead ? <ManualLeadForm requestId={randomUUID()} ownerId={actor.membershipId}
            owners={owners ? owners.rows.map((owner) => ({ id: owner.membershipId, displayName: owner.displayLabel })) : null} /> : null}
          <RequestsNextView
            selection={selection}
            read={read}
            open={open}
            actorMembershipId={actor.membershipId}
            readOnly={readOnly}
            canCreateLead={canCreateLead}
            nowIso={new Date().toISOString()}
            takeRequestIds={takeRequestIds}
            dial={dial}
            callLines={callLines}
            decisionRequestId={randomUUID()}
          />
        </PageShell>
      </ManualLeadDisclosure>
    );
  }

  return (
    <ManualLeadDisclosure>
      <PartShell title="Заявки" dense testId="v3-requests" action={canCreateLead ? <ManualLeadTrigger /> : undefined}>
        {canCreateLead ? <ManualLeadForm requestId={randomUUID()} ownerId={actor.membershipId}
          owners={owners ? owners.rows.map((owner) => ({ id: owner.membershipId, displayName: owner.displayLabel })) : null} /> : null}
        <RequestsQueueView
          selection={selection}
          read={read}
          open={open}
          actorMembershipId={actor.membershipId}
          readOnly={readOnly}
          canCreateLead={canCreateLead}
          nowIso={new Date().toISOString()}
          takeRequestIds={takeRequestIds}
          dial={dial}
          callLines={callLines}
          decisionRequestId={randomUUID()}
        />
      </PartShell>
    </ManualLeadDisclosure>
  );
}
