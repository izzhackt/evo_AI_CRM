import {
  ApplicationsQueuePresenter,
  type ApplicationsSearchParams,
} from "./ApplicationsPresenter";
import { loadApplicationsWorkspace } from "./ApplicationsWorkspace";

export default async function ApplicationsPage(props: {
  searchParams: Promise<ApplicationsSearchParams>;
}) {
  const model = await loadApplicationsWorkspace(props);

  return <ApplicationsQueuePresenter model={model} />;
}
