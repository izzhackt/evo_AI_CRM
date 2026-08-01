import { isUiContractFixtureMode } from "@/lib/runtime-mode";

import {
  ApplicationDetailPresenter,
  type ApplicationDetailSearchParams,
} from "../ApplicationsPresenter";

export default async function ApplicationDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ApplicationDetailSearchParams>;
}) {
  const model = isUiContractFixtureMode()
    ? await (
        await import("./LegacyApplicationPage")
      ).loadLegacyApplicationDetail(props)
    : await (
        await import("./PlatformApplicationPage")
      ).loadPlatformApplicationDetail(props);

  return <ApplicationDetailPresenter model={model} />;
}
