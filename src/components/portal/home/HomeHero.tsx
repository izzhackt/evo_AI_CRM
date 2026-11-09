import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import type { CountryTimelineView, TimelineStepProgress } from "@/lib/portal/country-timeline";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";
import { JOURNEY_HREF } from "@/lib/portal/journey-anchor";

/**
 * Шапка «Главной» (03.11.2026, по образцу кабинета пользователя): тёмная
 * плашка с красными градиентами и знаком EVO, приветствие по имени, страна
 * поступления и дорожка пути.
 *
 * 09.11.2026 (разбор кабинета: «три разных ответа на вопрос „где я“»): дорожка
 * — шаги пути страны, те же, что на «Поступлении» и в «Профиле», а не десять
 * внутренних этапов дела. Текущий шаг считает `timelineStepProgress` по этапу
 * дела. Названия шагов длинные, поэтому под точками их нет: они в подсказке и
 * в доступном имени, а видна строка «Шаг N из M: название» и «Весь путь».
 * Этап дела не ложится на путь (нестандартный этап) или дела нет — точки без
 * отметки и строка набора («Набор на сентябрь 2027 года»): шапка не пустеет.
 * Без страны дорожки нет.
 */
export function HomeHero({ displayName, studyCountry, journey, progress, locale }: Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); `null` — не выбрана. */
  studyCountry: string | null;
  /** Путь выбранной страны; `null` — страны нет. */
  journey: CountryTimelineView | null;
  /** Где студент на пути по этапу дела; `null` — дела нет или обзор не прочитан. */
  progress: Readonly<Record<string, TimelineStepProgress>> | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const steps = journey?.steps ?? [];
  const index = progress ? steps.findIndex((step) => progress[step.id] === "current") : -1;
  const done = progress !== null && steps.length > 0 && steps.every((step) => progress[step.id] === "done");
  const shown = index >= 0 ? steps[index] : done ? steps[steps.length - 1] : null;

  return (
    <section className="pt-home-hero" aria-labelledby="home-title">
      <div className="pt-home-hero-head">
        <h1 id="home-title" className="pt-home-hero-title">
          {formatPortalString(strings.greeting, { name: displayName })}
        </h1>
        {studyCountry ? <p className="pt-home-hero-sub">{studyCountry}</p> : null}
      </div>
      {journey && steps.length > 0 ? (
        <div className="pt-home-stages">
          <ol className="pt-home-stage-track" aria-label={strings.stagesAria} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((step) => (
              <li
                key={step.id}
                data-state={progress?.[step.id] === "done" ? "done" : progress?.[step.id] === "current" ? "current" : undefined}
                aria-current={progress?.[step.id] === "current" ? "step" : undefined}
              >
                <span className="pt-home-stage-visual" aria-hidden="true" title={step.title}>
                  <span className="pt-home-stage-dot" />
                </span>
                <span className="pt-sr-only">{step.title}</span>
              </li>
            ))}
          </ol>
          <p className="pt-home-stage-caption">
            <span>
              {shown
                ? formatPortalString(strings.pathStep, {
                  n: String(steps.indexOf(shown) + 1),
                  total: String(steps.length),
                  title: shown.title,
                })
                : journey.intake.label}
            </span>
            <IntentPrefetchLink className="pt-home-stage-all" href={JOURNEY_HREF}>{strings.pathAll}</IntentPrefetchLink>
          </p>
        </div>
      ) : null}
    </section>
  );
}
