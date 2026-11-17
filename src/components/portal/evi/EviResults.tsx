import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { EviResult } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Три профессии от Эви — пьедестал: первая — крупная тёмная карточка в облике шапки «Главной» (графит, красные
 * градиенты, знак EVO), вторая и третья — рядом под ней. На карточке: место крупной цифрой, название, строка «чем
 * занимается» и интересы теста — из самой карточки каталога, объяснение «почему» словами Эви и «Где учиться». Вся
 * карточка — одна ссылка: на раздел «Где учиться в EVO» страницы профессии. Процентов и оценок нет: сравнивать не с чем
 * (CLAUDE.md, «Что считается ложью»).
 */
export function EviResults({ results, strings }: Readonly<{
  results: readonly EviResult[];
  strings: PortalStrings<"professions">;
}>) {
  return (
    <ol className="pt-evi-results" aria-label={strings["evi.resultsLabel"]}>
      {results.map((result, index) => (
        <li key={result.cardId} className="pt-evi-result" data-rank={index + 1}>
          <span className="pt-evi-result-n" aria-hidden="true">{index + 1}</span>
          <div className="pt-evi-result-body">
            <h3 className="pt-evi-result-title">
              <IntentPrefetchLink href={`/portal/professions/${result.cardId}#pt-prof-study-title`}>{result.title}</IntentPrefetchLink>
            </h3>
            {result.summary ? <p className="pt-evi-result-what">{result.summary}</p> : null}
            {result.scales.length > 0 ? (
              <ul className="pt-chip-row" aria-label={strings["evi.interests"]}>
                {result.scales.map((scale) => <li key={scale} className="pt-chip">{strings[`scale.${scale}`]}</li>)}
              </ul>
            ) : null}
            <p className="pt-evi-result-why">{result.why}</p>
            <span className="pt-evi-result-go" aria-hidden="true">
              {strings["evi.where"]}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
