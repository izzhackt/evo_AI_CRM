import { isUiContractFixtureMode } from "@/lib/runtime-mode";

type SalesSearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
  lifecycle?: string;
  q?: string;
  stage?: string;
  manager?: string;
  source?: string;
  risk?: string;
  status?: string;
  view?: string;
}>;

export default async function SalesPageContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<SalesSearchParams>;
}>) {
  if (isUiContractFixtureMode()) {
    const { default: FixtureSalesPage } = await import("./FixtureSalesPage");
    return <FixtureSalesPage searchParams={searchParams} />;
  }

  const { ConnectedCanonicalSales } = await import(
    "./ConnectedCanonicalSales"
  );
  return <ConnectedCanonicalSales searchParams={searchParams} />;
}
