import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { assessmentPath, type AssessmentCatalog } from "@/lib/student-assessment-contract";

/**
 * Каталог личных тестов в «Атласе» (PORT-8c): карточка на инструмент с
 * честным состоянием попытки и история завершённых попыток. Данные — E2 DTO
 * AssessmentCatalog без обёрток; подписи — неймспейс tests (RU байт-в-байт
 * прежние строки, KY полный). Заголовки инструментов — контент read model.
 */
export function TestsCatalog({ catalog, locale }: { catalog: AssessmentCatalog; locale: Locale }) {
  const strings = getPortalStrings("tests", locale);
  const dateFormat = new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru-RU", { dateStyle: "medium", timeZone: "UTC" });
  const completed = catalog.attempts.filter(a => a.status === "completed");
  return (
    <>
      {catalog.instruments.length === 0 ? (
        <div className="pt-empty">
          <p className="pt-empty-title">{strings.emptyTitle}</p>
          <p className="pt-empty-body">{strings.emptyBody}</p>
        </div>
      ) : (
        <div className="pt-tests-grid">
          {catalog.instruments.map(instrument => {
            const draft = catalog.attempts.find(a => a.attemptId === instrument.draftAttemptId);
            const current = instrument.draftAttemptId ?? instrument.latestCompletedAttemptId;
            const href = `${assessmentPath(instrument.instrumentKey)}${current ? `?attempt=${current}` : ""}`;
            return (
              <section key={instrument.instrumentKey} className="pt-test-card">
                <p className="pt-test-card-state">
                  {draft
                    ? formatPortalString(strings.cardDraft, { answered: String(draft.answeredCount), total: String(draft.questionCount) })
                    : instrument.latestCompletedAttemptId
                      ? strings.cardCompleted
                      : strings.cardNew}
                </p>
                <h2 className="pt-test-card-title">{instrument.metadata.title}</h2>
                <p className="pt-test-card-desc">{instrument.metadata.description}</p>
                <p className="pt-test-card-meta">{formatPortalString(strings.cardMeta, { count: String(instrument.questionCount) })}</p>
                <div className="pt-test-card-actions">
                  <Link href={href} className="pt-btn">
                    {draft ? strings.cardContinue : instrument.latestCompletedAttemptId ? strings.cardOpenResult : strings.cardStart}
                  </Link>
                  {instrument.latestCompletedAttemptId && !draft ? (
                    <Link href={`${assessmentPath(instrument.instrumentKey)}?new=1`} className="pt-link">
                      {strings.cardRetake}
                    </Link>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <section className="pt-tests-history">
        <h2 className="pt-section-title">{strings.historyHeading}</h2>
        <p className="pt-tests-history-note">{strings.historyNote}</p>
        <ul className="pt-tests-history-list">
          {completed.map(a => (
            <li key={a.attemptId}>
              <Link href={`${assessmentPath(a.instrumentKey)}?attempt=${a.attemptId}`} className="pt-tests-history-row">
                <span>
                  {formatPortalString(strings.historyItem, {
                    name: a.instrumentKey === "english36" ? strings.historyEnglish : strings.historyCareer,
                    version: a.version,
                  })}
                </span>
                <span className="pt-tests-history-date pt-data">
                  {a.completedAt ? dateFormat.format(new Date(a.completedAt)) : ""} <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
          {completed.length === 0 ? <li className="pt-tests-history-empty">{strings.historyEmpty}</li> : null}
        </ul>
      </section>
    </>
  );
}
