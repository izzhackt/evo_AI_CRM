import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProfessionsGrid } from "@/components/portal/professions/ProfessionsGrid";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import {
  isOrvisScaleId,
  ORVIS_SCALE_IDS,
  type ProfessionCardSummary,
} from "@/lib/portal/professions";
import { readOwnOrvisTopScales, readProfessionCards } from "@/lib/portal/professions-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("professions", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Раздел «Профессии» (PORT-4c): сетка карточек с фильтром по шкалам ORVIS и
 * вход в тест интересов. topScales собственного orvis92 читаются существующим
 * приватным student-RPC в сессии ученика; отметка «созвучно» считается на
 * клиенте (план §6 — без серверной связки).
 */
export default async function ProfessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, , locale] = await Promise.all([
    searchParams,
    requireStudentPortalActor(),
    getLocale(),
  ]);
  const rawScale = params.scale;
  if (rawScale !== undefined && !isOrvisScaleId(rawScale)) notFound();
  const activeScale = rawScale !== undefined && isOrvisScaleId(rawScale) ? rawScale : null;
  const strings = getPortalStrings("professions", locale);

  let cards: ProfessionCardSummary[] | null = null;
  try {
    cards = await readProfessionCards();
  } catch {
    cards = null;
  }
  const topScales = cards === null ? null : await readOwnOrvisTopScales();

  const filtered = cards?.filter(
    (card) => activeScale === null || card.orvisScales.includes(activeScale),
  ) ?? null;

  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>

      <div className="pt-learn-entries">
        <Link className="pt-btn-ghost" href="/portal/tests/career">{strings.testEntry}</Link>
        <p className="pt-learn-note">{strings.testEntryHint}</p>
      </div>

      {cards === null || filtered === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <>
          <nav aria-label={strings.filterAria} className="pt-prof-filter">
            <Link
              className="pt-chip"
              aria-current={activeScale === null ? "true" : undefined}
              href="/portal/professions"
            >
              {strings.allScales}
            </Link>
            {ORVIS_SCALE_IDS.map((scale) => (
              <Link
                key={scale}
                className="pt-chip"
                aria-current={activeScale === scale ? "true" : undefined}
                href={`/portal/professions?scale=${scale}`}
              >
                {strings[`scale.${scale}`]}
              </Link>
            ))}
          </nav>
          {filtered.length === 0 ? (
            <div className="pt-empty">
              <p className="pt-empty-title">{strings.emptyTitle}</p>
              <p className="pt-empty-body">{strings.emptyBody}</p>
            </div>
          ) : (
            <ProfessionsGrid
              cards={filtered}
              topScales={topScales}
              locale={locale}
              strings={strings}
            />
          )}
        </>
      )}
    </main>
  );
}
