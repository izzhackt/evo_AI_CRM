import { isUiContractFixtureMode } from "@/lib/runtime-mode";

type SalesSearchParams = {
  manager?: string;
  source?: string;
  risk?: string;
  status?: string;
  view?: string;
};

export default async function SalesPage(props: {
  searchParams: Promise<SalesSearchParams>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacySalesPage } = await import("./LegacySalesPage");
    return <LegacySalesPage searchParams={props.searchParams} />;
  }

  const { default: PlatformSalesPage } = await import("./PlatformSalesPage");
  return <PlatformSalesPage />;
}
