import type { Metadata } from "next";
import Link from "next/link";

import { ReviewRunner } from "@/components/portal/csca/ReviewRunner";
import { getLocale } from "@/lib/i18n";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { cscaDayLabel } from "@/lib/portal/csca";
import { readCscaReview } from "@/lib/portal/csca-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("csca", await getLocale());
  return { title: `${strings.reviewTitle} · ${strings.title} · EVO Admissions` };
}

/**
 * «Ошибки» CSCA: один вызов learning_review_v2 (до 20 заданий со сроком
 * сегодня по Бишкеку), ответы через record_learning_review_v1.
 */
export default async function CscaReviewPage() {
  const [, locale, review] = await Promise.all([
    requireStudentPortalActor(),
    getLocale(),
    readCscaReview().catch(() => null),
  ]);
  const strings = getPortalStrings("csca", locale);

  return (
    <main className="pt-page cs-page">
      <header className="cs-lesson-header">
        <p className="cs-back-row">
          <Link className="cs-back" href="/portal/csca">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3.5 5.5 8 10 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {strings.backToHome}
          </Link>
        </p>
        <h1 className="pt-page-title">{strings.reviewTitle}</h1>
        <p className="pt-page-lead">{strings.reviewLead}</p>
      </header>
      {review === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : review.items.length === 0 ? (
        <div className="cs-empty">
          <p className="cs-empty-title">{strings.reviewEmptyTitle}</p>
          <p className="cs-empty-body">
            {review.activeCount > 0 && review.nextDueOn
              ? formatPortalString(strings.reviewEmptyNext, {
                date: cscaDayLabel(review.nextDueOn, locale),
                count: String(review.activeCount),
              })
              : strings.reviewEmptyBankBody}
          </p>
          <Link className="pt-btn-ghost" href="/portal/csca">{strings.backToTopics}</Link>
        </div>
      ) : (
        <ReviewRunner review={review} locale={locale} strings={strings} homeHref="/portal/csca" />
      )}
    </main>
  );
}
