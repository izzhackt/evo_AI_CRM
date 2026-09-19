import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import {
  formatPortalString,
  getPortalStrings,
  type PortalStrings,
} from "@/lib/portal/i18n";
import type { LearningLessonSummary, LearningModule } from "@/lib/portal/learning";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityMonthLabel,
} from "@/lib/portal/universities";
import {
  assessmentPath,
  type AssessmentCatalog,
} from "@/lib/student-assessment-contract";
import type { StudentPortalAction, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { formatPortalMoney, studentActionDueLabel } from "../admission/presentation";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов»
 * п.1): продолжение урока/теста, избранное с ближайшими интейками; assisted —
 * ближайшие действия дела первым блоком (та же модель E2, что у
 * OverviewView «Моего поступления»). Никаких новых DTO: точные результаты
 * существующих read model приходят пропсами, каждый источник несёт свой
 * честный сбой (null) и честную пустоту. «Новое в каталоге» сознательно
 * отсутствует: у каталога нет честного признака новизны (publishedAt —
 * reviewed_at текущей версии, см. docs/PLAN_CHANGES.md PORT-9c).
 */

type AdmissionStrings = PortalStrings<"admission">;
type UniversitiesStrings = PortalStrings<"universities">;

function actionTitle(action: StudentPortalAction, strings: AdmissionStrings): string {
  const verb = action.kind === "payment"
    ? strings.actionPayment
    : action.kind === "upload_document"
      ? strings.actionUpload
      : strings.actionReplace;
  return `${verb}: ${action.label}`;
}

function actionHref(action: StudentPortalAction): string {
  return action.kind === "payment"
    ? "/portal/payments"
    : `/portal/documents#document-${action.documentSlotId}`;
}

/** Первый урок к продолжению: черновик, иначе первый непройденный по порядку. */
function pickLesson(modules: readonly LearningModule[]): {
  module: LearningModule;
  lesson: LearningLessonSummary;
  kind: "continue" | "start";
} | null {
  for (const candidate of modules) {
    const draft = candidate.lessons.find((lesson) => lesson.draftAttemptId !== null);
    if (draft) return { module: candidate, lesson: draft, kind: "continue" };
  }
  for (const candidate of modules) {
    const next = candidate.lessons.find((lesson) => !lesson.completed);
    if (next) return { module: candidate, lesson: next, kind: "start" };
  }
  return null;
}

function nearestIntakeText(
  item: PublishedUniversity,
  universitiesStrings: UniversitiesStrings,
  locale: Locale,
  now: Date,
): string {
  const nearest = nearestUniversityIntake(item.content, now);
  if (nearest === null) return universitiesStrings.intakeDatesPending;
  if (nearest.kind === "deadline") {
    return formatPortalString(universitiesStrings.intakeDeadlineByDate, {
      date: universityDateLabel(nearest.value, locale),
    });
  }
  return formatPortalString(universitiesStrings.intakeStartFromDate, {
    date: nearest.kind === "start"
      ? universityDateLabel(nearest.value, locale)
      : universityMonthLabel(nearest.value, locale),
  });
}

