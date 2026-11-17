import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EviTab } from "@/components/portal/evi/EviTab";
import { ProfessionMatches } from "@/components/portal/professions/ProfessionMatches";
import { ProfessionsBrowser } from "@/components/portal/professions/ProfessionsBrowser";
import { ProfessionsTabs } from "@/components/portal/professions/ProfessionsTabs";
import { ProfessionsTestHero } from "@/components/portal/professions/ProfessionsTestHero";
import { getLocale } from "@/lib/i18n";
import { readOwnAiConsentForProfile } from "@/lib/portal/ai-consent-source";
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
 * Вкладка «Подбор с Эви» (`?view=evi`, решение владельца 16.11.2026) — разговор с ИИ-профориентатором; каталог
 * остаётся вкладкой по умолчанию. Неизвестный `view` или `scale` — 404.
 */
export default async function ProfessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, actor, locale] = await Promise.all([
    searchParams,
    requireStudentPortalActor(),
    getLocale(),
  ]);
  const rawView = params.view;
  if (rawView !== undefined && rawView !== "evi") notFound();
  const rawScale = params.scale;
  if (rawScale !== undefined && !isOrvisScaleId(rawScale)) notFound();
  const activeScale = rawScale !== undefined && isOrvisScaleId(rawScale) ? rawScale : null;
  const strings = getPortalStrings("professions", locale);

  if (rawView === "evi") {
    const consent = await readOwnAiConsentForProfile(actor.accessTier);
    return (
      <main className="pt-page pt-prof-page pt-prof-page-evi">
        <header className="pt-page-header">
          <h1 className="pt-page-title">{strings.title}</h1>
        </header>
        <ProfessionsTabs view="evi" strings={strings} />
        <EviTab consent={consent} strings={strings} />
      </main>
    );
  }

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
      <ProfessionsTabs view="catalog" strings={strings} />

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
