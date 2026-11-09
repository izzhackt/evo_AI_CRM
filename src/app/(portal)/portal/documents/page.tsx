import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { CaseFilesCard } from "@/components/portal/admission/CaseFilesCard";
import { DocumentsView } from "@/components/portal/admission/DocumentsView";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentPortalDocuments } from "@/lib/v3/portal-source";
import { readStudentPortalCaseFiles } from "@/lib/v3/portal-source";

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
 *
 * 09.11.2026 (#1357, #1361): страница — только чек-лист. Загрузка одна, кнопкой
 * в строке; список выбранных программ («Мои программы») живёт в одном месте, на
 * «Поступлении», сюда ведёт лишь ссылка. Старый адрес ?view=packages уходит туда же.
 */
export default async function StudentPortalDocumentsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const params = await searchParams;
  if (params.view === "packages") redirect("/portal?view=programs#list");
  await requireStudentPortalActor();
  // Свои договор и чеки (352) - дополнение: сбой чтения не роняет чек-лист, блок просто не показывается.
  const caseFilesRead = readStudentPortalCaseFiles().catch(() => []);
  const [documents, locale] = await Promise.all([readStudentPortalDocuments(), getLocale()]);
  const caseFiles = await caseFilesRead;
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header pt-docs-head">
        <div className="pt-docs-head-main">
          <h1 className="pt-page-title">{strings.documentsTitle}</h1>
          <p className="pt-page-lead">{strings.documentsLead}</p>
          <p className="pt-docs-programs-note">
            {strings.docsProgramsNote}{" "}
            <Link className="pt-link" href="/portal?view=programs#list">{strings.docsProgramsLink}</Link>
          </p>
        </div>
      </header>
      <DocumentsView documents={documents} locale={locale} />
      <CaseFilesCard files={caseFiles} locale={locale} />
    </main>
  );
}
