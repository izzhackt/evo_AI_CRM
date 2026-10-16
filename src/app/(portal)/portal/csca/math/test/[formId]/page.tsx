import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TimedTestRunner } from "@/components/portal/csca/TimedTestRunner";
import type { TitleMaps } from "@/components/portal/csca/TestResultView";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { isCscaUuid, type CscaHome, type CscaTestAttempt } from "@/lib/portal/csca";
import { readCscaHome, readCscaTestAttempt } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings.testTitle} · ${strings.title} · EVO Admissions` };
}

function titleMaps(home: CscaHome): TitleMaps {
  return {
    topics: Object.fromEntries(home.topics.map((topic) => [
      topic.topicKey,
      { ru: topic.metadata.title_ru, ky: topic.metadata.title_ky, en: topic.metadata.title_en },
    ])),
    sections: Object.fromEntries((home.modules[0]?.metadata.sections ?? []).map((section) => [
      section.section,
      { ru: section.title_ru, ky: section.title_ky, en: section.title_en },
    ])),
  };
}

/**
 * Тест на время CSCA. Одна волна чтения: главная трека (форма, черновик,
 * темы для итога) и, если открыт разбор `?attempt=`, сама попытка. Задания
 * приходят только при старте (start_learning_test_v1) вместе со сроком
 * сервера; разбор только у завершённой попытки.
 */
export default async function CscaTestPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ formId }, query] = await Promise.all([params, searchParams]);
  if (!isCscaUuid(formId)) notFound();
  const attemptParam = typeof query.attempt === "string" && isCscaUuid(query.attempt) ? query.attempt : null;
  const [, locale, home, attempt] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaHome().catch(() => null),
    attemptParam ? readCscaTestAttempt(attemptParam).catch((): CscaTestAttempt | null => null) : Promise.resolve(null),
  ]);
  const strings = getPortalStrings("csca", locale);
  const ky = locale === "ky";

  const back = (
    <p className="cs-back-row">
      <Link className="cs-back" href="/portal/csca">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {strings.backToHome}
      </Link>
    </p>
  );

  if (home === null) {
    return (
      <main className="pt-page cs-page">
        {back}
        <h1 className="pt-page-title">{strings.testTitle}</h1>
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      </main>
    );
  }
  const form = home.tests.find((entry) => entry.formId === formId);
  if (!form) notFound();
  const result = attempt && attempt.status === "completed" && attempt.formId === formId ? attempt : null;

  return (
    <main className="pt-page cs-page cs-test-page">
      <header className="cs-lesson-header">
        {back}
        <h1 className="pt-page-title">{ky ? form.metadata.title_ky : form.metadata.title_ru}</h1>
      </header>
      <TimedTestRunner
        key={result?.attemptId ?? "run"}
        form={{
          formId: form.formId,
          kind: form.kind,
          metadata: form.metadata,
          durationSeconds: form.durationSeconds,
          allowEarlyFinish: form.allowEarlyFinish,
          itemsTotal: form.itemsTotal,
          hasDraft: form.draft !== null,
        }}
        locale={locale}
        strings={strings}
        titles={titleMaps(home)}
        initialResult={result}
        homeHref="/portal/csca"
      />
    </main>
  );
}
