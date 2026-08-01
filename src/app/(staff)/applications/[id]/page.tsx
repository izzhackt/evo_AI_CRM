import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function ApplicationDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string; retry_request_id?: string }>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyApplicationPage } = await import(
      "./LegacyApplicationPage"
    );
    return <LegacyApplicationPage params={props.params} />;
  }

  const { default: PlatformApplicationPage } = await import(
    "./PlatformApplicationPage"
  );
  return <PlatformApplicationPage {...props} />;
}
