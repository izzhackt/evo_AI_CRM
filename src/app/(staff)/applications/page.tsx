import { isUiContractFixtureMode } from "@/lib/runtime-mode";

import {
  ApplicationsQueuePresenter,
  type ApplicationsSearchParams,
} from "./ApplicationsPresenter";

export default async function ApplicationsPage(props: {
  searchParams: Promise<ApplicationsSearchParams>;
}) {
  const model = isUiContractFixtureMode()
    ? await (await import("./LegacyApplicationsPage")).loadLegacyApplicationsPage(
        props,
      )
    : await (
        await import("./PlatformApplicationsPage")
      ).loadPlatformApplicationsPage(props);

  return <ApplicationsQueuePresenter model={model} />;
}