export function HomeView({
  tier,
  overview,
  overviewFailed = false,
  modules,
  assessments,
  favorites,
  favoritesTotal,
  locale,
  now,
}: {
  tier: PortalAccessTier;
  /** Только assisted; null — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  overviewFailed?: boolean;
  /** null — сбой чтения (честная плашка), не пустой модуль. */
  modules: readonly LearningModule[] | null;
  assessments: AssessmentCatalog | null;
  favorites: readonly PublishedUniversity[] | null;
  favoritesTotal: number;
  locale: Locale;
  now: Date;
}) {
  const strings = getPortalStrings("home", locale);
  const shell = getPortalStrings("shell", locale);
  const admission = getPortalStrings("admission", locale);
  const english = getPortalStrings("english", locale);
  const tests = getPortalStrings("tests", locale);
  const favoritesStrings = getPortalStrings("favorites", locale);
  const universitiesStrings = getPortalStrings("universities", locale);

  const primary = overview?.studentAction ?? null;
  const remaining = overview ? overview.studentActions.length - 1 : 0;

  const picked = modules === null ? null : pickLesson(modules);
  const lessonsExist = modules !== null && modules.some((module) => module.lessonsTotal > 0);

  const draftInstrument = assessments?.instruments.find(
    (instrument) => instrument.draftAttemptId !== null,
  ) ?? null;
  const draftAttempt = draftInstrument
    ? assessments?.attempts.find(
      (attempt) => attempt.attemptId === draftInstrument.draftAttemptId,
    ) ?? null
    : null;

  return (
    <div className="pt-home">
      {tier === "assisted" ? (
        <section aria-labelledby="home-case" className="pt-card pt-home-case">
          <header className="pt-card-header">
            <h2 id="home-case" className="pt-card-title">{strings.caseHeading}</h2>
            {primary ? <span className="pt-card-note">{admission.nextStepNote}</span> : null}
          </header>
          <div className="pt-home-case-body">
            {overviewFailed ? (
              <p role="alert" className="pt-alert">{strings.caseUnavailable}</p>
            ) : primary ? (
              <>
                <h3 className="pt-home-case-title">{actionTitle(primary, admission)}</h3>
                <dl className="pt-home-case-facts">
                  <div className="pt-home-case-fact">
                    <dt>{admission.dueTerm}</dt>
                    <dd>
                      {studentActionDueLabel(primary) && primary.dueAt ? (
                        <time dateTime={primary.dueAt}>{studentActionDueLabel(primary)}</time>
                      ) : admission.dueUnknown}
                    </dd>
                  </div>
                  {primary.kind === "payment" ? (
                    <div className="pt-home-case-fact">
                      <dt>{admission.amountTerm}</dt>
                      <dd className="pt-data">
                        {formatPortalMoney(primary.amountMinor, primary.currency)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="pt-home-case-actions">
                  <Link href={actionHref(primary)} className="pt-btn">
                    {primary.kind === "payment" ? admission.openPayment : admission.openDocument}
                  </Link>
                  {remaining > 0 ? (
                    <span className="pt-home-case-more pt-data">
                      {formatPortalString(strings.caseMore, { count: String(remaining) })}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h3 className="pt-home-case-title pt-home-case-calm">
                  {overview ? admission.calmDone : admission.calmNoPlan}
                </h3>
                <p className="pt-home-case-lead">
                  {overview ? admission.calmDoneLead : admission.calmNoPlanLead}
                </p>
              </>
            )}
          </div>
          <nav aria-label={strings.caseSectionsAria} className="pt-home-case-links">
            <Link href="/portal" className="pt-link">
              {strings.caseOpenAdmission} <span aria-hidden="true">→</span>
            </Link>
            <Link href="/portal/documents" className="pt-link">
              {shell["nav.documents"]} <span aria-hidden="true">→</span>
            </Link>
            <Link href="/portal/payments" className="pt-link">
              {shell["nav.payments"]} <span aria-hidden="true">→</span>
            </Link>
            <Link href="/portal/messages" className="pt-link">
              {shell["nav.messages"]} <span aria-hidden="true">→</span>
            </Link>
          </nav>
        </section>
      ) : null}

      <section aria-labelledby="home-continue" className="pt-home-section">
        <h2 id="home-continue" className="pt-section-title">{strings.continueHeading}</h2>
        <div className="pt-home-grid">
          <article className="pt-home-card">
            <p className="pt-home-card-kicker">{shell["nav.english"]}</p>
            {modules === null ? (
              <p role="alert" className="pt-alert">{english.unavailable}</p>
            ) : picked ? (
              <>
                <h3 className="pt-home-card-title">
                  {locale === "ky" ? picked.lesson.metadata.title_ky : picked.lesson.metadata.title_ru}
                </h3>
                <p className="pt-home-card-meta pt-data">
                  {formatPortalString(english.lessonLabel, { n: String(picked.lesson.orderIndex) })}
                  {" · "}
                  {formatPortalString(english.progress, {
                    done: String(picked.module.lessonsCompleted),
                    total: String(picked.module.lessonsTotal),
                  })}
                </p>
                {picked.kind === "continue" ? (
                  <p className="pt-home-card-status"><span className="pt-chip">{english.statusDraft}</span></p>
                ) : null}
                <p className="pt-home-card-action">
                  <Link className="pt-btn" href={`/portal/english/lesson/${picked.lesson.lessonId}`}>
                    {picked.kind === "continue" ? english.continueLesson : english.startLesson}
                  </Link>
                </p>
              </>
            ) : lessonsExist ? (
              <>
                <h3 className="pt-home-card-title">{strings.lessonsDoneTitle}</h3>
                <p className="pt-home-card-body">{strings.lessonsDoneBody}</p>
                <p className="pt-home-card-action">
                  <Link className="pt-btn-ghost" href="/portal/english">{strings.openEnglish}</Link>
                </p>
              </>
            ) : (
              <>
                <h3 className="pt-home-card-title">{english.emptyTitle}</h3>
                <p className="pt-home-card-body">{english.emptyBody}</p>
              </>
            )}
          </article>

          <article className="pt-home-card">
            <p className="pt-home-card-kicker">{shell["nav.tests"]}</p>
            {assessments === null ? (
              <p role="alert" className="pt-alert">{strings.testsUnavailable}</p>
            ) : draftInstrument ? (
              <>
                <h3 className="pt-home-card-title">{draftInstrument.metadata.title}</h3>
                {draftAttempt ? (
                  <p className="pt-home-card-meta pt-data">
                    {formatPortalString(tests.cardDraft, {
                      answered: String(draftAttempt.answeredCount),
                      total: String(draftAttempt.questionCount),
                    })}
                  </p>
                ) : null}
                <p className="pt-home-card-action">
                  <Link
                    className="pt-btn"
                    href={`${assessmentPath(draftInstrument.instrumentKey)}?attempt=${draftInstrument.draftAttemptId}`}
                  >
                    {tests.cardContinue}
                  </Link>
                </p>
              </>
            ) : (
              <>
                <h3 className="pt-home-card-title">{strings.testsEntryTitle}</h3>
                <p className="pt-home-card-body">{strings.testsEntryBody}</p>
                <p className="pt-home-card-action">
                  <Link className="pt-btn-ghost" href="/portal/tests">{strings.openTests}</Link>
                </p>
              </>
            )}
          </article>

          {tier === "approved" ? (
            <article className="pt-home-card">
              <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
              <h3 className="pt-home-card-title">{admission.pendingApplicationHeading}</h3>
              <p className="pt-home-card-body">{admission.pendingApplicationHint}</p>
              <p className="pt-home-card-action">
                <Link className="pt-btn-ghost" href="/apply/status">
                  {admission.pendingApplicationLink}
                </Link>
              </p>
            </article>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="home-favorites" className="pt-home-section">
        <div className="pt-home-section-head">
          <h2 id="home-favorites" className="pt-section-title">{shell["nav.favorites"]}</h2>
          {favorites !== null && favoritesTotal > 0 ? (
            <>
              <span className="pt-home-fav-count pt-data">
                {formatPortalString(favoritesStrings.savedCount, { count: String(favoritesTotal) })}
              </span>
              <Link className="pt-link" href="/portal/favorites">
                {strings.favoritesAll} <span aria-hidden="true">→</span>
              </Link>
            </>
          ) : null}
        </div>
        {favorites === null ? (
          <p role="alert" className="pt-alert">{favoritesStrings.unavailable}</p>
        ) : favorites.length === 0 ? (
          <div className="pt-empty">
            <p className="pt-empty-title">{favoritesStrings.emptyTitle}</p>
            <p className="pt-empty-body">{favoritesStrings.emptyBody}</p>
            <p>
              <Link href="/portal/universities" className="pt-btn-ghost">
                {favoritesStrings.emptyAction}
              </Link>
            </p>
          </div>
        ) : (
          <ul className="pt-home-fav-list">
            {favorites.map((item) => (
              <li key={item.id}>
                <Link href={`/portal/universities/${item.id}`} className="pt-home-fav-row">
                  <span className="pt-home-fav-main">
                    <span className="pt-home-fav-name">{item.content.name}</span>
                    <span className="pt-home-fav-place">
                      {universityCountryLabel(item.content.country, locale)}
                      {item.content.city ? ` · ${item.content.city}` : ""}
                    </span>
                  </span>
                  <span className="pt-home-fav-intake">
                    {universitiesStrings.nearestIntake}
                    {": "}
                    <span className="pt-data">
                      {nearestIntakeText(item, universitiesStrings, locale, now)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
