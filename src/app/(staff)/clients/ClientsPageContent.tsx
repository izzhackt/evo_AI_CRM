import { isUiContractFixtureMode } from "@/lib/runtime-mode";

type SearchParams = Readonly<{
  stage?: string;
  q?: string;
  lifecycle?: string;
  before_at?: string | string[];
  before_id?: string | string[];
}>;

export default async function ClientsPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) {
  if (isUiContractFixtureMode()) {
    const { default: FixtureClientsPage } = await import(
      "./FixtureClientsPage"
    );
    return <FixtureClientsPage searchParams={searchParams} />;
  }

  const { ConnectedCanonicalClients } = await import(
    "./ConnectedCanonicalClients"
  );
  return <ConnectedCanonicalClients searchParams={searchParams} />;
}
