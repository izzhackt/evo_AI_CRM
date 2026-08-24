import { notFound } from "next/navigation";

import { CanonicalClientDetail } from "@/components/platform/core/CanonicalClientDetail";
import { getT } from "@/lib/i18n";
import { getPlatformCanonicalClient } from "@/lib/platform-canonical-records";
import { requirePlatformClientsActor } from "@/lib/platform-guards";

export async function ConnectedCanonicalClientDetail({
  id,
}: Readonly<{ id: string }>) {
  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformClientsActor(),
  ]);
  const client = await getPlatformCanonicalClient(actor, id);
  if (!client) notFound();

  return <CanonicalClientDetail client={client} locale={locale} />;
}
