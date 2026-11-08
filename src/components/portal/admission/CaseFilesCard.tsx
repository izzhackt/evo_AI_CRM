import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalCaseFile } from "@/lib/v3/portal-source";

import { DocumentStatusIcon } from "./DocumentStatusIcon";
import { PortalStatus } from "./PortalStatus";
import { formatPortalTimestamp } from "./presentation";

/**
 * Свои договор и чеки студента (08.11.2026, миграция 352), только чтение: принятый договор (вид «Договор») и чеки, привязанные к оплате
 * и ещё ждущие её. Скачивание идёт отдельным маршрутом `/api/portal/case-files/...`, который проверяет, что файл именно этого студента.
 * Сумм, событий оплаты, заметок сотрудников и «Не нужного» здесь нет: база их не отдаёт. Нет файлов - блока нет.
 */
export function CaseFilesCard({ files, locale }: { files: readonly StudentPortalCaseFile[]; locale: Locale }) {
  if (files.length === 0) return null;
  const strings = getPortalStrings("admission", locale);
  return (
    <section className="pt-card pt-docs-list" aria-labelledby="documents-case-files" data-testid="portal-case-files">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 id="documents-case-files" className="pt-card-title">{strings.caseFilesTitle}</h2>
          <p className="pt-card-note">{strings.caseFilesLead}</p>
        </div>
      </header>
      <ul className="pt-doc-rows">
        {files.map((file) => {
          const added = formatPortalTimestamp(file.addedAt);
          const title = file.kind === "contract" ? strings.caseFileContract : strings.caseFileReceipt;
          return (
            <li key={`${file.kind}:${file.fileId}`} className="pt-doc-item pt-doc-row" data-case-file-kind={file.kind}>
              <DocumentStatusIcon icon="file" className="pt-doc-row-mark" />
              <div className="pt-doc-row-main">
                <h3 className="pt-doc-item-title">{title}</h3>
                <p className="pt-doc-row-facts">
                  <span>
                    {file.originalFilename}
                    {added ? <time dateTime={file.addedAt}> · {added}</time> : null}
                  </span>
                </p>
              </div>
              <div className="pt-doc-row-side">
                {file.kind === "contract" ? null : (
                  <PortalStatus
                    label={file.kind === "receipt" ? strings.caseFileReceiptAttached : strings.caseFileReceiptPending}
                    tone={file.kind === "receipt" ? "ok" : "neutral"}
                  />
                )}
                <a
                  href={`/api/portal/case-files/${file.kind}/${encodeURIComponent(file.fileId)}/download`}
                  className="pt-link pt-doc-download"
                  aria-label={formatPortalString(strings.downloadAria, { name: file.originalFilename })}
                >
                  {strings.downloadButton}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
