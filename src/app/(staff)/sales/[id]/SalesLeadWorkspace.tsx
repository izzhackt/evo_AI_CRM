import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { CanonicalSalesConversationList } from "@/components/platform/sales/CanonicalSalesConversations";
import { PlatformSalesWorkflowForm } from "@/components/platform/sales/PlatformSalesWorkflowForm";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  getPlatformSalesLead,
  listPlatformSalesOwnerOptions,
} from "@/lib/platform-sales";

export async function SalesLeadWorkspace({ id }: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);

  const [lead, ownerOptions] = await Promise.all([
    getPlatformSalesLead(actor, id),
    listPlatformSalesOwnerOptions(actor, { pageSize: 100 }),
  ]);
  if (lead === null) notFound();
  if (actor.authorityRole !== "admin" && actor.authorityRole !== "sales") {
    throw new Error("Platform Sales role is unavailable.");
  }

  return (
    <div className="space-y-5" data-testid="canonical-sales-lead-workspace">
      <CanonicalLeadDetail lead={lead} locale={locale} />
      <PlatformSalesWorkflowForm
        lead={lead}
        ownerOptions={ownerOptions.rows}
        ownerOptionsHaveMore={ownerOptions.hasNext}
        actorRole={actor.authorityRole}
        actorMembershipId={actor.membershipId}
        locale={locale}
        requestId={randomUUID()}
      />
      <CanonicalSalesConversationList
        leadId={lead.leadId}
        conversations={lead.linkedConversations}
        locale={locale}
      />
    </div>
  );
}
