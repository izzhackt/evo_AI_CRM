import { packageStrings } from "@/components/portal/applicationPackages/strings";
import { PendingPackagesLink } from "@/components/portal/applicationPackages/PendingPackagesLink";
import type { Metadata } from "next";
import Link from "next/link";
import { PreparationList } from "@/components/portal/admissionPreparations/PreparationList";
import { readStudentCatalogPreparations } from "@/lib/portal/catalog-preparations-source";

import { OverviewView } from "@/components/portal/admission/OverviewView";
import { AiConsentSlot } from "@/components/portal/consent/AiConsentSlot";
import { FavoritesSection } from "@/components/portal/favorites/FavoritesSection";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readStudentUniversityFavorites } from "@/lib/portal/university-favorites-source";
import { readStudentPortalOverview } from "@/lib/v3/portal-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";
import { CaseHelpWorkspace } from "@/components/staff/profile/CaseHelpWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("admission", await getLocale());
  return { title: `${strings.overviewTitle} — EVO Admissions` };
}

type AdmissionView = "universities" | "programs";

/**
 * «Моё поступление» в Атласе (PORT-5d). Смоук-якорь production: заголовок
 * «Моё поступление» — байт-в-байт (PORT-6a: RU-значение живёт ключом
 * admission.overviewTitle, смоук-аккаунт — language=ru). CaseHelpWorkspace
 * (разовый вопрос-ответ) остаётся как есть — переписка живёт в
 * /portal/messages (PORT-5c). Согласие на ИИ-помощников (25.10.2026) стоит
 * над обзором: после логина студент попадает сюда, не на «Главную»; карточка
 * сама исчезает, когда для текущей версии текста есть решение. Самостоятельному
 * студенту без дела на сопровождении (accessTier approved) её нет вовсе.
 *
 * 03.11.2026 (по образцу «Мой список» в кабинете пользователя): сверху плитки
 * с числами («Требуют действия» ведёт к первому делу), затем две вкладки-ссылки — «Вузы» (бывшее
 * «Избранное», по умолчанию) и «Программы» (выбранные программы,
 * ?view=programs).
 */
export default async function StudentPortalOverviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const [actor, locale] = await Promise.all([requireStudentPortalActor(), getLocale()]);
  const view: AdmissionView = (await searchParams).view === "programs" ? "programs" : "universities";
  const strings = getPortalStrings("admission", locale);

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.overviewTitle}</h1>
      </header>
      <AiConsentSlot locale={locale} accessTier={actor.accessTier} />
      {/* Обзор с подготовками и обращения — соседние серверные компоненты:
          их чтения идут одновременно, а не одно после другого (план A). */}
      <AdmissionOverview actor={actor} locale={locale} view={view} />
      {/* Якорь #case-help — у самой панели (CaseHelpPanel); на обёртке id нет (#1115). */}
      <div className="pt-adm-case-help"><CaseHelpWorkspace actor={actor} caseId={actor.studentCaseId} student /></div>
    </main>
  );
}

async function AdmissionOverview({ actor, locale, view }: Readonly<{
  actor: Awaited<ReturnType<typeof requireStudentPortalActor>>;
  locale: Awaited<ReturnType<typeof getLocale>>;
  view: AdmissionView;
}>) {
  // Избранное читается вместе с обзором и подготовками (одновременно).
  const favoritesRead = readStudentUniversityFavorites()
    .then((items) => items.map((item) => item.institutionId))
    .catch((): null => null);
  const [overview, preparations] = await Promise.all([
    readStudentPortalOverview().catch(() => undefined),
    readStudentCatalogPreparations(actor.studentCaseId).catch(() => null),
  ]);
  const favorites = await favoritesRead;
  const strings = getPortalStrings("admission", locale);
  const preparationStrings = getPortalStrings("preparations", locale);
  return (
    <>
      {overview === undefined ? <p className="pt-prep-error" role="status">{preparationStrings.overviewUnavailable}</p> : <OverviewView overview={overview} pending={actor.caseState === "pending"} locale={locale} favoritesCount={favorites?.length ?? null} programsCount={preparations?.length ?? null} />}
      {/* «Незавершённые отправки» видны на любой вкладке: оборванная отправка не зависит от выбранного вида (#1341). */}
      <div className="pt-pending-packages">
        <PendingPackagesLink owner={{ organizationId: actor.organizationId, membershipId: actor.membershipId }} label={packageStrings(locale).pendingTitle} />
      </div>
      <nav className="pt-pill-tabs" aria-label={strings.tabsLabel}>
        <Link className="pt-pill-tab" href="/portal" aria-current={view === "universities" ? "true" : undefined}>
          {strings["tab.universities"]}
          {favorites !== null ? <span className="pt-pill-count">{favorites.length}</span> : null}
        </Link>
        <Link className="pt-pill-tab" href="/portal?view=programs" aria-current={view === "programs" ? "true" : undefined}>
          {strings["tab.programs"]}
          {preparations !== null ? <span className="pt-pill-count">{preparations.length}</span> : null}
        </Link>
      </nav>
      {view === "universities" ? (
        <FavoritesSection institutionIds={favorites} locale={locale} />
      ) : (
        <PreparationList items={preparations} strings={preparationStrings} canSelect={actor.caseState === "active" && Boolean(actor.portalActivatedAt)} />
      )}
    </>
  );
}
