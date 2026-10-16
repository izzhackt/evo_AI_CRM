import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ItemRunner, type ItemRunnerLink } from "@/components/portal/csca/ItemRunner";
import { MathText } from "@/components/portal/csca/MathText";
import { TheoryBlocks, theoryBlockId, theoryBlockLabel } from "@/components/portal/csca/TheoryBlocks";
import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { isCscaUuid, type CscaLessonSummary, type CscaLessonView } from "@/lib/portal/csca";
import { CscaSourceError, readCscaLesson, readCscaModuleLessons } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";

/** Оглавление: разборы, ошибки, совет, термины и первое появление формул, рисунка, таблицы. */
function tocEntry(theory: CscaLessonView["lesson"]["theory"], index: number): boolean {
  const kind = theory[index].kind;
  if (kind === "idea") return false;
  if (kind === "formula" || kind === "figure" || kind === "table" || kind === "interactive") {
    return theory.findIndex((block) => block.kind === kind) === index;
  }
  return true;
}
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings["kind.lesson"]} · ${strings.title} · EVO Admissions` };
}

/**
 * Урок или практика CSCA: одна волна чтения (урок v2 и список уроков модуля
 * для ссылок «дальше» параллельно с проверкой доступа). Урок: теория из
 * блоков, рядом оглавление, затем «Проверка». Практика: только задания.
 * Чужой, несуществующий урок и урок «Английского» неразличимы: честный 404.
 */
export default async function CscaLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  if (!isCscaUuid(lessonId)) notFound();
  const [, locale, loaded, siblings] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaLesson(lessonId).then(
      (view): CscaLessonView | "denied" | null => view,
      (error: unknown) => (error instanceof CscaSourceError && error.code === "denied" ? "denied" : null),
    ),
    readCscaModuleLessons().catch((): CscaLessonSummary[] => []),
  ]);
  if (loaded === "denied") notFound();
  const strings = getPortalStrings("csca", locale);
  const ky = locale === "ky";

  if (loaded === null) {
    return (
      <main className="pt-page cs-page">
        <p className="cs-back-row"><Link className="cs-back" href="/portal/csca">{strings.backToHome}</Link></p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      </main>
    );
  }

  const view = loaded;
  const meta = view.lesson.metadata;
  const isPractice = meta.kind === "practice";
  const theory = view.lesson.theory;
  const sameTopic = siblings
    .filter((entry) => entry.metadata.topic_key === meta.topic_key && entry.lessonId !== lessonId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const nextLinks: ItemRunnerLink[] = [
    ...sameTopic
      .filter((entry) => entry.metadata.kind === (isPractice ? "lesson" : "practice"))
      .slice(0, 1)
      .map((entry) => ({
        href: `/portal/csca/math/lesson/${entry.lessonId}`,
        label: isPractice ? strings.toLesson : strings.toPractice,
      })),
    { href: "/portal/csca", label: strings.backToTopics },
  ];
  const metaLine = formatPortalString(strings.lessonMeta, {
    kind: strings[`kind.${meta.kind}`],
    minutes: formatPortalString(strings.minutes, { n: String(meta.est_minutes) }),
    point: meta.syllabus_point,
  });

  return (
    <main className="pt-page cs-page" data-kind={meta.kind}>
      <header className="cs-lesson-header">
        <p className="cs-back-row">
          <Link className="cs-back" href="/portal/csca">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {strings.backToHome}
          </Link>
        </p>
        <h1 className="pt-page-title">{ky ? meta.title_ky : meta.title_ru}</h1>
        <p className="cs-title-en" lang="en">{meta.title_en}</p>
        <MathText as="p" className="cs-lesson-goal" text={ky ? meta.goal_ky : meta.goal_ru} />
        <p className="cs-lesson-meta">{metaLine}</p>
      </header>

      {!isPractice && theory.length > 0 ? (
        <div className="cs-lesson-layout">
          <article className="cs-sheet" aria-label={ky ? meta.title_ky : meta.title_ru}>
            <TheoryBlocks blocks={theory} figures={view.figures} locale={locale} strings={strings} />
          </article>
          <nav className="cs-toc" aria-label={strings.contentsHeading}>
            <p className="cs-toc-title" aria-hidden="true">{strings.contentsHeading}</p>
            <ol>
              {theory.map((block, index) => (
                tocEntry(theory, index) ? (
                  <li key={index}>
                    <a href={`#${theoryBlockId(index)}`}>{theoryBlockLabel(block, strings, locale)}</a>
                  </li>
                ) : null
              ))}
              <li><a href="#cs-check">{strings.checkHeading}</a></li>
            </ol>
          </nav>
        </div>
      ) : null}

      <section id="cs-check" className="cs-check" aria-labelledby="cs-check-title">
        <h2 id="cs-check-title" className="cs-section-title">
          {isPractice ? strings["kind.practice"] : strings.checkHeading}
        </h2>
        <p className="cs-section-lead">{isPractice ? strings.practiceLead : strings.checkLead}</p>
        <ItemRunner
          lessonId={lessonId}
          items={view.lesson.exercises}
          figures={Object.fromEntries(view.lesson.exercises
            .flatMap((item) => (item.figureKey && view.figures[item.figureKey] ? [[item.figureKey, view.figures[item.figureKey]]] : [])))}
          draft={view.draft}
          latestCompleted={view.latestCompleted}
          locale={locale}
          strings={strings}
          nextLinks={nextLinks}
        />
      </section>
    </main>
  );
}
