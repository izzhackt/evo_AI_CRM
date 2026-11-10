import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, getPortalStrings } from "@/lib/portal/i18n";

/**
 * Шапка «Главной» (03.11.2026, по образцу кабинета пользователя): тёмная плашка с красными градиентами и знаком EVO,
 * приветствие по имени и страна поступления. Дорожка десяти этапов EVO снята (10.11.2026, владелец): где студент, говорит
 * одна полоса «Шаг N из M» по пути страны (HomeJourneyCard).
 */
export function HomeHero({ displayName, studyCountry, locale }: Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); `null` — не выбрана. */
  studyCountry: string | null;
  locale: Locale;
}>) {
  const strings = getPortalStrings("home", locale);

  return (
    <section className="pt-home-hero" aria-labelledby="home-title">
      <div className="pt-home-hero-head">
        <h1 id="home-title" className="pt-home-hero-title">
          {formatPortalString(strings.greeting, { name: displayName })}
        </h1>
        {studyCountry ? <p className="pt-home-hero-sub">{studyCountry}</p> : null}
      </div>
    </section>
  );
}
