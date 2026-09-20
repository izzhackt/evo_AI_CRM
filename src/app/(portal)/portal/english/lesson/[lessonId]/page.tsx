import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LessonRunner } from "@/components/portal/english/LessonRunner";
import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { isLearningUuid, type LearningLessonView } from "@/lib/portal/learning";
import { LearningSourceError, readLearningLesson } from "@/lib/portal/learning-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Урок английского — EVO Admissions" };

/**
 * Урок (PORT-4c): безопасная проекция контента + собственный черновик из
 * learning_lesson_v1; механика — в клиентском LessonRunner. Несуществующий
 * или чужой id неразличимы (42501 у RPC) и дают честный 404.
 */
export default async function EnglishLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const [{ lessonId }, , locale] = await Promise.all([
    params,
    requireStudentPortalActor(),
    getLocale(),
  ]);
  if (!isLearningUuid(lessonId)) notFound();
  const strings = getPortalStrings("english", locale);

  let view: LearningLessonView | null = null;
  try {
    view = await readLearningLesson(lessonId);
  } catch (error) {
    if (error instanceof LearningSourceError && error.code === "denied") notFound();
    view = null;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">
          <Link className="pt-link" href="/portal/english">{strings.backToModule}</Link>
        </p>
        {view ? (
          <>
            <h1 className="pt-page-title">
              {formatPortalString(strings.lessonLabel, { n: String(view.lesson.orderIndex) })}
              {". "}
              {locale === "ky" ? view.lesson.metadata.title_ky : view.lesson.metadata.title_ru}
            </h1>
            <p className="pt-page-lead">
              {locale === "ky" ? view.lesson.metadata.goal_ky : view.lesson.metadata.goal_ru}
            </p>
          </>
        ) : (
          <h1 className="pt-page-title">{strings.title}</h1>
        )}
      </header>
      {view === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <LessonRunner view={view} locale={locale} strings={strings} />
      )}
    </main>
  );
}
