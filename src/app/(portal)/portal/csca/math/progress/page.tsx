import type { Metadata } from "next";
import Link from "next/link";

import { StateChip, TopicStrip } from "@/components/portal/csca/StateChip";
import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { cscaMomentDayLabel } from "@/lib/portal/csca";
import { readCscaHome, readCscaProgress } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings.progressTitle} · ${strings.title} · EVO Admissions` };
}

/**
 * «Прогресс» CSCA: learning_track_progress_v1 и главная трека (названия тем
 * и модулей) одной волной. Только слова контракта: «оценка EVO», без
 * баллов, шкал 0..100 и порогов. Прогресс видит только сам студент.
 */
export default async function CscaProgressPage() {
  const [, locale, progress, home] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaProgress().catch(() => null),
    readCscaHome().catch(() => null),
  ]);
  const strings = getPortalStrings("csca", locale);
  const ky = locale === "ky";

  const header = (
    <header className="cs-lesson-header">
      <p className="cs-back-row">
        <Link className="cs-back" href="/portal/csca">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {strings.backToHome}
        </Link>
      </p>
      <h1 className="pt-page-title">{strings.progressTitle}</h1>
      <p className="pt-page-lead">{strings.progressLead}</p>
    </header>
  );

  if (progress === null || home === null) {
    return (
      <main className="pt-page cs-page">
        {header}
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      </main>
    );
  }

  const topicMeta = new Map(home.topics.map((topic) => [topic.topicKey, topic.metadata]));
  const sections = home.modules[0]?.metadata.sections ?? [];
  const testTitle = new Map(home.tests.map((test) => [test.formKey, ky ? test.metadata.title_ky : test.metadata.title_ru]));
  const formIdByKey = new Map(home.tests.map((test) => [test.formKey, test.formId]));
  const { coverage, streak, pace, review } = progress;

  return (
    <main className="pt-page cs-page">
      {header}

      <section className="cs-sheet cs-overview" aria-label={strings.progressTitle}>
        <div className="cs-overview-item">
          <h2 className="cs-overview-title">{strings.coverageHeading}</h2>
          <p className="cs-overview-value">
            {formatPortalString(strings.coverageBody, {
              done: String(coverage.topicsWithCompletedLesson),
              total: String(coverage.topicsTotal),
            })}
          </p>
          <span className="cs-meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${coverage.topicsTotal > 0 ? coverage.topicsWithCompletedLesson / coverage.topicsTotal : 0})` }} />
          </span>
        </div>
        <div className="cs-overview-item">
          <h2 className="cs-overview-title">{strings.streakHeading}</h2>
          <p className="cs-overview-value">{formatPortalString(strings.streakCurrent, { count: String(streak.current) })}</p>
          <p className="cs-overview-note">
            {formatPortalString(strings.streakBest, { count: String(streak.best) })}. {strings.streakNote}
          </p>
        </div>
        <div className="cs-overview-item">
          <h2 className="cs-overview-title">{strings.paceHeading}</h2>
          {pace.avgSeconds === null ? (
            <p className="cs-overview-value">{strings.paceNone}</p>
          ) : (
            <>
              <p className="cs-overview-value">
                {formatPortalString(strings.paceBody, { avg: String(pace.avgSeconds), budget: String(pace.budgetSeconds) })}
              </p>
              <span className="cs-pace" aria-hidden="true">
                <span className="cs-pace-fill" style={{ transform: `scaleX(${Math.min(1, pace.avgSeconds / (pace.budgetSeconds * 2))})` }} />
                <span className="cs-pace-budget" />
              </span>
            </>
          )}
        </div>
        <div className="cs-overview-item">
          <h2 className="cs-overview-title">{strings.bankHeading}</h2>
          <p className="cs-overview-value">
            {formatPortalString(strings.bankBody, {
              due: String(review.dueCount),
              active: String(review.activeCount),
              retired: String(review.retiredCount),
            })}
          </p>
          {review.dueCount > 0 ? <Link className="cs-inline-link" href="/portal/csca/math/review">{strings.openReview}</Link> : null}
        </div>
      </section>

      <section className="cs-map" aria-labelledby="cs-progress-topics">
        <h2 id="cs-progress-topics" className="cs-section-title">{strings.topicsHeading}</h2>
        <p className="cs-section-lead">{strings.topicsLead}</p>
        {sections.map((section) => {
          const topics = progress.topics
            .filter((topic) => topic.section === section.section)
            .sort((a, b) => a.orderIndex - b.orderIndex);
          if (topics.length === 0) return null;
          return (
            <section key={section.section} className="cs-section-block" aria-labelledby={`cs-psection-${section.section}`}>
              <header className="cs-section-head">
                <h3 id={`cs-psection-${section.section}`} className="cs-section-name">
                  <span className="cs-section-n">{formatPortalString(strings.sectionLabel, { n: String(section.section) })}</span>
                  {ky ? section.title_ky : section.title_ru}
                </h3>
                <TopicStrip states={topics.map((topic) => topic.state)} />
              </header>
              <ul className="cs-topics cs-topics-progress">
                {topics.map((topic) => {
                  const meta = topicMeta.get(topic.topicKey);
                  return (
                    <li key={topic.topicKey} className="cs-topic" data-quiet={topic.answersTotal === 0 ? "" : undefined}>
                      <StateChip state={topic.state} strings={strings} />
                      <span className="cs-topic-title">{meta ? (ky ? meta.title_ky : meta.title_ru) : topic.topicKey}</span>
                      <span className="cs-topic-none cs-num">
                        {topic.answersTotal > 0
                          ? formatPortalString(strings.topicAnswers, {
                            total: String(topic.answersTotal),
                            correct: String(topic.correctTotal),
                          })
                          : ""}
                        {topic.lessonCompleted ? `${topic.answersTotal > 0 ? " · " : ""}${strings.topicLessonDone}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </section>

      <section className="cs-history" aria-labelledby="cs-history-title">
        <h2 id="cs-history-title" className="cs-section-title">{strings.testsHistoryHeading}</h2>
        {progress.tests.length === 0 ? (
          <p className="cs-section-lead">{strings.testsHistoryEmpty}</p>
        ) : (
          <div className="cs-table-wrap" role="region" aria-labelledby="cs-history-title" tabIndex={0}>
            <table className="cs-table cs-history-table">
              <thead>
                <tr>
                  <th scope="col">{strings.testsHistoryDate}</th>
                  <th scope="col">{strings.testsHistoryTest}</th>
                  <th scope="col">{strings.testsHistoryResult}</th>
                  <th scope="col">{strings.testsHistoryHow}</th>
                  <th scope="col"><span className="pt-sr-only">{strings.testOpenResult}</span></th>
                </tr>
              </thead>
              <tbody>
                {progress.tests.map((test) => {
                  const formId = formIdByKey.get(test.formKey);
                  return (
                    <tr key={test.attemptId}>
                      <td className="pt-data">{cscaMomentDayLabel(test.completedAt, locale)}</td>
                      <th scope="row">{testTitle.get(test.formKey) ?? test.formKey}</th>
                      <td className="cs-num">
                        {formatPortalString(strings.tallyLabel, { correct: String(test.correctCount), total: String(test.itemsTotal) })}
                      </td>
                      <td>{strings[`completion.${test.completion}`]}</td>
                      <td>
                        {formId ? (
                          <Link className="cs-inline-link" href={`/portal/csca/math/test/${formId}?attempt=${test.attemptId}`}>
                            {strings.testOpenResult}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="cs-own-inline">{strings.resultCaption}</p>
      </section>
    </main>
  );
}
