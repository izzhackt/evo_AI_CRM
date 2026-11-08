import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LessonRunner } from "@/components/portal/english/LessonRunner";
import { LESSON_COVERS } from "@/components/portal/english/lesson-cover-files";
import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { isLearningUuid, type LearningLessonView } from "@/lib/portal/learning";
import { LearningSourceError, readLearningLesson } from "@/lib/portal/learning-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("english", await getLocale());
  return { title: `${strings.lessonTitle} — EVO Admissions` };
}

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

  const cover = view ? LESSON_COVERS[view.lesson.lessonKey] : undefined;

  // 08.11.2026 (пользователь: «ещё стильнее и нужно уцентровать блок»): урок — одна колонка по центру, сверху фото темы
  // урока, как на его плитке; цель урока одна — в карточке объяснения, без повтора под заголовком.
  return (
    <main className="pt-page pt-study-page">
      <header className="pt-page-header">
        <p className="pt-lesson-back">
          <Link className="pt-link" href="/portal/english">
            <span aria-hidden="true">←</span>
            {strings.backToModule}
          </Link>
        </p>
        {cover ? (
          <div className="pt-lesson-hero" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- статический WebP 720 px из сборки, как у плитки урока */}
            <img src={cover.photo.src} width={cover.photo.width} height={cover.photo.height} alt="" decoding="async" />
            <span className="pt-lesson-label">{cover.label}</span>
          </div>
        ) : null}
        {view ? (
          <h1 className="pt-page-title">
            {formatPortalString(strings.lessonLabel, { n: String(view.lesson.orderIndex) })}
            {". "}
            {locale === "ky" ? view.lesson.metadata.title_ky : view.lesson.metadata.title_ru}
          </h1>
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
