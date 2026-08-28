import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { CanonicalSalesWorkflowForm } from "@/components/platform/sales/CanonicalSalesWorkflowForm";
import { getT } from "@/lib/i18n";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  getCanonicalLeadSnapshot,
} from "@/lib/server/canonical-crm-repository";

export async function SalesLeadWorkspace({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);

  let lead: Awaited<ReturnType<typeof getCanonicalLeadSnapshot>>;
  try {
    lead = await getCanonicalLeadSnapshot({
      actorRole: actor.platformRole,
      leadId: id,
    });
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
      <CanonicalSalesWorkflowForm
        lead={lead}
        locale={locale}
        requestId={randomUUID()}
      />
    </div>
  );
}
