import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import {
  documentReviewLabel,
  documentProgress,
  documentStatus,
  formatPortalTimestamp,
} from "./presentation";

/**
 * «Документы» в Атласе (PORT-5d): чек-лист со счётчиком принятых, честными
 * статусами и прежним XHR-путём загрузки/скачивания. Смоук-якоря сохранены
 * байт-в-байт: заголовки «Чеклист» и «Список документов пока пуст».
 */
export function DocumentsView({
  documents,
}: {
  documents: readonly StudentPortalDocument[];
}) {
  if (documents.length === 0) {
    return (
      <section className="pt-adm-empty">
        <h2 className="pt-section-title">Список документов пока пуст</h2>
        <p className="pt-adm-empty-body">
          Здесь появится список документов, которые нужно предоставить команде EVO.
        </p>
      </section>
    );
  }

  const { approved, inReview, corrections, missing } = documentProgress(documents);

  return (
    <section className="pt-card">
      <header className="pt-card-header">
        <div className="pt-card-header-main">
          <h2 className="pt-card-title">Чеклист</h2>
          <p className="pt-card-note">
            {documents.length} {documentCountLabel(documents.length)} в вашем деле. Сроки указаны по времени Бишкека.
          </p>
        </div>
      </header>
      <div className="pt-doc-summary">
        <div className="pt-doc-summary-row">
          <p id="document-progress-label" className="pt-doc-summary-count">
            Принято <strong>{approved} из {documents.length}</strong>
          </p>
          <p className="pt-card-note">
            {approved === documents.length ? "Все документы приняты" : "После проверки командой EVO"}
          </p>
        </div>
        <progress
          className="pt-progress"
          value={approved}
          max={documents.length}
          aria-labelledby="document-progress-label"
        />
        {missing > 0 || corrections > 0 || inReview > 0 ? (
          <ul aria-label="Состояние документов" className="pt-doc-summary-facts">
            {missing > 0 ? <li>Нужно добавить: <strong>{missing}</strong></li> : null}
            {corrections > 0 ? <li>Нужны исправления: <strong>{corrections}</strong></li> : null}
            {inReview > 0 ? <li>Ожидают проверки: <strong>{inReview}</strong></li> : null}
          </ul>
        ) : null}
      </div>
      <ul className="pt-adm-list">
        {documents.map((document) => {
          const status = documentStatus(document);
          const reviewLabel = documentReviewLabel(document);
          const deadlineLabel = formatPortalTimestamp(document.deadline);
          const submittedLabel = formatPortalTimestamp(document.submittedAt);

          return (
            <li
              key={document.documentSlotId}
              id={`document-${document.documentSlotId}`}
              className="pt-doc-item"
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
                    <dt>Срок</dt>
                    <dd>
                      <time dateTime={document.deadline ?? undefined}>
                        {deadlineLabel}
                      </time>
                    </dd>
                  </div>
                ) : null}
                {document.originalFilename ? (
                  <div className="pt-fact">
                    <dt>Последний файл</dt>
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
                    <dt>Решение EVO</dt>
                    <dd>{reviewLabel}</dd>
                  </div>
                ) : null}
              </dl>

              {document.reworkReason ? (
                <div
                  role="note"
                  aria-label="Что нужно исправить"
                  className="pt-doc-rework"
                >
                  <p className="pt-doc-rework-title">
                    Что нужно исправить
                  </p>
                  <p className="pt-doc-rework-body">
                    {document.reworkReason}
                  </p>
                </div>
              ) : null}

              {document.nextAction ? (
                <p className="pt-next-step">
                  <span className="pt-next-step-label">Следующий шаг:</span>{" "}
                  {document.nextAction}
                </p>
              ) : null}

              <PortalDocumentControls
                documentSlotId={document.documentSlotId}
                documentVersionId={document.documentVersionId}
                originalFilename={document.originalFilename}
                allowUpload={document.status !== "approved"}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function documentCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "документов";
  if (mod10 === 1) return "документ";
  if (mod10 >= 2 && mod10 <= 4) return "документа";
  return "документов";
}
