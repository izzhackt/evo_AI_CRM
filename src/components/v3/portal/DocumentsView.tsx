import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import {
  documentReviewLabel,
  documentProgress,
  documentStatus,
  formatPortalTimestamp,
} from "./presentation";

export function DocumentsView({
  documents,
}: {
  documents: readonly StudentPortalDocument[];
}) {
  if (documents.length === 0) {
    return (
      <PortalEmptyState
        title="Список документов пока пуст"
        description="Здесь появится список документов, которые нужно предоставить команде EVO."
      />
    );
  }

  const { approved, inReview, corrections, missing } = documentProgress(documents);

  return (
    <PortalSection
      title="Чеклист"
      description={`${documents.length} ${documentCountLabel(documents.length)} в вашем деле. Сроки указаны по времени Бишкека.`}
    >
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-1 gap-x-4 text-sm">
          <p id="document-progress-label" className="m-0 text-fg">Принято <strong className="font-semibold">{approved} из {documents.length}</strong></p>
          <p className="m-0 text-fg-3">{approved === documents.length ? "Все документы приняты" : "После проверки командой EVO"}</p>
        </div>
        <progress
          className="mt-3 block h-2 w-full appearance-none overflow-hidden rounded-nav border-0 bg-surface-3 text-accent [&::-moz-progress-bar]:rounded-nav [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:rounded-nav [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:rounded-nav [&::-webkit-progress-value]:bg-accent"
          value={approved}
          max={documents.length}
          aria-labelledby="document-progress-label"
        />
        {missing > 0 || corrections > 0 || inReview > 0 ? (
          <ul aria-label="Состояние документов" className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-2">
            {missing > 0 ? <li>Нужно добавить: <strong className="font-semibold">{missing}</strong></li> : null}
            {corrections > 0 ? <li>Нужны исправления: <strong className="font-semibold">{corrections}</strong></li> : null}
            {inReview > 0 ? <li>Ожидают проверки: <strong className="font-semibold">{inReview}</strong></li> : null}
          </ul>
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {documents.map((document) => {
          const status = documentStatus(document);
          const reviewLabel = documentReviewLabel(document);
          const deadlineLabel = formatPortalTimestamp(document.deadline);
          const submittedLabel = formatPortalTimestamp(document.submittedAt);

          return (
            <li
              key={document.documentSlotId}
              id={`document-${document.documentSlotId}`}
              className="scroll-mt-24 px-4 py-5 sm:px-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold leading-6 text-fg">
                    {document.requirementLabel}
                  </h3>
                  {document.instructions ? (
                    <p className="mt-1 max-w-[720px] text-sm leading-6 text-fg-2">
                      {document.instructions}
                    </p>
                  ) : null}
                </div>
                <PortalStatus label={status.label} tone={status.tone} />
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {deadlineLabel ? (
                  <div>
                    <dt className="text-xs text-fg-3">Срок</dt>
                    <dd className="mt-1 font-medium text-fg">
                      <time dateTime={document.deadline ?? undefined}>
                        {deadlineLabel}
                      </time>
                    </dd>
                  </div>
                ) : null}
                {document.originalFilename ? (
                  <div>
                    <dt className="text-xs text-fg-3">Последний файл</dt>
                    <dd className="mt-1 break-words font-medium text-fg">
                      {document.originalFilename}
                      {submittedLabel ? (
                        <time
                          dateTime={document.submittedAt ?? undefined}
                          className="ms-2 font-normal text-fg-3"
                        >
                          · {submittedLabel}
                        </time>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {reviewLabel ? (
                  <div>
                    <dt className="text-xs text-fg-3">Решение EVO</dt>
                    <dd className="mt-1 font-medium text-fg">{reviewLabel}</dd>
                  </div>
                ) : null}
              </dl>

              {document.reworkReason ? (
                <div
                  role="note"
                  aria-label="Что нужно исправить"
                  className="mt-4 border-s-2 border-border-strong ps-3"
                >
                  <p className="text-xs font-semibold text-fg">
                    Что нужно исправить
                  </p>
                  <p className="mt-1 text-sm leading-6 text-fg-2">
                    {document.reworkReason}
                  </p>
                </div>
              ) : null}

              {document.nextAction ? (
                <p className="mt-4 rounded-nav bg-surface-2 px-3 py-3 text-sm leading-6 text-fg-2">
                  <span className="font-semibold text-fg">Следующий шаг:</span>{" "}
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
    </PortalSection>
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
