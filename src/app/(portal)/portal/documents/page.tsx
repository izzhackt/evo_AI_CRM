import type { Metadata } from "next";
import Link from "next/link";

import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";

import { PendingPackagesLink } from "@/components/portal/applicationPackages/PendingPackagesLink";
import { packageStrings } from "@/components/portal/applicationPackages/strings";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { DocumentUploadDialog } from "@/components/portal/admission/DocumentUploadDialog";
import { CaseFilesCard } from "@/components/portal/admission/CaseFilesCard";
import { DocumentsView } from "@/components/portal/admission/DocumentsView";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";
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
 * 03.11.2026 (по образцу кабинета пользователя): в шапке кнопка «Загрузить
 * документ» (окно выбора строки чек-листа), ниже вкладки-таблетки «Мои
 * документы» (чек-лист, по умолчанию) и «Пакеты по вузам» (?view=packages —
 * пакеты выбранных программ, тот же список, что на «Моём поступлении»).
 * Пакеты читаются вместе с документами; их сбой не роняет чек-лист.
 */
export default async function StudentPortalDocumentsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const actor = await requireStudentPortalActor();
  const preparationsRead = readStudentCatalogPreparations(actor.studentCaseId).catch(() => null);
  // Свои договор и чеки (352) - дополнение: сбой чтения не роняет чек-лист, блок просто не показывается.
  const caseFilesRead = readStudentPortalCaseFiles().catch(() => []);
  const [documents, locale] = await Promise.all([readStudentPortalDocuments(), getLocale()]);
  const caseFiles = await caseFilesRead;
  const [preparations, params] = await Promise.all([preparationsRead, searchParams]);
  const view = params.view === "packages" ? "packages" : "checklist";
  const strings = getPortalStrings("admission", locale);
  const uploadable = documents
    .filter((document) => document.status !== "approved")
    .map((document) => ({
      documentSlotId: document.documentSlotId,
      label: document.requirementLabel,
      instructions: document.instructions,
      documentVersionId: document.documentVersionId,
      originalFilename: document.originalFilename,
    }));

  return (
    <main className="pt-page">
      <header className="pt-page-header pt-docs-head">
        <div className="pt-docs-head-main">
          <h1 className="pt-page-title">{strings.documentsTitle}</h1>
          <p className="pt-page-lead">{strings.documentsLead}</p>
        </div>
        {view === "checklist" ? <DocumentUploadDialog documents={uploadable} locale={locale} /> : null}
      </header>
      <DocumentsView
        documents={documents}
        locale={locale}
        tabs={(
        <nav className="pt-pill-tabs" aria-label={strings.docsTabsLabel}>
          <Link className="pt-pill-tab" href="/portal/documents" aria-current={view === "checklist" ? "true" : undefined}>
            {strings["docsTab.checklist"]}
            <span className="pt-pill-count">{documents.length}</span>
          </Link>
          <Link className="pt-pill-tab" href="/portal/documents?view=packages" aria-current={view === "packages" ? "true" : undefined}>
            {strings["docsTab.packages"]}
            {preparations !== null ? <span className="pt-pill-count">{preparations.length}</span> : null}
          </Link>
        </nav>
        )}
      >
        {view === "packages" ? (
          <>
            <PreparationList
              items={preparations}
              strings={getPortalStrings("preparations", locale)}
              canSelect={actor.caseState === "active" && Boolean(actor.portalActivatedAt)}
            />
            <PendingPackagesLink owner={{ organizationId: actor.organizationId, membershipId: actor.membershipId }} label={packageStrings(locale).pendingTitle} />
          </>
        ) : null}
      </DocumentsView>
      {view === "checklist" ? <CaseFilesCard files={caseFiles} locale={locale} /> : null}
    </main>
  );
}
