import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { CountryTimelineView, TimelineStepProgress } from "@/lib/portal/country-timeline";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { JOURNEY_HREF } from "@/lib/portal/journey-anchor";

import { HomeCardHead } from "./HomeParts";

/**
 * Карточка «Пути поступления» на «Главной» (08.11.2026, пользователь: «не будет ли логичнее вот этот блок поставить в
 * поступление?» и образец «Главной»). Весь путь переехал на «Поступление»; здесь только где студент сейчас: «Шаг N из M»,
 * название шага и полоса шагов. Без дела вместо шага подпись набора, без страны предложение выбрать её. Сбой чтения
 * выбора — честная плашка.
 */
export function HomeJourneyCard({ view, progress, readFailed, locale }: Readonly<{
  view: CountryTimelineView | null;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  readFailed: boolean;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const timeline = getPortalStrings("timeline", locale);
  const current = view?.steps.find((step) => progress?.[step.id] === "current") ?? null;

  return (
    <section aria-labelledby="home-path" className="pt-card pt-home-box pt-home-path">
      {/* Страна уже названа в шапке «Главной», а заголовок без неё оставляет место ссылке в узкой колонке. */}
      <HomeCardHead
        id="home-path"
        title={timeline.heading}
        action={(
          <IntentPrefetchLink className="pt-link" href={JOURNEY_HREF}>
            {view ? strings.pathAll : strings.pathChoose}
          </IntentPrefetchLink>
        )}
      />
      {readFailed ? (
        <p role="alert" className="pt-alert">{timeline.readError}</p>
      ) : view === null ? (
        <p className="pt-home-path-lead">{strings.pathChooseLead}</p>
      ) : current ? (
        <div className="pt-home-path-now">
          <p className="pt-home-path-step">
            <span className="pt-home-path-n">
              {formatPortalString(timeline.nowStep, { n: String(current.order), total: String(view.steps.length) })}
            </span>{" "}
            <span className="pt-home-path-title">{current.title}</span>
          </p>
          {/* Полоса шагов дублирует «Шаг N из M» словами, поэтому скрыта от читалки. */}
          <span className="pt-journey-meter" aria-hidden="true">
            {view.steps.map((step) => (
              <span key={step.id} className="pt-journey-meter-seg" data-progress={progress?.[step.id] ?? "upcoming"} />
            ))}
          </span>
        </div>
      ) : (
        <p className="pt-home-path-lead">{view.intake.label}</p>
      )}
    </section>
  );
}
