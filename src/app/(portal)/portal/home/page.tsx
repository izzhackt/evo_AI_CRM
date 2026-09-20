import type { Metadata } from "next";

import { HomeView } from "@/components/portal/home/HomeView";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readLearningModules } from "@/lib/portal/learning-source";
import { readStudentRecentUniversities } from "@/lib/portal/recent-universities-source";
import {
  readStudentUniversitiesByIds,
  readStudentUniversityFavorites,
} from "@/lib/portal/university-favorites-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { readStudentAssessments } from "@/lib/v3/student-assessment-source";
import {
  readStudentPortalOverview,
  type StudentPortalOverview,
} from "@/lib/v3/portal-source";

export const dynamic = "force-dynamic";

/** Показываем на «Главной» первые записи избранного; полный список — /portal/favorites. */
const HOME_FAVORITES_LIMIT = 4;

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("home", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * «Главная» кабинета (PORT-9c). Живёт на отдельном маршруте: корень /portal
 * остаётся «Моим поступлением» — его заголовок, точка входа после логина и
 * ссылка nav — замороженные смоук-якоря production
 * (scripts/evo-production-browser-smoke.mjs). Только существующие RPC-чтения;
 * каждый источник падает в свой честный fallback, не роняя весь экран.
 */
export default async function StudentPortalHomePage() {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  // PORT-1a: единственная проверяемая граница уровня доступа — серверный
  // actor.accessTier, без повторной локальной деривации из caseState.
  const tier = actor.accessTier;
  const strings = getPortalStrings("home", locale);

  const [overviewResult, modules, assessments, favoritesResult, recentUniversities] = await Promise.all([
    tier === "assisted"
      ? readStudentPortalOverview()
        .then((value): { ok: true; value: StudentPortalOverview | null } => ({ ok: true, value }))
        .catch((): { ok: false } => ({ ok: false }))
      : Promise.resolve({ ok: true, value: null } as const),
    readLearningModules().catch((): null => null),
    readStudentAssessments().catch((): null => null),
    readStudentUniversityFavorites()
      .then(async (saved) => ({
        ok: true as const,
        total: saved.length,
        items: await readStudentUniversitiesByIds(
          saved.slice(0, HOME_FAVORITES_LIMIT).map((favorite) => favorite.institutionId),
        ),
      }))
      .catch(() => ({ ok: false as const })),
    readStudentRecentUniversities().catch((): null => null),
  ]);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">
          {tier === "assisted" ? strings.leadAssisted : strings.leadApproved}
        </p>
      </header>
      <HomeView
        tier={tier}
        overview={overviewResult.ok ? overviewResult.value : null}
        overviewFailed={!overviewResult.ok}
        modules={modules}
        assessments={assessments}
        favorites={favoritesResult.ok ? favoritesResult.items : null}
        favoritesTotal={favoritesResult.ok ? favoritesResult.total : 0}
        recentUniversities={recentUniversities}
        locale={locale}
        now={new Date()}
      />
    </main>
  );
}
