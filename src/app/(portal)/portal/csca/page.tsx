import type { Metadata } from "next";
import Link from "next/link";

import { SessionPicker } from "@/components/portal/csca/SessionPicker";
import { sessionLabels } from "@/components/portal/csca/session-labels";
import { StateChip, TopicStrip } from "@/components/portal/csca/StateChip";
import { durationLabel } from "@/components/portal/csca/format";
import { getLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import {
  cscaDayLabel,
  type CscaHome,
  type CscaLessonSummary,
  type CscaTestSummary,
  type CscaTopic,
} from "@/lib/portal/csca";
import { readCscaHome } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings.title} · EVO Admissions` };
}

type Strings = PortalStrings<"csca">;

const lessonHref = (lessonId: string) => `/portal/csca/math/lesson/${lessonId}`;
const testHref = (formId: string) => `/portal/csca/math/test/${formId}`;

function lessonAction(lesson: CscaLessonSummary, strings: Strings): string {
  if (lesson.draftAttemptId) return strings.continue;
  if (lesson.completed) return strings.repeat;
  return lesson.metadata.kind === "practice" ? strings.startPractice : strings.startLesson;
}

function NextStep({ home, locale, strings }: { home: CscaHome; locale: Locale; strings: Strings }) {
  const ky = locale === "ky";
  const step = home.nextStep;
  let title: string = strings["nextStep.noneTitle"];
  let titleEn: string | null = null;
  let why: string = strings["nextStep.noneWhy"];
  let meta: string[] = [];
  let action: { href: string; label: string } | null = null;

  if (step?.kind === "test") {
    const test = home.tests.find((entry) => entry.formId === step.formId);
    if (test) {
      title = ky ? test.metadata.title_ky : test.metadata.title_ru;
      why = strings["nextStep.testWhy"];
      meta = [
        formatPortalString(strings.testItems, { count: String(test.itemsTotal) }),
        durationLabel(test.durationSeconds, strings),
      ];
      action = { href: testHref(test.formId), label: test.draft ? strings.testResume : strings.testBegin };
    }
  } else if (step?.kind === "lesson") {
    const lesson = home.lessons.find((entry) => entry.lessonId === step.lessonId);
    const topic = home.topics.find((entry) => entry.topicKey === step.topicKey);
    if (lesson) {
      title = ky ? lesson.metadata.title_ky : lesson.metadata.title_ru;
      titleEn = lesson.metadata.title_en;
      why = strings[`nextStep.why.${topic?.state ?? step.topicState}`];
      meta = [
        strings[`kind.${lesson.metadata.kind}`],
        formatPortalString(strings.minutes, { n: String(lesson.metadata.est_minutes) }),
        formatPortalString(strings.itemsCount, { count: String(lesson.exercisesTotal) }),
      ];
      action = { href: lessonHref(lesson.lessonId), label: lessonAction(lesson, strings) };
    }
  } else if (step?.kind === "review") {
    title = strings["nextStep.reviewTitle"];
    why = strings["nextStep.reviewWhy"];
    meta = [formatPortalString(strings.reviewDue, { count: String(home.review.dueCount) })];
    action = { href: "/portal/csca/math/review", label: strings.openReview };
  }

  return (
    <section className="cs-next" aria-labelledby="cs-next-title">
      <h2 id="cs-next-title" className="cs-next-title">
        <span className="pt-sr-only">{strings.nextStepLabel}: </span>
        {title}
      </h2>
      {titleEn ? <p className="cs-next-en" lang="en">{titleEn}</p> : null}
      <p className="cs-next-why">{why}</p>
      <p className="cs-next-meta">
        <span className="cs-chip cs-chip-accent" aria-hidden="true">{strings.nextStepLabel}</span>
        {meta.map((entry) => <span key={entry} className="cs-chip">{entry}</span>)}
      </p>
      {action ? <Link className="pt-btn cs-next-action" href={action.href}>{action.label}</Link> : null}
    </section>
  );
}

function TopicLessons({ lessons, strings }: { lessons: CscaLessonSummary[]; strings: Strings }) {
  return (
    <ul className="cs-topic-lessons">
      {lessons.map((lesson) => {
        const status = lesson.draftAttemptId ? strings.lessonStarted : lesson.completed ? strings.lessonDone : null;
        return (
          <li key={lesson.lessonId}>
            <Link className="cs-lesson-link" href={lessonHref(lesson.lessonId)}>
              <span className="cs-lesson-kind">{strings[`kind.${lesson.metadata.kind}`]}</span>
              <span className="cs-lesson-facts">
                {formatPortalString(strings.minutes, { n: String(lesson.metadata.est_minutes) })}
                {" · "}
                {formatPortalString(strings.itemsCount, { count: String(lesson.exercisesTotal) })}
                {status ? <> · <span className="cs-lesson-status">{status}</span></> : null}
                {lesson.lastResult ? (
                  <> · {formatPortalString(strings.lessonLast, {
                    correct: String(lesson.lastResult.correctCount),
                    total: String(lesson.lastResult.exercisesTotal),
                  })}</>
                ) : null}
              </span>
              <span className="cs-lesson-go">
                {lessonAction(lesson, strings)}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopicRow({
  topic,
  lessons,
  locale,
  strings,
}: {
  topic: CscaTopic;
  lessons: CscaLessonSummary[];
  locale: Locale;
  strings: Strings;
}) {
  const ky = locale === "ky";
  const title = ky ? topic.metadata.title_ky : topic.metadata.title_ru;
  return (
    <li className="cs-topic" data-rich="">
      <div className="cs-topic-head">
        <StateChip state={topic.state} strings={strings} />
        <h4 className="cs-topic-title">{title}</h4>
        {topic.windowAnswers > 0 ? (
          <span className="cs-topic-window pt-data">
            {formatPortalString(strings.topicWindow, {
              correct: String(topic.windowCorrect),
              total: String(topic.windowAnswers),
            })}
          </span>
        ) : null}
      </div>
      <p className="cs-topic-en" lang="en">{topic.metadata.title_en}</p>
      <TopicLessons lessons={lessons} strings={strings} />
    </li>
  );
}

/**
 * Темы раздела: темы с уроками карточками, остальные свёрнуты в одну строку
 * «Темы без уроков: N» (25 одинаковых строк «Уроков пока нет» заслоняли
 * три темы, где можно учиться, а на телефоне растягивали экран на метры).
 */
function SectionTopics({
  topics,
  lessons,
  locale,
  strings,
}: {
  topics: CscaTopic[];
  lessons: CscaLessonSummary[];
  locale: Locale;
  strings: Strings;
}) {
  const ky = locale === "ky";
  const lessonsOf = (topicKey: string) => lessons
    .filter((lesson) => lesson.metadata.topic_key === topicKey)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const rich = topics.filter((topic) => topic.hasLessons && lessonsOf(topic.topicKey).length > 0);
  const quiet = topics.filter((topic) => !rich.includes(topic));
  return (
    <>
      {rich.length > 0 ? (
        <ul className="cs-topics">
          {rich.map((topic) => (
            <TopicRow key={topic.topicKey} topic={topic} lessons={lessonsOf(topic.topicKey)} locale={locale} strings={strings} />
          ))}
        </ul>
      ) : null}
      {quiet.length > 0 ? (
        <details className="cs-quiet-topics">
          <summary>
            <span>{formatPortalString(strings.quietTopics, { count: String(quiet.length) })}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <ul className="cs-quiet-list">
            {quiet.map((topic) => (
              <li key={topic.topicKey}>
                <span className="cs-topic-title">{ky ? topic.metadata.title_ky : topic.metadata.title_ru}</span>
                {topic.state !== "not_started" ? <StateChip state={topic.state} strings={strings} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function TestRow({ test, locale, strings }: { test: CscaTestSummary; locale: Locale; strings: Strings }) {
  const ky = locale === "ky";
  const last = test.lastResult;
  return (
    <li className="cs-test-row">
      <div className="cs-test-row-body">
        <h3 className="cs-test-row-title">{ky ? test.metadata.title_ky : test.metadata.title_ru}</h3>
        <p className="cs-test-row-meta">
          {formatPortalString(strings.testItems, { count: String(test.itemsTotal) })}
          {" · "}
          {durationLabel(test.durationSeconds, strings)}
        </p>
        <p className="cs-test-row-rule">{test.allowEarlyFinish ? strings.testEarly : strings.testNoEarly}</p>
        {last ? (
          <p className="cs-test-row-last">
            {formatPortalString(strings.testLast, {
              date: cscaDayLabel(last.completedAt, locale),
              correct: String(last.correctCount),
              total: String(last.itemsTotal),
            })}
            {" · "}
            <Link className="cs-inline-link" href={`${testHref(test.formId)}?attempt=${last.attemptId}`}>{strings.testOpenResult}</Link>
          </p>
        ) : null}
      </div>
      <Link className="pt-btn-ghost" href={testHref(test.formId)}>
        {test.draft ? strings.testContinue : last ? strings.repeat : strings.testStart}
      </Link>
    </li>
  );
}

/**
 * «CSCA» (S5.1): один вызов learning_track_home_v1 на экран. Предметы
 * (математика сейчас, физика и химия позже, без дат), следующий шаг по
 * правилу §12 контракта, карта тем по модулям программы, тесты на время,
 * «Ошибки», «Прогресс» и официальный календарь сессий.
 */
export default async function CscaHomePage() {
  const [, locale, home] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaHome().catch(() => null),
  ]);
  const strings = getPortalStrings("csca", locale);
  const ky = locale === "ky";
  const track = home?.modules[0] ?? null;

  return (
    <main className="pt-page cs-page">
      <header className="cs-home-header">
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
        <ul className="cs-subjects" aria-label={strings.subjectsLabel}>
          <li data-current="" aria-current="true">
            <span className="cs-subject-name">{strings["subject.math"]}</span>
            {home ? (
              <span className="cs-subject-note pt-data">{formatPortalString(strings.subjectTopics, { count: String(home.topics.length) })}</span>
            ) : null}
          </li>
          <li>
            <span className="cs-subject-name">{strings["subject.physics"]}</span>
            <span className="cs-subject-note">{strings.subjectLater}</span>
          </li>
          <li>
            <span className="cs-subject-name">{strings["subject.chemistry"]}</span>
            <span className="cs-subject-note">{strings.subjectLater}</span>
          </li>
        </ul>
      </header>

      {home === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : track === null ? (
        <div className="pt-empty">
          <p className="pt-empty-title">{strings.emptyTitle}</p>
          <p className="pt-empty-body">{strings.emptyBody}</p>
        </div>
      ) : (
        <div className="cs-home">
          <NextStep home={home} locale={locale} strings={strings} />
          <aside className="cs-home-aside">
            {home.tests.length > 0 ? (
              <section className="cs-panel" aria-labelledby="cs-tests-title">
                <h2 id="cs-tests-title" className="cs-panel-title">{strings.testsHeading}</h2>
                <ul className="cs-test-rows">
                  {home.tests.map((test) => <TestRow key={test.formId} test={test} locale={locale} strings={strings} />)}
                </ul>
              </section>
            ) : null}

            <section className="cs-panel" aria-labelledby="cs-review-title">
              <h2 id="cs-review-title" className="cs-panel-title">{strings.reviewHeading}</h2>
              <p className="cs-panel-strong">
                {home.review.dueCount > 0
                  ? formatPortalString(strings.reviewDue, { count: String(home.review.dueCount) })
                  : strings.reviewNone}
              </p>
              <p className="cs-panel-lead">
                {home.review.activeCount > 0
                  ? [
                    formatPortalString(strings.reviewActive, { count: String(home.review.activeCount) }),
                    home.review.dueCount === 0 && home.review.nextDueOn
                      ? formatPortalString(strings.reviewNext, { date: cscaDayLabel(home.review.nextDueOn, locale) })
                      : null,
                  ].filter(Boolean).join(". ")
                  : strings.reviewEmptyBank}
              </p>
              {home.review.dueCount > 0 ? (
                <Link className="pt-btn-ghost" href="/portal/csca/math/review">{strings.openReview}</Link>
              ) : null}
            </section>

            <section className="cs-panel" aria-labelledby="cs-progress-title">
              <h2 id="cs-progress-title" className="cs-panel-title">{strings.progressHeading}</h2>
              <ProgressGlance home={home} strings={strings} />
              <Link className="cs-inline-link" href="/portal/csca/math/progress">{strings.progressOpen}</Link>
            </section>

            <SessionPicker
              sessions={home.sessions}
              labels={sessionLabels(home.sessions, locale, strings)}
              verifiedLabel={cscaDayLabel(home.sessions.map((session) => session.verifiedOn).sort().at(-1) ?? home.today, locale, true)}
              initialTarget={home.targetSessionKey}
              today={home.today}
              strings={strings}
            />
          </aside>
          <section className="cs-map" aria-labelledby="cs-map-title">
            <h2 id="cs-map-title" className="cs-section-title">{strings.topicsHeading}</h2>
            <p className="cs-section-lead">{strings.topicsLead}</p>
            <p className="cs-legend" aria-label={strings.stateLegend}>
              {(["confident", "shaky", "gap", "few_data", "not_started"] as const).map((state) => (
                <StateChip key={state} state={state} strings={strings} />
              ))}
            </p>
            {track.metadata.sections.map((section) => {
              const topics = home.topics
                .filter((topic) => topic.metadata.section === section.section)
                .sort((a, b) => a.orderIndex - b.orderIndex);
              if (topics.length === 0) return null;
              return (
                <section key={section.section} className="cs-section-block" aria-labelledby={`cs-section-${section.section}`}>
                  <header className="cs-section-head">
                    <h3 id={`cs-section-${section.section}`} className="cs-section-name">
                      <span className="cs-section-n">{formatPortalString(strings.sectionLabel, { n: String(section.section) })}</span>
                      {ky ? section.title_ky : section.title_ru}
                    </h3>
                    <p className="cs-section-en" lang="en">{section.title_en}</p>
                    <p className="cs-section-weight">
                      {formatPortalString(strings.sectionWeight, { count: String(section.mock_items_estimate) })}
                    </p>
                    <TopicStrip states={topics.map((topic) => topic.state)} />
                  </header>
                  <SectionTopics topics={topics} lessons={home.lessons} locale={locale} strings={strings} />
                </section>
              );
            })}
          </section>
        </div>
      )}

      <footer className="cs-own">
        <p>{strings.ownWork}</p>
        {track ? (
          <a className="pt-link" href={track.metadata.syllabus_url} target="_blank" rel="noopener noreferrer">
            {strings.syllabusLink}
          </a>
        ) : null}
      </footer>
    </main>
  );
}

function ProgressGlance({ home, strings }: { home: CscaHome; strings: Strings }) {
  const done = home.topics.filter((topic) => topic.lessonCompleted).length;
  const total = home.topics.length;
  return (
    <div className="cs-glance">
      <p className="cs-glance-line">
        {formatPortalString(strings.progressCoverage, { done: String(done), total: String(total) })}
      </p>
      <span className="cs-meter" aria-hidden="true">
        <span style={{ transform: `scaleX(${total > 0 ? done / total : 0})` }} />
      </span>
    </div>
  );
}
