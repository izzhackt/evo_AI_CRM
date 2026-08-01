import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function ClientDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string; retry_request_id?: string }>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyClientPage } = await import("./LegacyClientPage");
    return <LegacyClientPage params={props.params} />;
  }

  const { default: PlatformClientPage } = await import("./PlatformClientPage");
  return <PlatformClientPage {...props} />;
}
