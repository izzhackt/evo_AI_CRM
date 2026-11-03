import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import {
  documentChecklistMark,
  documentChecklistOrder,
  documentReviewLabel,
  documentProgress,
  documentStatus,
  formatPortalTimestamp,
} from "./presentation";

/**
 * «Документы» в Атласе (PORT-5d): чек-лист со счётчиком принятых, честными
 * статусами и прежним XHR-путём загрузки/скачивания. С 03.11.2026 сверху —
 * чек-лист с названиями (строка ведёт к карточке), ниже у каждого документа
 * своя карточка с полем «перетащите файл». PORT-6a: строки — из
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
    <>
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">{strings.checklistHeading}</h2>
          <p className="pt-card-note">
            {formatPortalString(strings.documentsCountLine, {
              count: String(documents.length),
              noun: documentCountNoun(documents.length, strings),
            })}
          </p>
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
          <p className="pt-card-note">
            {approved === documents.length ? strings.acceptedAll : strings.acceptedAfterReview}
          </p>
        </div>
        <progress
          className="pt-progress"
          value={approved}
          max={documents.length}
          aria-labelledby="document-progress-label"
        />
        {/* Мини-чек-лист: название, знак и слово статуса; строка ведёт к карточке ниже. */}
        <ul className="pt-adm-docs-list pt-doc-checklist">
          {documentChecklistOrder(documents).map((document) => (
            <li key={document.documentSlotId}>
              <a href={`#document-${document.documentSlotId}`} className="pt-adm-docs-item" data-status={document.status}>
                <span className="pt-adm-docs-mark" aria-hidden="true">{documentChecklistMark(document)}</span>
                <span className="pt-adm-docs-name">{document.requirementLabel}</span>
                <span className="pt-adm-docs-status">{documentStatus(document, strings).label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
    <ul className="pt-doc-cards">
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
              className="pt-doc-item pt-doc-card"
            >
              <div className="pt-doc-item-head">
                <div className="pt-doc-item-main">
                  <h3 className="pt-doc-item-title">
                    {document.requirementLabel}
                  </h3>
                  {document.instructions ? (
                    <p className="pt-doc-item-instructions">
                      {document.instructions}
                    </p>
                  ) : null}
                </div>
                <PortalStatus label={status.label} tone={status.tone} />
              </div>

              <dl className="pt-facts pt-doc-item-facts">
                {deadlineLabel ? (
                  <div className="pt-fact">
                    <dt>{strings.deadlineTerm}</dt>
                    <dd>
                      <time dateTime={document.deadline ?? undefined}>
                        {deadlineLabel}
                      </time>
                    </dd>
                  </div>
                ) : null}
                {document.originalFilename ? (
                  <div className="pt-fact">
                    <dt>{strings.lastFileTerm}</dt>
                    <dd>
                      {document.originalFilename}
                      {submittedLabel ? (
                        <time
                          dateTime={document.submittedAt ?? undefined}
                          className="pt-doc-item-submitted"
                        >
                          · {submittedLabel}
                        </time>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {reviewLabel ? (
                  <div className="pt-fact">
                    <dt>{strings.decisionTerm}</dt>
                    <dd>{reviewLabel}</dd>
                  </div>
                ) : null}
              </dl>

              {document.reworkReason ? (
                <div
                  role="note"
                  aria-label={strings.reworkTitle}
                  className="pt-doc-rework"
                >
                  <p className="pt-doc-rework-title">
                    {strings.reworkTitle}
                  </p>
                  <p className="pt-doc-rework-body">
                    {document.reworkReason}
                  </p>
                </div>
              ) : null}

              {document.nextAction ? (
                <p className="pt-next-step">
                  <span className="pt-next-step-label">{strings.nextStepLabel}</span>{" "}
                  {document.nextAction}
                </p>
              ) : null}

              <PortalDocumentControls
                documentSlotId={document.documentSlotId}
                documentVersionId={document.documentVersionId}
                originalFilename={document.originalFilename}
                allowUpload={document.status !== "approved"}
                locale={locale}
              />
            </li>
          );
        })}
    </ul>
    </>
  );
}

/**
 * Русская форма слова «документ» рядом с числом; в KY-словаре все три ключа
 * сознательно совпадают — киргизское существительное после числительного
 * не меняет форму.
 */
function documentCountNoun(count: number, strings: PortalStrings<"admission">): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return strings["docNoun.many"];
  if (mod10 === 1) return strings["docNoun.one"];
  if (mod10 >= 2 && mod10 <= 4) return strings["docNoun.few"];
  return strings["docNoun.many"];
}
