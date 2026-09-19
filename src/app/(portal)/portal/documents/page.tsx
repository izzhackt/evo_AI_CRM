import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { DocumentsView } from "@/components/portal/admission/DocumentsView";
import { readStudentPortalDocuments } from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.documentsTitle} — EVO Admissions` };
}

/**
 * «Документы» в Атласе (PORT-5d). Смоук-якоря production: заголовок
 * «Документы» и заголовки чек-листа («Чеклист» | «Список документов пока
 * пуст») — байт-в-байт (PORT-6a: RU-значения живут в неймспейсе admission,
 * смоук-аккаунт — language=ru).
 */
export default async function StudentPortalDocumentsPage() {
  const [documents, locale] = await Promise.all([readStudentPortalDocuments(), getLocale()]);
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.documentsTitle}</h1>
        <p className="pt-page-lead">{strings.documentsLead}</p>
      </header>
      <DocumentsView documents={documents} locale={locale} />
    </main>
  );
}
