import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProfessionMatches } from "@/components/portal/professions/ProfessionMatches";
import { ProfessionsBrowser } from "@/components/portal/professions/ProfessionsBrowser";
import { ProfessionsTestHero } from "@/components/portal/professions/ProfessionsTestHero";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { topProfessionMatches } from "@/lib/portal/profession-guide";
import { isOrvisScaleId, type ProfessionCardSummary } from "@/lib/portal/professions";
import { readOwnOrvisState, readProfessionCards } from "@/lib/portal/professions-source";
import { requireStudentPortalActor } from "@/lib/student-portal-guards";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const strings = getPortalStrings("professions", await getLocale());
  return { title: `${strings.title} — EVO Admissions` };
}

/**
 * Раздел «Профессии» (PORT-4c; вид по драфту владельца 10.11.2026): тест
 * интересов сверху, «Подходят вам» по собственному orvis92, поиск, фильтр и
 * группы по интересам. Результат теста читается существующими приватными
 * student-RPC в сессии ученика; процент считается из его же шкал.
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

  // Карточки и собственный тест не зависят друг от друга — одним заходом.
  const [cards, orvis] = await Promise.all([
    readProfessionCards().catch((): ProfessionCardSummary[] | null => null),
    readOwnOrvisState(),
  ]);
  const matches = cards && orvis?.profile && activeScale === null
    ? topProfessionMatches(cards, orvis.profile)
    : [];
  const filtered = cards?.filter(
    (card) => activeScale === null || card.orvisScales.includes(activeScale),
  ) ?? null;

  return (
    <main className="pt-page pt-prof-page">
      <header className="pt-page-header">
        <h1 className="pt-page-title">{strings.title}</h1>
      </header>

      <ProfessionsTestHero state={orvis} strings={strings} />

      {cards === null || filtered === null ? (
        <p role="alert" className="pt-alert">{strings.unavailable}</p>
      ) : (
        <>
          <ProfessionMatches matches={matches} locale={locale} strings={strings} />
          <ProfessionsBrowser
            cards={filtered}
            activeScale={activeScale}
            locale={locale}
            strings={strings}
          />
        </>
      )}
    </main>
  );
}
