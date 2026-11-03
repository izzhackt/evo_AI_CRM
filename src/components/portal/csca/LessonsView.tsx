import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import {
  cscaDayLabel,
  cscaMomentDayLabel,
  daysBetween,
  type CscaHome,
  type CscaLessonSummary,
  type CscaTestSummary,
  type CscaTopic,
} from "@/lib/portal/csca";

import { durationLabel } from "./format";
import { sessionLabels, type SessionLabels } from "./session-labels";
import { StateChip, TopicStrip } from "./StateChip";

type Strings = PortalStrings<"csca">;
type Track = CscaHome["modules"][number];

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

  // «Следующий шаг» входит в сам заголовок (без ярлыка над ним): новичок
  // сразу читает, что это шаг занятий, а не название раздела (critique F5).
  return (
    <section id="cs-next" className="cs-next" aria-labelledby="cs-next-title">
      <h2 id="cs-next-title" className="cs-next-title">
        <span className="cs-next-lead">{strings.nextStepLabel}: </span>
        {title}
      </h2>
      <p className="cs-next-why">{why}</p>
      {meta.length > 0 ? (
        <p className="cs-next-meta">
          {meta.map((entry) => <span key={entry} className="cs-chip">{entry}</span>)}
        </p>
      ) : null}
      {action ? <Link className="pt-btn cs-next-action" href={action.href}>{action.label}</Link> : null}
    </section>
  );
}

