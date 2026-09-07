import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import {
  documentReviewLabel,
  documentStatus,
  formatPortalTimestamp,
} from "./presentation";

export function DocumentsView({
  documents,
}: {
  documents: readonly StudentPortalDocument[];
}) {
  const currentDocuments = selectCurrentPortalDocuments(documents);

  if (currentDocuments.length === 0) {
    return (
      <PortalEmptyState
        title="Список документов пока пуст"
        description="Когда команда EVO опубликует требования для вашего дела, они появятся здесь."
      />
    );
  }

  return (
    <PortalSection
      title="Чеклист"
      description={`${currentDocuments.length} ${documentCountLabel(currentDocuments.length)} в вашем деле`}
    >
      <ul className="divide-y divide-border">
        {currentDocuments.map((document) => {
          const status = documentStatus(document);
          const reviewLabel = documentReviewLabel(document);
          const deadlineLabel = formatPortalTimestamp(document.deadline);
          const submittedLabel = formatPortalTimestamp(document.submittedAt);

          return (
            <li key={document.documentSlotId} className="px-4 py-5 sm:px-5">
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

/**
 * The portal RPC currently returns one row per slot/version. Keep the UI at
 * one row per slot and bind all actions to the highest canonical version_no.
 * A slot without submissions remains visible until its first version exists.
 */
export function selectCurrentPortalDocuments(
  documents: readonly StudentPortalDocument[],
): readonly StudentPortalDocument[] {
  const currentBySlot = new Map<string, StudentPortalDocument>();

  for (const document of documents) {
    const selected = currentBySlot.get(document.documentSlotId);
    if (!selected || isLaterDocumentVersion(document, selected)) {
      currentBySlot.set(document.documentSlotId, document);
    }
  }

  return [...currentBySlot.values()];
}

function isLaterDocumentVersion(
  candidate: StudentPortalDocument,
  selected: StudentPortalDocument,
): boolean {
  if (candidate.versionNo === null) return false;
  if (selected.versionNo === null) return true;
  return BigInt(candidate.versionNo) > BigInt(selected.versionNo);
}

function documentCountLabel(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "документов";
  if (mod10 === 1) return "документ";
  if (mod10 >= 2 && mod10 <= 4) return "документа";
  return "документов";
}
