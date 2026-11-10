import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";

import type { Locale } from "@/lib/i18n-data";
import { formatPortalString, type PortalStrings } from "@/lib/portal/i18n";
import type { ProfessionMatch } from "@/lib/portal/profession-guide";

/**
 * «Подходят вам» (разбор владельца 10.11.2026, п. 2): три профессии с самым
 * высоким совпадением по собственному orvis92 и причиной — шкалы профессии,
 * где интерес студента высокий. Как считается процент — в подсказке «?».
 */
export function ProfessionMatches({
  matches,
  locale,
  strings,
}: {
  matches: readonly ProfessionMatch[];
  locale: Locale;
  strings: PortalStrings<"professions">;
}) {
  if (matches.length === 0) return null;
  return (
    <section className="pt-prof-block" aria-labelledby="pt-prof-matches-title">
      <div className="pt-prof-block-head">
        <h2 id="pt-prof-matches-title" className="pt-prof-block-title">{strings.matchesHeading}</h2>
        <details className="pt-prof-help">
          <summary>
            <span>{strings.matchesSource}</span>
            <span className="pt-prof-help-mark" aria-hidden="true">?</span>
            <span className="pt-sr-only">{strings.matchesHelpLabel}</span>
          </summary>
          <p>{strings.matchesHelp}</p>
        </details>
      </div>
      <ul className="pt-prof-grid pt-prof-matches">
        {matches.map(({ card, percent, reasons }) => (
          <li key={card.cardId}>
            <article className="pt-prof-card">
              <p className="pt-prof-match-percent pt-data">
                <span aria-hidden="true">{percent}%</span>
                <span className="pt-sr-only">{formatPortalString(strings.matchPercent, { percent: String(percent) })}</span>
              </p>
              <h3 className="pt-prof-title">
                <IntentPrefetchLink href={`/portal/professions/${card.cardId}`}>
                  {locale === "ky" ? card.titleKy : card.titleRu}
                </IntentPrefetchLink>
              </h3>
              <p className="pt-prof-reasons">
                {formatPortalString(strings.matchReasons, {
                  scales: reasons.map((scale) => strings[`scale.${scale}`]).join(", "),
                })}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
