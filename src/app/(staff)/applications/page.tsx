import { isUiContractFixtureMode } from "@/lib/runtime-mode";

export default async function ApplicationsPage(props: {
  searchParams: Promise<{
    status?: string;
    result?: string;
    student_case_id?: string;
    retry_request_id?: string;
  }>;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyApplicationsPage } = await import(
      "./LegacyApplicationsPage"
    );
    return <LegacyApplicationsPage searchParams={props.searchParams} />;
  }

  const { default: PlatformApplicationsPage } = await import(
    "./PlatformApplicationsPage"
  );
  return <PlatformApplicationsPage searchParams={props.searchParams} />;
}
