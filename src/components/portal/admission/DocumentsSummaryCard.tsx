import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { readStudentPortalDocuments } from "@/lib/v3/portal-source";

import { documentChecklistMark, documentChecklistOrder, documentProgress, documentStatus } from "./presentation";

/**
 * «Документы» в правой колонке «Поступления» (03.11.2026): пункта меню у
 * документов больше нет, поэтому сводка, мини-чеклист с названиями и вход в
 * список — здесь. То же чтение и тот же счёт, что у чеклиста страницы
 * «Документы»; строка ведёт к своему документу. Сбой чтения — без карточки
 * (страница «Поступление» работает и без неё).
 */
export async function DocumentsSummaryCard({ locale }: Readonly<{ locale: Locale }>) {
  const documents = await readStudentPortalDocuments().catch(() => null);
  if (documents === null) return null;
  const strings = getPortalStrings("admission", locale);
  const { approved } = documentProgress(documents);
  const ordered = documentChecklistOrder(documents);

  return (
    <div className="pt-adm-aside-card pt-adm-docs">
      <h3 className="pt-adm-aside-card-title">{strings.documentsTitle}</h3>
      {documents.length === 0 ? (
        <p className="pt-adm-aside-card-text">{strings.documentsEmptyTitle}</p>
      ) : (
        <>
          <p id="overview-documents-progress" className="pt-adm-docs-count">
            {strings.acceptedLabel}{" "}
            <strong>
              {formatPortalString(strings.acceptedShare, {
                approved: String(approved),
                total: String(documents.length),
              })}
            </strong>
          </p>
          <progress
            className="pt-progress"
            value={approved}
            max={documents.length}
            aria-labelledby="overview-documents-progress"
          />
          <ul aria-label={strings.docFactsAria} className="pt-adm-docs-list">
            {ordered.map((document) => (
              <li key={document.documentSlotId}>
                <Link
                  href={`/portal/documents#document-${document.documentSlotId}`}
                  className="pt-adm-docs-item"
                  data-status={document.status}
                >
                  <span className="pt-adm-docs-mark" aria-hidden="true">{documentChecklistMark(document)}</span>
                  <span className="pt-adm-docs-name">{document.requirementLabel}</span>
                  <span className="pt-adm-docs-status">{documentStatus(document, strings).label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/portal/documents" className="pt-link">
        {strings.allDocuments} <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
