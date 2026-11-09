import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyIcon } from "@/components/portal/home/HomeParts";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { AI_CONSENT_PRIVACY_URL } from "@/lib/portal/ai-consent";
import { defaultDocumentHint } from "@/lib/portal/document-hints";
import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { DocumentStatusIcon } from "./DocumentStatusIcon";
import { PortalDocumentControls } from "./PortalDocumentControls";
import { PortalStatus } from "./PortalStatus";
import {
  documentChecklistIcon,
  documentReviewLabel,
  documentProgress,
  documentProgressCounts,
  documentStatus,
  formatPortalDeadline,
  formatPortalTimestamp,
} from "./presentation";

/**
 * «Документы» в Атласе (PORT-5d): чек-лист со счётчиком принятых, честными
 * статусами и прежним XHR-путём загрузки/скачивания. С 03.11.2026 — один
 * список строк: знак, что за документ и что прислать, справа статус и
 * «Загрузить» (выбранный файл сразу уходит тем же XHR-путём); над списком —
 * карточка «Чеклист» со счётчиком принятых, под ним — строка о данных
 * (образец кабинета пользователя, 03.11.2026). PORT-6a: строки — из
 * неймспейса admission (RU+KY); смоук-якоря сохранены байт-в-байт в
 * RU-словаре: заголовки «Чеклист» и «Список документов пока пуст».
 */
export function DocumentsView({
  documents,
  locale,
  tabs = null,
  children = null,
}: {
  documents: readonly StudentPortalDocument[];
  locale: Locale;
  /** Вкладки страницы — между карточкой «Чеклист» и содержимым (как у образца). */
  tabs?: ReactNode;
  /** Другая вкладка («Пакеты по вузам») вместо списка документов. */
  children?: ReactNode;
}) {
  const strings = getPortalStrings("admission", locale);

  if (documents.length === 0) {
    return (
      <>
        {tabs}
        {children ?? (
          <section className="pt-adm-empty">
            <EmptyIcon name="documents" />
            <h2 className="pt-section-title">{strings.documentsEmptyTitle}</h2>
            <p className="pt-adm-empty-body">{strings.documentsEmptyBody}</p>
            {/* #1361: пустой список не тупик — прямой вход в чат с командой. */}
            <Link href="/portal/messages?view=chat" className="pt-btn pt-adm-empty-action">{strings.documentsWriteEvo}</Link>
          </section>
        )}
      </>
    );
  }

  const { approved } = documentProgress(documents);
  // Полоса и подписи «Чеклиста» (08.11.2026): сколько принято, на проверке, исправить и ещё не загружено.
  const counts = documentProgressCounts(documents, strings);

  return (
    <>
      {/* Карточка «Чеклист» (как у образца): квадратный знак, заголовок и одна строка — сколько принято и какие файлы подходят. */}
      <section className="pt-card pt-docs-status" aria-labelledby="documents-checklist">
        <DocumentStatusIcon
          icon={approved === documents.length ? "check" : "file"}
          className="pt-docs-status-mark"
        />
        <div className="pt-docs-status-main">
          {/* Как у Акылмана (08.11.2026): над всем — подпись «Чеклист», крупно — состояние «Принято N из M». */}
          <h2 id="documents-checklist" className="pt-docs-status-title">{strings.checklistHeading}</h2>
          <p className="pt-docs-status-share">
            {strings.acceptedLabel}{" "}
            {formatPortalString(strings.acceptedShare, {
              approved: String(approved),
              total: String(documents.length),
            })}
          </p>
          <p className="pt-docs-status-line">{strings.uploadHint}</p>
          <span className="pt-docs-meter" aria-hidden="true">
            {counts.map((item) => (
              <span key={item.kind} data-kind={item.kind} style={{ flexGrow: item.count }} />
            ))}
          </span>
          <ul className="pt-docs-counts">
            {counts.map((item) => (
              <li key={item.kind} data-kind={item.kind}>
                {item.label}: <strong>{item.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {tabs}
      {children ?? (
      <>
      <section className="pt-card pt-docs-list" aria-labelledby="documents-checklist">
      <ul className="pt-doc-rows">
        {documents.map((document) => {
          const status = documentStatus(document, strings);
          const decisionLabel = documentReviewLabel(document, strings);
          // «Нужно исправить» в плашке и «нужно исправить» в строке «Решение» — одно и то же.
          const reviewLabel = decisionLabel !== null
            && decisionLabel.toLocaleLowerCase() === status.label.toLocaleLowerCase()
            ? null
            : decisionLabel;
          const deadlineLabel = formatPortalDeadline(document.deadline);
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
                {/* Своя инструкция куратора важнее; без неё — общая подсказка к пункту списка по умолчанию. */}
                {document.instructions ?? defaultDocumentHint(document.requirementLabel, locale) ? (
                  <p className="pt-doc-item-instructions">
                    {document.instructions ?? defaultDocumentHint(document.requirementLabel, locale)}
                  </p>
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
                {/* Плашка статуса у каждой строки, и у «Не загружен» (08.11.2026): статус виден одним взглядом по списку. */}
                <PortalStatus label={status.label} tone={status.tone} />
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
      {/* Документа нет в списке — не отдельная загрузка, а чат: куратор скажет, в какую строку его положить. */}
      <p className="pt-docs-other">
        {strings.documentsOtherNote}{" "}
        <Link className="pt-link" href="/portal/messages?view=chat">{strings.documentsWriteEvo}</Link>
      </p>
      {/* Кто видит файлы и как они хранятся — одной строкой под списком, со ссылкой на политику. */}
      <p className="pt-doc-privacy">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2.5 4 5v4.5c0 3.6 2.5 6.6 6 8 3.5-1.4 6-4.4 6-8V5zM7.6 9.8l1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          {strings.documentsPrivacyNote}{" "}
          <a className="pt-link" href={AI_CONSENT_PRIVACY_URL}>{strings.documentsPrivacyLink}</a>
        </span>
      </p>
      </>
      )}
    </>
  );
}
