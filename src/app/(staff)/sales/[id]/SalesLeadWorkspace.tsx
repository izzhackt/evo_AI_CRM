import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { CanonicalSalesConversationList } from "@/components/platform/sales/CanonicalSalesConversations";
import { CanonicalSalesWorkflowForm } from "@/components/platform/sales/CanonicalSalesWorkflowForm";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  getCanonicalLeadSnapshot,
  listCanonicalLeadConversations,
} from "@/lib/server/canonical-crm-repository";

export async function SalesLeadWorkspace({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);

  let lead: Awaited<ReturnType<typeof getCanonicalLeadSnapshot>>;
  let conversations: Awaited<ReturnType<typeof listCanonicalLeadConversations>>;
  try {
    [lead, conversations] = await Promise.all([
      getCanonicalLeadSnapshot({
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
    </div>
  );
}
