import type { Metadata } from "next";
import Link from "next/link";

import { LessonCover } from "@/components/portal/english/LessonCover";
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
        <h1 className="pt-page-title">{strings.title}</h1>
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
          <section key={module.moduleId} className="pt-learn-module" aria-labelledby={`module-${module.moduleId}`}>
            {/* Модуль: название, прогресс полосой и вход в тест — без описаний (03.11.2026). */}
            <div className="pt-learn-head">
              <div className="pt-learn-head-main">
                <h2 id={`module-${module.moduleId}`} className="pt-section-title">
                  {locale === "ky" ? module.metadata.title_ky : module.metadata.title_ru}
                </h2>
                <p id={`module-progress-${module.moduleId}`} className="pt-learn-progress">
                  {formatPortalString(strings.progress, {
                    done: String(module.lessonsCompleted),
                    total: String(module.lessonsTotal),
                  })}
                </p>
                <progress
                  className="pt-progress"
                  value={module.lessonsCompleted}
                  max={Math.max(module.lessonsTotal, 1)}
                  aria-labelledby={`module-progress-${module.moduleId}`}
                />
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
              </div>
            </div>

            {/* Уроки плитками: обложка с фото темы, название и число заданий; плитка — ссылка на урок. */}
            <ol className="pt-lesson-grid">
              {module.lessons.map((lesson) => {
                const state = lesson.completed ? "done" : lesson.draftAttemptId ? "draft" : "new";
                return (
                  <li key={lesson.lessonId}>
                    <Link
                      className="pt-lesson-tile"
                      data-state={state}
                      href={`/portal/english/lesson/${lesson.lessonId}`}
                    >
                      <LessonCover lessonKey={lesson.lessonKey} orderIndex={lesson.orderIndex} />
                      <span className="pt-lesson-tile-body">
                        <span className="pt-lesson-tile-title">
                          {locale === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru}
                        </span>
                        <span className="pt-lesson-tile-meta">
                          <span className="pt-sr-only">
                            {formatPortalString(strings.lessonLabel, { n: String(lesson.orderIndex) })}{" · "}
                          </span>
                          {formatPortalString(strings.exercisesCount, { count: String(lesson.exercisesTotal) })}
                        </span>
                        {state === "new" ? null : (
                          <span className="pt-chip pt-lesson-tile-state">
                            {state === "done" ? strings.statusCompleted : strings.statusDraft}
                            {lesson.lastResult
                              ? ` · ${formatPortalString(strings.lastResult, {
                                correct: String(lesson.lastResult.correctCount),
                                total: String(lesson.lastResult.exercisesTotal),
                              })}`
                              : null}
                          </span>
                        )}
                      </span>
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
