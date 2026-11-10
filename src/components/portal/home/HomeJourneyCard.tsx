import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { CountryTimelineView, TimelineStepProgress } from "@/lib/portal/country-timeline";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { JOURNEY_HREF } from "@/lib/portal/journey-anchor";
import { journeyStrip } from "@/lib/portal/journey-strip";

import { HomeCardHead } from "./HomeParts";

/**
 * Полоса пути на «Главной» (10.11.2026, владелец): «Шаг 2 из 7 · Договор и документы · дальше — Подача в вуз» и под ней
 * «Весь путь». Счёт ведёт путь СТРАНЫ (семь шагов в файле страны), а не десять этапов EVO: десять этапов с «Главной»
 * студента сняты. Вычисление общее с iPhone (`journeyStrip`) и опирается на ту же отметку «сейчас», что карточка «Путь»
 * (CountryTimeline). Без страны карточки нет: выбор страны стоит первым блоком «Главной». Нет прогресса (дела нет) —
 * подпись набора. Дело завершено — «Поступление завершено» вместо номера.
 */
export function HomeJourneyCard({ view, progress, stage, readFailed, locale }: Readonly<{
  view: CountryTimelineView | null;
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  /** Этап дела (`operational_stage`): `completed` и `closed` дают «Поступление завершено». */
  stage?: string | null;
  readFailed?: boolean;
  locale: Locale;
}>) {
  if (view === null) return null;
  const strings = getPortalStrings("home", locale);
  const timeline = getPortalStrings("timeline", locale);
  const strip = journeyStrip(view.steps, progress, stage);
  const title = view.countryName
    ? formatPortalString(strings.pathTitle, { country: view.countryName })
    : timeline.heading;
  const stepText = strip?.kind === "step" ? formatPortalString(strings.stripStep, { n: String(strip.n), total: String(strip.total) }) : null;

  return (
    <section aria-labelledby="home-path" className="pt-card pt-home-box pt-home-path">
      <HomeCardHead id="home-path" title={title} />
      {readFailed ? (
        <p role="alert" className="pt-alert">{timeline.readError}</p>
      ) : strip ? (
        <div className="pt-home-path-now" data-testid="home-strip">
          {strip.kind === "step" ? (
            <>
              <p className="pt-home-path-step">
                <span className="pt-home-path-n">{stepText}</span>
                <span className="pt-sr-only">. </span>
                <span className="pt-home-path-title">{strip.title}</span>
              </p>
              {strip.nextTitle ? (
                <p className="pt-home-path-next">{formatPortalString(strings.stripNext, { title: strip.nextTitle })}</p>
              ) : null}
            </>
          ) : (
            <p className="pt-home-path-step"><span className="pt-home-path-title">{strings.stripDone}</span></p>
          )}
          {/* Полоса шагов — картинка к строке выше; читалка слышит «Шаг N из M» в самой строке. */}
          <span className="pt-journey-meter" aria-hidden="true">
            {view.steps.filter((step) => progress?.[step.id] !== "optional").map((step) => (
              <span key={step.id} className="pt-journey-meter-seg" data-progress={strip.kind === "complete" ? "done" : progress?.[step.id] ?? "upcoming"} />
            ))}
          </span>
        </div>
      ) : (
        <p className="pt-home-path-lead">{view.intake.label}</p>
      )}
      <p className="pt-home-path-all">
        <IntentPrefetchLink className="pt-link" href={JOURNEY_HREF}>{strings.pathAll}</IntentPrefetchLink>
      </p>
    </section>
  );
}
