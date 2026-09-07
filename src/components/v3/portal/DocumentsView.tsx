import { PortalEmptyState, PortalSection } from "./PortalPage";
import { PortalStatus } from "./PortalStatus";
import type { PortalDocumentsView as PortalDocumentsViewModel } from "./types";

export function DocumentsView({ view }: { view: PortalDocumentsViewModel }) {
  if (view.documents.length === 0) {
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
      description={`${view.documents.length} ${documentCountLabel(view.documents.length)} в вашем деле`}
    >
      <ul className="divide-y divide-border">
        {view.documents.map((document) => (
          <li key={document.documentSlotId} className="px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold leading-6 text-fg">
                  {document.label}
                </h3>
                {document.instructions ? (
                  <p className="mt-1 max-w-[720px] text-sm leading-6 text-fg-2">
                    {document.instructions}
                  </p>
                ) : null}
              </div>
              <PortalStatus status={document.status} />
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {document.dueLabel ? (
                <div>
                  <dt className="text-xs text-fg-3">Срок</dt>
                  <dd className="mt-1 font-medium text-fg">{document.dueLabel}</dd>
                </div>
              ) : null}
              {document.latestVersion ? (
                <div>
                  <dt className="text-xs text-fg-3">Последний файл</dt>
                  <dd className="mt-1 break-words font-medium text-fg">
                    {document.latestVersion.filename}
                    {document.latestVersion.submittedLabel ? (
                      <span className="ms-2 font-normal text-fg-3">
                        · {document.latestVersion.submittedLabel}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>

            {document.reworkReason ? (
              <div className="mt-4 rounded-nav border border-danger bg-danger-weak px-3 py-3">
                <p className="text-xs font-semibold text-danger">Что нужно исправить</p>
                <p className="mt-1 text-sm leading-6 text-danger">
                  {document.reworkReason}
                </p>
              </div>
            ) : null}
          </li>
        ))}
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
