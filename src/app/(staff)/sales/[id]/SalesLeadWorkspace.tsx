import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalAmoCrmCommandPanel } from "@/components/platform/amocrm/CanonicalAmoCrmCommandPanel";
import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { CanonicalSalesConversationList } from "@/components/platform/sales/CanonicalSalesConversations";
import { CanonicalSalesGateCard } from "@/components/platform/sales/CanonicalSalesGateCard";
import { CanonicalSalesHandoffCard } from "@/components/platform/sales/CanonicalSalesHandoffCard";
import { CanonicalSalesWorkflowForm } from "@/components/platform/sales/CanonicalSalesWorkflowForm";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import { readCanonicalAmoCrmCommandAvailability } from "@/lib/server/canonical-amocrm-command-actions";
import {
  CanonicalCrmRepositoryError,
  getCanonicalLeadGateSnapshot,
  getCanonicalLeadSnapshot,
  listCanonicalLeadConversations,
} from "@/lib/server/canonical-crm-repository";

export async function SalesLeadWorkspace({ id }: Readonly<{ id: string }>) {
  const [{ locale }, actor, amoCrmAvailability] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
    readCanonicalAmoCrmCommandAvailability(),
  ]);

  let lead: Awaited<ReturnType<typeof getCanonicalLeadSnapshot>>;
  let gate: Awaited<ReturnType<typeof getCanonicalLeadGateSnapshot>>;
  let conversations: Awaited<ReturnType<typeof listCanonicalLeadConversations>>;
  try {
    [lead, gate, conversations] = await Promise.all([
      getCanonicalLeadSnapshot({
        actorRole: actor.platformRole,
        leadId: id,
      }),
      getCanonicalLeadGateSnapshot({
        actorRole: actor.platformRole,
        leadId: id,
      }),
      listCanonicalLeadConversations({
        actorRole: actor.platformRole,
        leadId: id,
      }),
    ]);
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "not_found"
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="space-y-5" data-testid="canonical-sales-lead-workspace">
      <CanonicalLeadDetail lead={lead} locale={locale} />
      <CanonicalAmoCrmCommandPanel
        availability={amoCrmAvailability}
        scope="sales"
        leadId={lead.leadId}
        locale={locale}
        requestId={randomUUID()}
      />
      <CanonicalSalesConversationList
        leadId={lead.leadId}
        conversations={conversations}
        locale={locale}
      />
      <CanonicalSalesWorkflowForm
        lead={lead}
        locale={locale}
        requestId={randomUUID()}
      />
      <CanonicalSalesGateCard
        gate={gate}
        locale={locale}
        occurredAt={new Date().toISOString()}
        requestIds={{
          contract: randomUUID(),
          firstPayment: randomUUID(),
        }}
      />
      <CanonicalSalesHandoffCard
        actorRole={actor.platformRole}
        expectedVersion={lead.version}
        gate={gate}
        locale={locale}
        requestId={randomUUID()}
      />
    </div>
  );
}
