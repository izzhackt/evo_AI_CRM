import {
  ApplicationDetailPresenter,
  type ApplicationDetailSearchParams,
} from "../ApplicationsPresenter";
import { loadApplicationWorkspace } from "./ApplicationWorkspace";

export default async function ApplicationDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ApplicationDetailSearchParams>;
}) {
  const model = await loadApplicationWorkspace(props);

  return <ApplicationDetailPresenter model={model} />;
}
