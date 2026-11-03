import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

import { ADMISSION_STAGE_PATH, stageLabel } from "../admission/OverviewView";

/**
 * Шапка «Главной» (03.11.2026, по образцу кабинета пользователя): приветствие
 * по имени, страна поступления и этап дела. Этап — операционный этап из read
 * model (тот же словарь, что в «Профиле»); дорожка — порядок этапов дела,
 * открытый отмечен. Нестандартный этап или закрытое дело — без дорожки, у
 * самостоятельного студента этапа нет вовсе.
 */
export function HomeHero({ displayName, studyCountry, stage, locale }: Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); `null` — не выбрана. */
  studyCountry: string | null;
  /** Операционный этап дела (raw); `null` — нет дела или обзор не прочитан. */
  stage: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);
  const admission = getPortalStrings("admission", locale);
  const label = stage ? stageLabel(stage, admission) : null;
  const index = stage ? ADMISSION_STAGE_PATH.findIndex((key) => key === stage.trim()) : -1;
  // Этап с дорожкой подписан под ней; без дорожки — словом в строке под именем.
  const subline = [studyCountry, index >= 0 ? null : label].filter(Boolean).join(" · ");

  return (
    <section className="pt-home-hero" aria-labelledby="home-title">
      <h1 id="home-title" className="pt-home-hero-title">
        {formatPortalString(strings.greeting, { name: displayName })}
      </h1>
      {subline ? <p className="pt-home-hero-sub">{subline}</p> : null}
      {index >= 0 && label ? (
        <div className="pt-home-stages">
          <ol className="pt-home-stage-track" aria-hidden="true">
            {ADMISSION_STAGE_PATH.map((key, position) => (
              <li
                key={key}
                data-state={position < index ? "done" : position === index ? "current" : undefined}
                title={admission[`stage.${key}`]}
              />
            ))}
          </ol>
          <p className="pt-home-stage-caption">
            {formatPortalString(strings.stageStep, {
              n: String(index + 1),
              total: String(ADMISSION_STAGE_PATH.length),
              stage: label,
            })}
          </p>
        </div>
      ) : null}
    </section>
  );
}
