import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { homeDayMonth, type HomeDateItem } from "@/lib/portal/home-dates";
import { formatPortalString, getPortalStrings, type PortalStrings } from "@/lib/portal/i18n";
import { universityDateLabel } from "@/lib/portal/universities";

/** Ближайшая дата «Главной» для отсчёта в шапке: пункт «Ближайших дат» и сколько до него дней (0 — сегодня). */
export type HomeHeroCountdown = HomeDateItem & Readonly<{ days: number }>;

function countdownWhen(days: number, locale: Locale, strings: PortalStrings<"home">): { big: string; word: string | null } {
  if (days <= 0) return { big: strings.heroToday, word: null };
  if (days === 1) return { big: strings.heroTomorrow, word: null };
  const form = new Intl.PluralRules(locale === "ky" ? "ky" : "ru").select(days);
  const key = form === "one" ? "heroDays.one" : form === "few" ? "heroDays.few" : "heroDays.many";
  return { big: String(days), word: strings[key] };
}

/**
 * Шапка «Главной» (03.11.2026, по образцу кабинета пользователя): тёмная плашка с красными градиентами и знаком EVO,
 * приветствие по имени и страна поступления. Дорожка десяти этапов EVO снята (10.11.2026, владелец): где студент, говорит
 * путь страны под шапкой («Путь поступления», строка «Сейчас»).
 *
 * 18.11.2026 (пользователь выбрал из вариантов): рядом со страной — набор пути («Китай · набор на сентябрь 2027 года»),
 * справа — отсчёт до ближайшей даты «Ближайших дат» (как у кабинета Акылмана). Всё из того, что «Главная» уже читает;
 * нет данных — части нет. Имя куратора в шапке пробовали и не взяли.
 */
export type HomeHeroProps = Readonly<{
  displayName: string;
  /** Страна поступления («Малайзия»); `null` — не выбрана. */
  studyCountry: string | null;
  /** Подпись набора пути страны («Набор на сентябрь 2027 года»); `null` — пути нет. */
  intake?: string | null;
  /** Ближайшая дата из «Ближайших дат»; `null` — в ближайшие 60 дней дат нет. */
  countdown?: HomeHeroCountdown | null;
  locale: Locale;
}>;

/**
 * Шапка «Главной» (тёмная плашка с красными градиентами) — пока страна не выбрана. Со страной то же содержимое
 * (`HomeHeroContent`) стоит в шапке пути на фото столицы: одна шапка вместо двух тёмных плашек подряд (18.11.2026).
 */
export function HomeHero(props: HomeHeroProps) {
  return (
    <section className="pt-home-hero" aria-labelledby="home-title">
      <HomeHeroContent {...props} />
    </section>
  );
}

/** Приветствие (единственный h1 «Главной»), «страна · набор» и отсчёт до ближайшей даты. */
export function HomeHeroContent({ displayName, studyCountry, intake = null, countdown = null, locale }: HomeHeroProps) {
  const strings = getPortalStrings("home", locale);
  const sub = studyCountry && intake
    ? formatPortalString(strings.heroIntake, { country: studyCountry, intake: intake.charAt(0).toLocaleLowerCase(locale) + intake.slice(1) })
    : studyCountry;
  const when = countdown ? countdownWhen(countdown.days, locale, strings) : null;
  const shortDate = countdown ? homeDayMonth(countdown.day, locale) : "";

  return (
    <div className="pt-home-hero-head">
      <div className="pt-home-hero-who">
        <h1 id="home-title" className="pt-home-hero-title">
          {formatPortalString(strings.greeting, { name: displayName })}
        </h1>
        {sub ? <p className="pt-home-hero-sub">{sub}</p> : null}
      </div>
      {countdown && when ? (
        <IntentPrefetchLink
          href={countdown.href}
          className="pt-home-hero-count"
          aria-label={formatPortalString(strings.heroCountdownAria, {
            when: when.word ? `${when.big} ${when.word}` : when.big,
            title: countdown.title,
            date: universityDateLabel(countdown.day, locale),
          })}
        >
          {/* «Сегодня» и «Завтра» стоят на месте числа: крупное число — только у числа, слово мельче. */}
          <span className="pt-home-hero-count-big" data-word={when.word ? undefined : ""} aria-hidden="true">{when.big}</span>
          <span className="pt-home-hero-count-when" aria-hidden="true">
            {when.word ? formatPortalString(strings.heroCountdownLine, { word: when.word, date: shortDate }) : shortDate}
          </span>
          <span className="pt-home-hero-count-title" aria-hidden="true">{countdown.title}</span>
        </IntentPrefetchLink>
      ) : null}
    </div>
  );
}
