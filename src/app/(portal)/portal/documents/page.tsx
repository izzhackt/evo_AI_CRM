import type { Metadata } from "next";

import { DocumentsView } from "@/components/portal/admission/DocumentsView";
import { readStudentPortalDocuments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Документы — EVO Admissions",
};

/**
 * «Документы» в Атласе (PORT-5d). Смоук-якоря production: заголовок
 * «Документы» и заголовки чек-листа («Чеклист» | «Список документов пока
 * пуст») — байт-в-байт.
 */
export default async function StudentPortalDocumentsPage() {
  const documents = await readStudentPortalDocuments();

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">Сопровождение</p>
        <h1 className="pt-page-title">Документы</h1>
        <p className="pt-page-lead">Что нужно предоставить, что уже принято и что требуется исправить.</p>
      </header>
      <DocumentsView documents={documents} />
    </main>
  );
}
