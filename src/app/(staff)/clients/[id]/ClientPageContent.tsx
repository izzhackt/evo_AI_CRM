import { notFound } from "next/navigation";

import { isUiContractFixtureMode } from "@/lib/runtime-mode";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPageContent({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  if (isUiContractFixtureMode()) {
    const { default: FixtureClientPage } = await import("./FixtureClientPage");
    return <FixtureClientPage params={params} />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const { ConnectedCanonicalClientDetail } = await import(
    "./ConnectedCanonicalClientDetail"
  );
  return <ConnectedCanonicalClientDetail id={id} />;
}
