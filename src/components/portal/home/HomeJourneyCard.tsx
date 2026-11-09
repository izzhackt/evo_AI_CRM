import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { CountryTimelineView, TimelineStepProgress } from "@/lib/portal/country-timeline";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { JOURNEY_HREF } from "@/lib/portal/journey-anchor";

import { HomeCardHead } from "./HomeParts";

/**
 * Карточка «Пути поступления» на «Главной» (08.11.2026, пользователь: «не будет ли логичнее вот этот блок поставить в
 * поступление?» и образец «Главной»). Весь путь переехал на «Поступление»; здесь только где студент сейчас: «Сейчас:
 * название шага» и полоса шагов. Без дела вместо шага подпись набора. Без страны карточки нет: выбор страны стоит
 * первым блоком «Главной» (CountryTimeline), сбой чтения выбора показывает он же.
 *
 * Два словаря этапов не смешиваем (разбор 08.11.2026): в шапке «Главной» этап ДЕЛА («Этап N из 10»), здесь путь СТРАНЫ.
 * Поэтому заголовок называет страну («Путь: Малайзия»), а строка — «Сейчас на пути:»; соответствие этапов дела шагам
 * пути не выдумываем.
 */
export function HomeJourneyCard({ view, progress, readFailed, locale }: Readonly<{
  view: CountryTimelineView | null;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  readFailed?: boolean;
  locale: Locale;
}>) {
  if (view === null) return null;
  const strings = getPortalStrings("home", locale);
  const timeline = getPortalStrings("timeline", locale);
  const current = view.steps.find((step) => progress?.[step.id] === "current") ?? null;
  const title = view.countryName
    ? formatPortalString(strings.pathTitle, { country: view.countryName })
    : timeline.heading;

  return (
    <section aria-labelledby="home-path" className="pt-card pt-home-box pt-home-path">
      <HomeCardHead
        id="home-path"
        title={title}
        action={(
          <IntentPrefetchLink className="pt-link" href={JOURNEY_HREF}>
            {strings.pathAll}
          </IntentPrefetchLink>
        )}
      />
      {readFailed ? (
        <p role="alert" className="pt-alert">{timeline.readError}</p>
      ) : current ? (
        <div className="pt-home-path-now">
          <p className="pt-home-path-step">
            <span className="pt-home-path-n">{strings.pathNow}</span>{" "}
            <span className="pt-home-path-title">{current.title}</span>
            <span className="pt-sr-only">
              {" "}{formatPortalString(timeline.stepOf, { n: String(current.order), total: String(view.steps.length) })}
            </span>
          </p>
          {/* Полоса шагов — картинка к строке «Сейчас на пути»; читалка слышит «Шаг N из M» в самой строке. */}
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
