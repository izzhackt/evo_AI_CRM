import type { Metadata } from "next";

import { ApplicationsView } from "@/components/v3/portal/ApplicationsView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { readStudentPortalApplications } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Заявки и виза — EVO Admissions",
};

export default async function StudentPortalApplicationsPage() {
  const view = await readStudentPortalApplications();

  return (
    <PortalPage
      title="Заявки и виза"
      description="Статусы университетских заявок, дедлайны и ход визового дела."
    >
      <ApplicationsView view={view} />
    </PortalPage>
  );
}
