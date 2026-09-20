"use client";

import Link from "next/link";

import type { Locale } from "@/lib/i18n-data";
import type { PortalStrings } from "@/lib/portal/i18n";
import {
  professionResonates,
  type OrvisScaleId,
  type ProfessionCardSummary,
} from "@/lib/portal/professions";

/**
 * Сетка профессий (PORT-4c). Отметка «созвучно твоим интересам» считается
 * здесь, на клиенте, из topScales собственного завершённого orvis92 —
 * серверной связки результатов теста с профессиями нет (план §6).
 */

type Strings = PortalStrings<"professions">;

export function scaleLabel(strings: Strings, scale: OrvisScaleId): string {
  return strings[`scale.${scale}` as keyof Strings] as string;
}

export function ProfessionsGrid({
  cards,
  topScales,
  locale,
  strings,
}: {
  cards: ProfessionCardSummary[];
  topScales: string[] | null;
  locale: Locale;
  strings: Strings;
}) {
  const anyResonance = cards.some((card) => professionResonates(card.orvisScales, topScales));
  return (
    <div>
      {anyResonance ? <p className="pt-prof-resonance-hint">{strings.resonanceHint}</p> : null}
      <ul className="pt-prof-grid">
        {cards.map((card) => {
          const resonates = professionResonates(card.orvisScales, topScales);
          return (
            <li key={card.cardId}>
              <article className={resonates ? "pt-prof-card pt-prof-card-resonant" : "pt-prof-card"}>
                {resonates ? (
                  <p className="pt-prof-resonance">{strings.resonance}</p>
                ) : null}
                <h2 className="pt-prof-title">
                  <Link href={`/portal/professions/${card.cardId}`}>
                    {locale === "ky" ? card.titleKy : card.titleRu}
                  </Link>
                </h2>
                <p className="pt-chip-row">
                  {card.orvisScales.map((scale) => (
                    <span key={scale} className="pt-chip">{scaleLabel(strings, scale)}</span>
                  ))}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
