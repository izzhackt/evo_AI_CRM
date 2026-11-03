import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { DocumentStatusIcon } from "./DocumentStatusIcon";
import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import {
  documentChecklistIcon,
  documentReviewLabel,
  documentProgress,
  documentStatus,
  formatPortalTimestamp,
} from "./presentation";

/**
 * «Документы» в Атласе (PORT-5d): чек-лист со счётчиком принятых, честными
 * статусами и прежним XHR-путём загрузки/скачивания. С 03.11.2026 — один
 * список строк: знак, что за документ и что прислать, справа статус и
 * «Загрузить» (выбранный файл сразу уходит тем же XHR-путём). PORT-6a: строки — из
 * неймспейса admission (RU+KY); смоук-якоря сохранены байт-в-байт в
 * RU-словаре: заголовки «Чеклист» и «Список документов пока пуст».
 */
export function DocumentsView({
  documents,
  locale,
}: {
  documents: readonly StudentPortalDocument[];
  locale: Locale;
}) {
  const strings = getPortalStrings("admission", locale);

  if (documents.length === 0) {
    return (
      <section className="pt-adm-empty">
        <h2 className="pt-section-title">{strings.documentsEmptyTitle}</h2>
        <p className="pt-adm-empty-body">{strings.documentsEmptyBody}</p>
      </section>
    );
  }

  const { approved } = documentProgress(documents);

  return (
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">{strings.checklistHeading}</h2>
        </div>
      </header>
      <div className="pt-doc-summary">
        <div className="pt-doc-summary-row">
          <p id="document-progress-label" className="pt-doc-summary-count">
            {strings.acceptedLabel}{" "}
            <strong>
              {formatPortalString(strings.acceptedShare, {
                approved: String(approved),
                total: String(documents.length),
              })}
            </strong>
          </p>
          <p className="pt-doc-hint">{strings.uploadHint}</p>
        </div>
        <progress
          className="pt-progress"
          value={approved}
          max={documents.length}
          aria-labelledby="document-progress-label"
        />
      </div>
      <ul className="pt-doc-rows">
        {documents.map((document) => {
          const status = documentStatus(document, strings);
          const decisionLabel = documentReviewLabel(document, strings);
          // «Нужно исправить» в плашке и «нужно исправить» в строке «Решение» — одно и то же.
          const reviewLabel = decisionLabel !== null
            && decisionLabel.toLocaleLowerCase() === status.label.toLocaleLowerCase()
            ? null
            : decisionLabel;
          const deadlineLabel = formatPortalTimestamp(document.deadline);
          const submittedLabel = formatPortalTimestamp(document.submittedAt);

          return (
            <li
              key={document.documentSlotId}
              id={`document-${document.documentSlotId}`}
              className="pt-doc-item pt-doc-row"
              data-status={document.status}
            >
              <DocumentStatusIcon icon={documentChecklistIcon(document)} className="pt-doc-row-mark" />
              <div className="pt-doc-row-main">
                <h3 className="pt-doc-item-title">{document.requirementLabel}</h3>
                {document.instructions ? (
                  <p className="pt-doc-item-instructions">{document.instructions}</p>
                ) : null}
                {deadlineLabel || document.originalFilename || reviewLabel ? (
                  <p className="pt-doc-row-facts">
                    {document.originalFilename ? (
                      <span>
                        {document.originalFilename}
                        {submittedLabel ? (
                          <time dateTime={document.submittedAt ?? undefined}> · {submittedLabel}</time>
                        ) : null}
                      </span>
                    ) : null}
                    {deadlineLabel ? (
                      <span>
                        {strings.deadlineTerm}{" "}
                        <time dateTime={document.deadline ?? undefined}>{deadlineLabel}</time>
                      </span>
                    ) : null}
                    {reviewLabel ? <span>{strings.decisionTerm} {reviewLabel}</span> : null}
                  </p>
                ) : null}
                {document.reworkReason ? (
                  <div
                    role="note"
                    aria-label={strings.reworkTitle}
                    className="pt-doc-rework"
                  >
                    <p className="pt-doc-rework-title">{strings.reworkTitle}</p>
                    <p className="pt-doc-rework-body">{document.reworkReason}</p>
                  </div>
                ) : null}
                {document.nextAction ? (
                  <p className="pt-next-step">
                    <span className="pt-next-step-label">{strings.nextStepLabel}</span>{" "}
                    {document.nextAction}
                  </p>
                ) : null}
              </div>
              <div className="pt-doc-row-side">
                {/* «Не загружен» говорит сама кнопка «Загрузить»: плашка — только у остальных. */}
                {document.status === "required" ? null : <PortalStatus label={status.label} tone={status.tone} />}
                <PortalDocumentControls
                  documentSlotId={document.documentSlotId}
                  documentVersionId={document.documentVersionId}
                  originalFilename={document.originalFilename}
                  allowUpload={document.status !== "approved"}
                  locale={locale}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
