import type { Metadata } from "next";

import { DocumentsView } from "@/components/v3/portal/DocumentsView";
import { PortalPage } from "@/components/v3/portal/PortalPage";
import { readStudentPortalDocuments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Документы — EVO Admissions",
};

export default async function StudentPortalDocumentsPage() {
  const documents = await readStudentPortalDocuments();

  return (
    <PortalPage
      title="Документы"
      description="Что нужно предоставить, что уже принято и что требуется исправить."
    >
      <DocumentsView documents={documents} />
    </PortalPage>
  );
}
