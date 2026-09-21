import type { Metadata } from "next";
import Link from "next/link";

import { ReviewRunner } from "@/components/portal/english/ReviewRunner";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import type { LearningReviewItem } from "@/lib/portal/learning";
import { readLearningModules, readLearningReview } from "@/lib/portal/learning-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("english", await getLocale());
  return { title: `${strings.reviewTitle} — EVO Admissions` };
}

/**
 * Повторение ошибок (PORT-4c): банк собирается сервером из завершённых
 * попыток (cap 20, новые первыми), проверка ответа — learning_review_check_v1
 * только для собственного банка.
 */
export default async function EnglishReviewPage() {
  const [, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const strings = getPortalStrings("english", locale);

  let items: LearningReviewItem[] | null = null;
  try {
    const modules = await readLearningModules();
    items = modules.length > 0 ? await readLearningReview(modules[0].moduleId) : [];
  } catch {
    items = null;
  }

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">
          <Link className="pt-link" href="/portal/english">{strings.backToModule}</Link>
        </p>
        <h1 className="pt-page-title">{strings.reviewTitle}</h1>
        <p className="pt-page-lead">{strings.reviewLead}</p>
      </header>
      {items === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : items.length === 0 ? (
        <div className="pt-empty">
          <p className="pt-empty-title">{strings.reviewEmptyTitle}</p>
          <p className="pt-empty-body">{strings.reviewEmptyBody}</p>
          <p>
            <Link className="pt-btn-ghost" href="/portal/english">{strings.reviewEmptyAction}</Link>
          </p>
        </div>
      ) : (
        <ReviewRunner items={items} locale={locale} strings={strings} />
      )}
    </main>
  );
}
