import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function ClientsPage(props: {
  searchParams: Promise<{ stage?: string; q?: string; state?: string }>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyClientsPage } = await import("./LegacyClientsPage");
    return <LegacyClientsPage searchParams={props.searchParams} />;
  }

  const { default: PlatformClientsPage } = await import("./PlatformClientsPage");
  return <PlatformClientsPage searchParams={props.searchParams} />;
}
