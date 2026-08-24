import { notFound } from "next/navigation";

import { isUiContractFixtureMode } from "@/lib/runtime-mode";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  if (isUiContractFixtureMode()) {
    const { default: FixtureLeadPage } = await import("./FixtureLeadPage");
    return <FixtureLeadPage params={params} />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const { ConnectedCanonicalLeadDetail } = await import(
    "./ConnectedCanonicalLeadDetail"
  );
  return <ConnectedCanonicalLeadDetail id={id} />;
}
