import type { Metadata } from "next";

import { AiConsentHomeCard } from "@/components/portal/consent/AiConsent";
import { CscaHomeCard } from "@/components/portal/home/CscaHomeCard";
import { HomeJourneyCard } from "@/components/portal/home/HomeJourneyCard";
import { HomeView } from "@/components/portal/home/HomeView";
import { getLocale } from "@/lib/i18n";
import { readOwnAiConsent } from "@/lib/portal/ai-consent-source";
import { readStudentCountryChoice } from "@/lib/portal/country-choice-source";
import { cscaHomeCardVisible, selectCscaHomeCard } from "@/lib/portal/csca-home-card";
import { readCscaHome } from "@/lib/portal/csca-source";
import { getPortalStrings } from "@/lib/portal/i18n";
import { selectStudentJourney } from "@/lib/portal/student-journey";
import {
  readStudentUniversitiesByIds,
  readStudentUniversityFavorites,
} from "@/lib/portal/university-favorites-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { isStudyCountryCode, studyCountryName } from "@/lib/study-countries";
import {
  readStudentPortalNotifications,
  readStudentPortalOverview,
  type StudentPortalOverview,
} from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

/** Показываем на «Главной» первые записи избранного; полный список — вкладка «Вузы» на /portal. */
const HOME_FAVORITES_LIMIT = 4;

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("home", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * «Главная» кабинета (PORT-9c). Живёт на отдельном маршруте: корень /portal
 * остаётся «Моим поступлением» — его заголовок, точка входа после логина и
 * ссылка nav — замороженные смоук-якоря production
 * (scripts/release/evo-production-browser-smoke.mjs). Только существующие RPC-чтения;
 * каждый источник падает в свой честный fallback, не роняя весь экран.
 */
export default async function StudentPortalHomePage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  // PORT-1a: единственная проверяемая граница уровня доступа — серверный
  // actor.accessTier, без повторной локальной деривации из caseState.
  const tier = actor.accessTier;
  const strings = getPortalStrings("home", locale);

  // Выбор страны «Пути поступления» (284) читается в той же волне, что и
  // остальные чтения «Главной» (план A): лишней последовательной волны нет.
  // Карточка CSCA (Q16) только для Китая: главная трека читается тут же, за
  // выбором, внутри той же волны (цепочка из двух чтений, как у избранного),
  // а студенту с другой страной лишнего чтения нет.
  // Согласие на ИИ-помощников (25.10.2026) читается в той же волне: отдельного
  // круга ожидания нет, а сбой чтения прячет карточку, не роняя «Главную».
  // Только у клиента с делом на сопровождении (tier assisted, он уже известен
  // из actor): самостоятельному студенту вопроса нет, и RPC не вызывается.
  // 03.11.2026: «Учёба и тесты» и «Новое в каталоге» сняты с «Главной» — их
  // чтений здесь больше нет; «Что нового» (лента «Входящих») — только assisted.
  const [overviewResult, news, favoritesResult, choiceRead, aiConsentRead] = await Promise.all([
    tier === "assisted"
      ? readStudentPortalOverview()
        .then((value): { ok: true; value: StudentPortalOverview | null } => ({ ok: true, value }))
        .catch((): { ok: false } => ({ ok: false }))
      : Promise.resolve({ ok: true, value: null } as const),
    tier === "assisted" ? readStudentPortalNotifications().catch((): null => null) : Promise.resolve(null),
    readStudentUniversityFavorites()
      .then(async (saved) => ({
        ok: true as const,
        total: saved.length,
        items: await readStudentUniversitiesByIds(
          saved.slice(0, HOME_FAVORITES_LIMIT).map((favorite) => favorite.institutionId),
        ),
      }))
      .catch(() => ({ ok: false as const })),
    readStudentCountryChoice().catch((): null => null).then(async (choice) => ({
      choice,
      cscaHome: cscaHomeCardVisible(choice) ? await readCscaHome().catch((): null => null) : null,
    })),
    readOwnAiConsent(tier),
  ]);
  const { choice, cscaHome } = choiceRead;
  const now = new Date();
  // 08.11.2026 (пользователь): весь путь на «Поступлении», здесь его карточка — тот же выбор пути и прогресс.
  const journey = selectStudentJourney({
    country: choice?.country ?? null,
    stage: overviewResult.ok ? overviewResult.value?.operationalStage ?? null : undefined,
    locale,
    now,
  });
  const cscaCard = selectCscaHomeCard({
    choice,
    home: cscaHome,
    locale,
    cscaStrings: getPortalStrings("csca", locale),
    homeStrings: strings,
  });

  const country = choice?.country ?? null;
  const studyCountry = country !== null && isStudyCountryCode(country) ? studyCountryName(country, locale) : null;

  // Заголовок страницы — приветствие в шапке HomeView (HomeHero).
  return (
    <main className="pt-page">
      <HomeView
        tier={tier}
        displayName={actor.displayName}
        studyCountry={studyCountry}
        overview={overviewResult.ok ? overviewResult.value : null}
        overviewFailed={!overviewResult.ok}
        news={news}
        favorites={favoritesResult.ok ? favoritesResult.items : null}
        favoritesTotal={favoritesResult.ok ? favoritesResult.total : 0}
        journey={(
          <HomeJourneyCard
            view={journey.view}
            progress={journey.progress}
            readFailed={choice === null}
            locale={locale}
          />
        )}
        csca={cscaCard ? <CscaHomeCard view={cscaCard} /> : null}
        aiConsent={aiConsentRead.status === "ready" ? (
          <AiConsentHomeCard
            initialConsent={aiConsentRead.consent}
            strings={getPortalStrings("aiConsent", locale)}
          />
        ) : null}
        locale={locale}
        now={now}
      />
    </main>
  );
}