function Arrow() {
  return (
    <svg className="cs-stat-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h10m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Три плитки под следующим шагом (по образцу кабинета пользователя): крупное
 * число и подпись. Темы с пройденным уроком, ошибки к повторению сегодня и
 * дни до ближайшей сессии csca.cn (ведёт к календарю во вкладке «Об
 * экзамене»); каждая плитка — ссылка на свой раздел.
 */
function Tiles({ home, labels, locale, strings }: {
  home: CscaHome;
  labels: SessionLabels;
  locale: Locale;
  strings: Strings;
}) {
  const done = home.topics.filter((topic) => topic.lessonCompleted).length;
  const total = home.topics.length;
  const due = home.review.dueCount;
  const next = [...home.sessions]
    .sort((a, b) => a.examFrom.localeCompare(b.examFrom))
    .find((session) => daysBetween(home.today, session.examFrom) >= 0) ?? null;
  const days = next ? daysBetween(home.today, next.examFrom) : null;
  const form = days === null ? "many" : new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(days);
  const unit = strings[form === "one" ? "tile.days.one" : form === "few" ? "tile.days.few" : "tile.days.many"];

  return (
    <div className="cs-stats">
      <Link className="cs-stat" href="/portal/csca/math/progress">
        <span className="cs-stat-head">{strings["tile.topics"]}<Arrow /></span>
        <span className="cs-stat-value cs-num">{done}<span className="cs-stat-unit">/ {total}</span></span>
        <span className="cs-stat-note">{strings["tile.topicsNote"]}</span>
        <span className="cs-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${total > 0 ? done / total : 0})` }} />
        </span>
      </Link>
      <Link className="cs-stat" href="/portal/csca/math/review">
        <span className="cs-stat-head">{strings.reviewHeading}<Arrow /></span>
        <span className="cs-stat-value cs-num">{due}</span>
        <span className="cs-stat-note">{strings["tile.reviewNote"]}</span>
      </Link>
      <Link className="cs-stat" href="/portal/csca#cs-sessions">
        <span className="cs-stat-head">{strings["tile.exam"]}<Arrow /></span>
        {next && days !== null ? (
          <>
            <span className="cs-stat-value cs-num">
              {days === 0 ? strings["tile.examToday"] : <>{days}<span className="cs-stat-unit">{unit}</span></>}
            </span>
            <span className="cs-stat-note">{labels[next.sessionKey]?.dates ?? cscaDayLabel(next.examFrom, locale)}</span>
          </>
        ) : (
          <>
            <span className="cs-stat-value cs-stat-empty" aria-hidden="true">·</span>
            <span className="cs-stat-note">{strings["tile.examNone"]}</span>
          </>
        )}
      </Link>
    </div>
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
          {last ? (
            <>
              {" · "}
              <Link className="cs-inline-link" href={`${testHref(test.formId)}?attempt=${last.attemptId}`}>
                {formatPortalString(strings.testLast, {
                  date: cscaMomentDayLabel(last.completedAt, locale),
                  correct: String(last.correctCount),
                  total: String(last.itemsTotal),
                })}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <Link className="pt-btn-ghost" href={testHref(test.formId)}>
        {test.draft ? strings.testContinue : last ? strings.repeat : strings.testStart}
      </Link>
    </li>
  );
}

/** Тема — одна строка: состояние словом, название и по кнопке на урок и практику. */
function TopicRow({ topic, lessons, locale, strings }: {
  topic: CscaTopic;
  lessons: CscaLessonSummary[];
  locale: Locale;
  strings: Strings;
}) {
  return (
    <li className="cs-trow">
      <div className="cs-trow-main">
        <h4 className="cs-trow-title">{locale === "ky" ? topic.metadata.title_ky : topic.metadata.title_ru}</h4>
        <StateChip state={topic.state} strings={strings} />
      </div>
      <div className="cs-trow-actions">
        {lessons.map((lesson) => {
          const status = lesson.draftAttemptId ? strings.lessonStarted : lesson.completed ? strings.lessonDone : null;
          return (
            <Link key={lesson.lessonId} className="cs-tbtn" data-done={lesson.completed ? "" : undefined} href={lessonHref(lesson.lessonId)}>
              <span className="cs-tbtn-kind">{strings[`kind.${lesson.metadata.kind}`]}</span>
              <span className="cs-tbtn-meta">
                {formatPortalString(strings.minutes, { n: String(lesson.metadata.est_minutes) })}
                {status ? ` · ${status}` : null}
              </span>
            </Link>
          );
        })}
      </div>
    </li>
  );
}

/**
 * Программа по модулям: каждый модуль свёрнут в строку (номер, название,
 * сколько тем пройдено, полоса состояний); открыт тот, где следующий шаг.
 * Темы без уроков — одной строкой «Темы без уроков: N» внутри модуля.
 */
function Program({ home, track, locale, strings }: { home: CscaHome; track: Track; locale: Locale; strings: Strings }) {
  const ky = locale === "ky";
  const lessonsOf = (topicKey: string) => home.lessons
    .filter((lesson) => lesson.metadata.topic_key === topicKey)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const nextTopic = home.nextStep?.kind === "lesson" ? home.nextStep.topicKey : null;
  const sections = track.metadata.sections
    .map((section) => ({
      section,
      topics: home.topics
        .filter((topic) => topic.metadata.section === section.section)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    }))
    .filter((entry) => entry.topics.length > 0);
  const openIndex = Math.max(0, sections.findIndex((entry) => entry.topics.some((topic) => topic.topicKey === nextTopic)));

  return (
    <section className="cs-program" aria-labelledby="cs-program-title">
      <h2 id="cs-program-title" className="cs-section-title">{strings.topicsHeading}</h2>
      {sections.map(({ section, topics }, index) => {
        const rich = topics.filter((topic) => topic.hasLessons && lessonsOf(topic.topicKey).length > 0);
        const quiet = topics.filter((topic) => !rich.includes(topic));
        const done = topics.filter((topic) => topic.lessonCompleted).length;
        return (
          <details key={section.section} className="cs-mod" open={index === openIndex}>
            <summary className="cs-mod-head">
              <span className="cs-mod-n">{formatPortalString(strings.sectionLabel, { n: String(section.section) })}</span>
              <span className="cs-mod-title">{ky ? section.title_ky : section.title_ru}</span>
              <span className="cs-mod-done">{formatPortalString(strings.moduleDone, { done: String(done), total: String(topics.length) })}</span>
              <TopicStrip states={topics.map((topic) => topic.state)} />
              <svg className="cs-mod-chevron" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            {rich.length > 0 ? (
              <ul className="cs-trows">
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
          </details>
        );
      })}
    </section>
  );
}

/**
 * Вкладка «Занятия» (03.11.2026, разгрузка страницы CSCA): следующий шаг,
 * три плитки с числами, тесты на время, программа по модулям.
 * Те же данные learning_track_home_v1, что и раньше; описания и легенда ушли
 * с экрана.
 */
export function CscaLessonsView({ home, track, locale, strings }: {
  home: CscaHome;
  track: Track;
  locale: Locale;
  strings: Strings;
}) {
  const labels = sessionLabels(home.sessions, locale, strings, { serverNow: home.serverNow, today: home.today });
  return (
    <div className="cs-lessons">
      <NextStep home={home} locale={locale} strings={strings} />
      <Tiles home={home} labels={labels} locale={locale} strings={strings} />
      {home.tests.length > 0 ? (
        <section className="cs-panel cs-tests" aria-labelledby="cs-tests-title">
          <h2 id="cs-tests-title" className="cs-panel-title">{strings.testsHeading}</h2>
          <ul className="cs-test-rows">
            {home.tests.map((test) => <TestRow key={test.formId} test={test} locale={locale} strings={strings} />)}
          </ul>
        </section>
      ) : null}
      <Program home={home} track={track} locale={locale} strings={strings} />
    </div>
  );
}
