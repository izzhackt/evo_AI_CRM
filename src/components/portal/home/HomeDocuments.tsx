import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { StudentPortalDocument } from "@/lib/v3/portal-source";

import { documentProgress, documentStatus, formatPortalDeadline } from "../admission/presentation";
import { HomeCardHead, HomeEmpty } from "./HomeParts";

/** Документы, которые ждут студента: не загружен, исправить, отклонён. */
const WAITING = new Set(["required", "correction_required", "rejected"]);
const SHOWN = 3;

/** Ждущие студента документы: сначала со сроком (ближайший первым), потом без срока, в порядке списка. */
export function waitingDocuments(documents: readonly StudentPortalDocument[]): StudentPortalDocument[] {
  return documents
    .filter((document) => WAITING.has(document.status))
    .map((document, index) => ({ document, index }))
    .sort((a, b) => (a.document.deadline ?? "￿").localeCompare(b.document.deadline ?? "￿") || a.index - b.index)
    .map(({ document }) => document);
}

/**
 * «Документы» на «Главной» клиента (09.11.2026, разбор кабинета: «чеклист документов под выбранный вуз с дедлайнами»):
 * сколько принято из списка дела и что ждёт студента сейчас — со сроком, если его поставил менеджер. Список ведёт
 * менеджер под вуз студента; отдельного списка «по вузу» в модели нет, поэтому здесь список дела, а не выдуманный.
 */
export function HomeDocuments({ documents, locale }: Readonly<{
  /** Список документов дела; `null` — чтение не удалось. */
  documents: readonly StudentPortalDocument[] | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const total = documents?.length ?? 0;
  const progress = documents ? documentProgress(documents) : null;
  const waiting = documents ? waitingDocuments(documents) : [];

  return (
    <section aria-labelledby="home-documents" className="pt-card pt-home-box pt-home-documents">
      <HomeCardHead
        id="home-documents"
        title={strings.docsHeading}
        action={total > 0 ? <IntentPrefetchLink className="pt-link" href="/portal/documents">{strings.docsAll}</IntentPrefetchLink> : null}
      />
      {documents === null ? (
        <p role="alert" className="pt-alert">{strings.docsUnavailable}</p>
      ) : total === 0 ? (
        <HomeEmpty icon="documents" title={strings.docsEmptyTitle} body={strings.docsEmptyBody} />
      ) : (
        <>
          <div className="pt-home-docs-progress">
            <p className="pt-home-docs-count">
              {formatPortalString(strings.docsAccepted, { done: String(progress?.approved ?? 0), total: String(total) })}
            </p>
            <span className="pt-home-docs-meter" aria-hidden="true">
              <span className="pt-home-docs-bar" style={{ width: `${Math.round(((progress?.approved ?? 0) / total) * 100)}%` }} />
            </span>
          </div>
          {waiting.length > 0 ? (
            <ul className="pt-home-docs-list">
              {waiting.slice(0, SHOWN).map((document) => {
                const due = formatPortalDeadline(document.deadline);
                return (
                  <li key={document.documentSlotId}>
                    <IntentPrefetchLink className="pt-home-docs-item" href={`/portal/documents#document-${document.documentSlotId}`}>
                      <span className="pt-home-docs-name">{document.requirementLabel}</span>
                      <span className="pt-home-docs-meta">
                        {documentStatus(document, admission).label}
                        {due ? <>{" · "}{admission.deadlineTerm}{" "}<time dateTime={document.deadline ?? undefined}>{due}</time></> : null}
                      </span>
                    </IntentPrefetchLink>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="pt-home-docs-done">{strings.docsDone}</p>
          )}
        </>
      )}
    </section>
  );
}
