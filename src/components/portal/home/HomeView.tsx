import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { PublishedUniversity } from "@/lib/platform-university-catalog";
import { aiConsentApplies } from "@/lib/portal/ai-consent";
import { todayForTimeline } from "@/lib/portal/country-timeline";
import { bishkekDay, type HomeDateItem } from "@/lib/portal/home-dates";
import {
  formatPortalString,
  getPortalStrings,
  type PortalStrings,
} from "@/lib/portal/i18n";
import {
  nearestUniversityIntake,
  universityCountryLabel,
  universityDateLabel,
  universityMonthLabel,
} from "@/lib/portal/universities";
import type { StudentPortalAction, StudentPortalNotification, StudentPortalOverview } from "@/lib/v3/portal-source";

import type { PortalAccessTier } from "../Shell";
import { formatPortalMoney, studentActionDueLabel } from "../admission/presentation";
import { HomeDates } from "./HomeDates";
import { HomeHero } from "./HomeHero";
import { HomeNews } from "./HomeNews";

/**
 * «Главная» кабинета в «Атласе» (PORT-9c, дизайн-контракт §«Карта экранов»
 * п.1); assisted — ближайшие действия дела (та же модель E2, что у
 * «Моего поступления»). «Путь поступления» (S4, план §8.4) приходит готовым
 * блоком `journey`: у клиента он стоит после ближайших действий дела, у
 * самостоятельного студента первым. Карточка согласия на ИИ-помощников
 * (`aiConsent`, 25.10.2026) стоит первой под шапкой, пока для текущей версии
 * текста нет решения, и не блокирует ничего ниже; она только у клиента с делом
 * на сопровождении (tier assisted), самостоятельному студенту вид её не
 * показывает, даже если её передали. Серверные read model приходят пропсами,
 * каждый источник несёт свой честный сбой (null) и честную пустоту.
 *
 * 03.11.2026 (по образцу кабинета пользователя): сверху приветствие с этапом
 * дела (HomeHero), ниже две колонки — слева «Путь поступления» и «Что сделать
 * сейчас», справа «Ближайшие даты» (HomeDates), «Что нового» (HomeNews, лента
 * «Входящих», только assisted), карточка CSCA (`csca`, только при выбранном
 * Китае), «Ваша анкета» (только approved) и «Мои вузы». «Учёба и тесты» и
 * «Новое в каталоге» сняты по слову пользователя: английский, тесты и каталог —
 * пункты меню. На узком экране колонки идут одна за другой.
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
  displayName,
  studyCountry = null,
  overview,
  overviewFailed = false,
  news = null,
  favorites,
  favoritesTotal,
  journey = null,
  csca = null,
  aiConsent = null,
  locale,
  now,
}: {
  tier: PortalAccessTier;
  /** Имя студента для приветствия. */
  displayName: string;
  /** Страна поступления для строки под приветствием; `null` — не выбрана. */
  studyCountry?: string | null;
  /** Только assisted; null — RPC вернул пустой обзор (дело без плана). */
  overview: StudentPortalOverview | null;
  overviewFailed?: boolean;
  /** Лента «Что нового» (только assisted); `null` — чтение не удалось. */
  news?: readonly StudentPortalNotification[] | null;
  favorites: readonly PublishedUniversity[] | null;
  favoritesTotal: number;
  /** «Путь поступления» (CountryTimeline); null, если блока нет. */
  journey?: ReactNode;
  /** Карточка CSCA (CscaHomeCard) для студента, выбравшего Китай; иначе null. */
  csca?: ReactNode;
  /** Согласие на ИИ-помощников (AiConsentHomeCard): первым блоком клиента с делом на сопровождении, пока для текущей версии нет решения; самостоятельному студенту не показывается, даже если передан. */
  aiConsent?: ReactNode;
  locale: Locale;
  now: Date;
}) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const favoritesStrings = getPortalStrings("favorites", locale);
  const universitiesStrings = getPortalStrings("universities", locale);

  const primary = overview?.studentAction ?? null;
  const remaining = overview ? overview.studentActions.length - 1 : 0;
  const primaryDue = primary ? studentActionDueLabel(primary) : null;

  // «Ближайшие даты»: сроки дел и дедлайн или старт избранных вузов.
  const today = todayForTimeline(now);
  const dated: HomeDateItem[] = [
    ...(overview?.studentActions ?? []).flatMap((action) => action.dueAt
      ? [{ day: bishkekDay(action.dueAt), title: actionTitle(action, admission), href: actionHref(action) }]
      : []),
    ...(favorites ?? []).flatMap((item) => {
      const nearest = nearestUniversityIntake(item.content, now);
      if (nearest === null || nearest.kind === "startMonth") return [];
      const template = nearest.kind === "deadline" ? strings.dateDeadline : strings.dateStart;
      return [{ day: nearest.value, title: formatPortalString(template, { name: item.content.name }), href: `/portal/universities/${item.id}` }];
    }),
  ];

  return (
    <div className="pt-home">
      <HomeHero displayName={displayName} studyCountry={studyCountry} stage={overview?.operationalStage ?? null} locale={locale} />
      {aiConsentApplies(tier) ? aiConsent : null}
      <div className="pt-home-columns">
      <div className="pt-home-main">
      {tier === "assisted" ? null : journey}
      {tier === "assisted" ? (
        <section aria-labelledby="home-case" className="pt-card pt-home-case">
          <header className="pt-card-header">
            <h2 id="home-case" className="pt-card-title">{strings.caseHeading}</h2>
          </header>
          <div className="pt-home-case-body">
            {overviewFailed ? (
              <p role="alert" className="pt-alert">{strings.caseUnavailable}</p>
            ) : primary ? (
              <>
                <h3 className="pt-home-case-title">{actionTitle(primary, admission)}</h3>
                {/* Срок и сумма — только когда они есть: «Срок: не указан» ничего не сообщает. */}
                {(primaryDue && primary.dueAt) || primary.kind === "payment" ? (
                  <dl className="pt-home-case-facts">
                    {primaryDue && primary.dueAt ? (
                      <div className="pt-home-case-fact">
                        <dt>{admission.dueTerm}</dt>
                        <dd><time dateTime={primary.dueAt}>{primaryDue}</time></dd>
                      </div>
                    ) : null}
                    {primary.kind === "payment" ? (
                      <div className="pt-home-case-fact">
                        <dt>{admission.amountTerm}</dt>
                        <dd className="pt-data">
                          {formatPortalMoney(primary.amountMinor, primary.currency)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                <div className="pt-home-case-actions">
                  <IntentPrefetchLink href={actionHref(primary)} className="pt-btn">
                    {primary.kind === "payment" ? admission.openPayment : admission.openDocument}
                  </IntentPrefetchLink>
                  {remaining > 0 ? (
                    <IntentPrefetchLink href="/portal" className="pt-link pt-home-case-more">
                      {formatPortalString(strings.caseMore, { count: String(remaining) })}
                    </IntentPrefetchLink>
                  ) : null}
                </div>
              </>
            ) : (
              <h3 className="pt-home-case-title pt-home-case-calm">
                {overview ? admission.calmDone : admission.calmNoPlan}
              </h3>
            )}
          </div>
        </section>
      ) : null}
      {tier === "assisted" ? journey : null}
      </div>

      <div className="pt-home-side">
      <HomeDates items={dated} today={today} locale={locale} />
      {tier === "assisted" ? <HomeNews notifications={news} locale={locale} /> : null}
      {csca}
      {tier === "approved" ? (
        <article className="pt-home-card">
          <p className="pt-home-card-kicker">{strings.applicationKicker}</p>
          <h3 className="pt-home-card-title">{admission.pendingApplicationHeading}</h3>
          <p className="pt-home-card-action">
            <IntentPrefetchLink className="pt-btn-ghost" href="/apply/status">
              {admission.pendingApplicationLink}
            </IntentPrefetchLink>
          </p>
        </article>
      ) : null}

      <section aria-labelledby="home-favorites" className="pt-home-section">
        <div className="pt-home-section-head">
          <h2 id="home-favorites" className="pt-section-title">
            {strings.favoritesHeading}
            {favorites !== null ? <span className="pt-count">{favoritesTotal}</span> : null}
          </h2>
          {favorites !== null && favoritesTotal > 0 ? (
            <IntentPrefetchLink className="pt-link" href="/portal">
              {strings.favoritesAll} <span aria-hidden="true">→</span>
            </IntentPrefetchLink>
          ) : null}
        </div>
        {favorites === null ? (
          <p role="alert" className="pt-alert">{favoritesStrings.unavailable}</p>
        ) : favorites.length === 0 ? (
          <div className="pt-empty">
            <p className="pt-empty-title">{favoritesStrings.emptyTitle}</p>
            <p>
              <IntentPrefetchLink href="/portal/universities" className="pt-btn-ghost">
                {favoritesStrings.emptyAction}
              </IntentPrefetchLink>
            </p>
          </div>
        ) : (
          <ul className="pt-home-fav-list">
            {favorites.map((item) => (
              <li key={item.id}>
                <IntentPrefetchLink href={`/portal/universities/${item.id}`} className="pt-home-fav-row">
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
                </IntentPrefetchLink>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      </div>
    </div>
  );
}
