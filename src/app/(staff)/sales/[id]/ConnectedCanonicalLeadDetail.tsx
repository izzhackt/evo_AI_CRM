import { notFound } from "next/navigation";

import { CanonicalLeadDetail } from "@/components/platform/core/CanonicalLeadDetail";
import { getT } from "@/lib/i18n";
import { getPlatformCanonicalLead } from "@/lib/platform-canonical-records";
import { requirePlatformSalesActor } from "@/lib/platform-guards";

export async function ConnectedCanonicalLeadDetail({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformSalesActor(),
  ]);
  const lead = await getPlatformCanonicalLead(actor, id);
  if (!lead) notFound();

  return <CanonicalLeadDetail lead={lead} locale={locale} />;
}
