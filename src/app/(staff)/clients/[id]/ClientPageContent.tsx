import { notFound } from "next/navigation";

import { CanonicalClientDetail } from "@/components/platform/core/CanonicalClientDetail";
import { getT } from "@/lib/i18n";
import { getPlatformCanonicalClient } from "@/lib/platform-canonical-records";
import { requirePlatformClientsActor } from "@/lib/platform-guards";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPageContent({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>) {
  if (isUiContractFixtureMode()) {
    const { default: FixtureClientPage } = await import("./FixtureClientPage");
    return <FixtureClientPage params={params} />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const [{ locale }, actor] = await Promise.all([
    getT(),
    requirePlatformClientsActor(),
  ]);
  const client = await getPlatformCanonicalClient(actor, id);
  if (client) {
    return <CanonicalClientDetail client={client} locale={locale} />;
  }

  const { ConnectedStudentCaseDetail } = await import(
    "./ConnectedStudentCaseDetail"
  );
  return <ConnectedStudentCaseDetail id={id} searchParams={searchParams} />;
}
