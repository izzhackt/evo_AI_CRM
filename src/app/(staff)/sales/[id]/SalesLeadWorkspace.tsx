import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { CanonicalSalesConversationList } from "@/components/platform/sales/CanonicalSalesConversations";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import { getPlatformSalesLead } from "@/lib/platform-sales";

import { PlatformSalesAmoCrmCommandSection } from "./PlatformSalesAmoCrmCommandSection";

export async function SalesLeadWorkspace({ id }: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);

  const lead = await getPlatformSalesLead(actor, id);
  if (lead === null) notFound();

  return (
    <div className="space-y-5" data-testid="canonical-sales-lead-workspace">
      <CanonicalLeadDetail lead={lead} locale={locale} />
      <PlatformSalesAmoCrmCommandSection
        organizationId={actor.organizationId}
        authorityRole={actor.authorityRole}
        locale={locale}
        leadId={lead.leadId}
        clientId={lead.clientId}
      />
      <CanonicalSalesConversationList
        leadId={lead.leadId}
        conversations={lead.linkedConversations}
        locale={locale}
      />
    </div>
  );
}
