import type { Metadata } from "next";
import Link from "next/link";

import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import type { LearningModule } from "@/lib/portal/learning";
import { readLearningModules, readLearningReview } from "@/lib/portal/learning-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("english", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Раздел «Английский» (PORT-4c): карта модуля со своим прогрессом, вход в
 * повторение ошибок и в тест english36. Прогресс — реальные завершённые
 * попытки движка 198, без выдуманных процентов готовности (план §6).
 */
export default async function EnglishPage() {
  const [, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const strings = getPortalStrings("english", locale);

  let modules: LearningModule[] | null = null;
  try {
    modules = await readLearningModules();
  } catch {
    modules = null;
  }

  // Размер собственного банка ошибок; его сбой не роняет карту уроков.
  let reviewCount = 0;
  if (modules && modules.length > 0) {
    try {
      reviewCount = (await readLearningReview(modules[0].moduleId)).length;
    } catch {
      reviewCount = 0;
    }
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>

      {modules === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : modules.length === 0 ? (
        <div className="pt-empty">
          <p className="pt-empty-title">{strings.emptyTitle}</p>
          <p className="pt-empty-body">{strings.emptyBody}</p>
        </div>
      ) : (
        modules.map((module) => (
          <section key={module.moduleId} className="pt-learn-module">
            <div className="pt-learn-summary">
              <h2 className="pt-section-title">
                {locale === "ky" ? module.metadata.title_ky : module.metadata.title_ru}
              </h2>
              <p className="pt-learn-note">
                {locale === "ky" ? module.metadata.level_note_ky : module.metadata.level_note_ru}
              </p>
              <p className="pt-learn-progress pt-data">
                {formatPortalString(strings.progress, {
                  done: String(module.lessonsCompleted),
                  total: String(module.lessonsTotal),
                })}
              </p>
            </div>

            <div className="pt-learn-entries">
              {reviewCount > 0 ? (
                <Link className="pt-btn" href="/portal/english/review">
                  {strings.reviewEntry}
                </Link>
              ) : null}
              <Link className="pt-btn-ghost" href="/portal/tests/english">
                {strings.testEntry}
              </Link>
              <p className="pt-learn-note">{strings.testEntryHint}</p>
            </div>

            <ol className="pt-lesson-list">
              {module.lessons.map((lesson) => {
                const status = lesson.completed
                  ? strings.statusCompleted
                  : lesson.draftAttemptId
                    ? strings.statusDraft
                    : strings.statusNew;
                const action = lesson.draftAttemptId
                  ? strings.continueLesson
                  : lesson.completed
                    ? strings.repeatLesson
                    : strings.startLesson;
                return (
                  <li key={lesson.lessonId} className="pt-lesson-row">
                    <div className="pt-lesson-row-body">
                      <p className="pt-lesson-row-kicker pt-data">
                        {formatPortalString(strings.lessonLabel, { n: String(lesson.orderIndex) })}
                        {" · "}
                        {formatPortalString(strings.exercisesCount, {
                          count: String(lesson.exercisesTotal),
                        })}
                      </p>
                      <h3 className="pt-lesson-row-title">
                        {locale === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru}
                      </h3>
                      <p className="pt-lesson-row-goal">
                        {locale === "ky" ? lesson.metadata.goal_ky : lesson.metadata.goal_ru}
                      </p>
                      <p className="pt-lesson-row-status">
                        <span className="pt-chip">{status}</span>
                        {lesson.lastResult ? (
                          <span className="pt-data">
                            {formatPortalString(strings.lastResult, {
                              correct: String(lesson.lastResult.correctCount),
                              total: String(lesson.lastResult.exercisesTotal),
                            })}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Link
                      className="pt-btn-ghost"
                      href={`/portal/english/lesson/${lesson.lessonId}`}
                    >
                      {action}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </main>
  );
}
