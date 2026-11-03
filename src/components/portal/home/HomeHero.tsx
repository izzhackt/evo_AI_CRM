import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

import { ADMISSION_STAGE_PATH, stageLabel } from "../admission/OverviewView";

/**
 * Шапка «Главной» (03.11.2026, по образцу кабинета пользователя): тёмная
 * плашка с красными градиентами и знаком EVO, приветствие по имени, страна
 * поступления и дорожка этапов дела. Этап — операционный этап из read model
 * (тот же словарь, что в «Профиле»); у каждого шага короткая подпись, полное
 * название — в подсказке и в доступном имени, открытый шаг отмечен
 * aria-current. На узкой шапке подписи шагов скрыты и вместо них строка «Этап
 * N из M». Нестандартный этап или закрытое дело — словом под именем, без
 * дорожки; у самостоятельного студента этапа нет вовсе.
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
  // Этап с дорожкой подписан на ней; без дорожки — словом в строке под именем.
  const subline = [studyCountry, index >= 0 ? null : label].filter(Boolean).join(" · ");

  return (
    <section className="pt-home-hero" aria-labelledby="home-title">
      <div className="pt-home-hero-head">
        <h1 id="home-title" className="pt-home-hero-title">
          {formatPortalString(strings.greeting, { name: displayName })}
        </h1>
        {subline ? <p className="pt-home-hero-sub">{subline}</p> : null}
      </div>
      {index >= 0 && label ? (
        <div className="pt-home-stages">
          <ol className="pt-home-stage-track" aria-label={strings.stagesAria}>
            {ADMISSION_STAGE_PATH.map((key, position) => (
              <li
                key={key}
                data-state={position < index ? "done" : position === index ? "current" : undefined}
                aria-current={position === index ? "step" : undefined}
                title={admission[`stage.${key}`]}
              >
                <span className="pt-home-stage-dot" aria-hidden="true" />
                <span className="pt-home-stage-name" aria-hidden="true">{admission[`stageShort.${key}`]}</span>
                <span className="pt-sr-only">{admission[`stage.${key}`]}</span>
              </li>
            ))}
          </ol>
          <p className="pt-home-stage-caption" aria-hidden="true">
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
