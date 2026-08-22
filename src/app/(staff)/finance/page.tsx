import { isUiContractFixtureMode } from "@/lib/runtime-mode";

type FinanceSearchParams = Record<string, string | string[] | undefined>;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<FinanceSearchParams>;
}) {
  const params = await searchParams;
  if (!isUiContractFixtureMode()) {
    const { default: PlatformFinancePage } = await import(
      "./PlatformFinancePage"
    );
    return <PlatformFinancePage searchParams={params} />;
  }

  const { renderLegacyFinancePage } = await import("./LegacyFinancePage");
  return renderLegacyFinancePage();
}
