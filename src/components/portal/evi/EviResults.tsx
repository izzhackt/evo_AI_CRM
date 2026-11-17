import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import type { EviResult } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Три профессии от Эви — во всю ширину разговора: номер, название-ссылка на карточку каталога (там «Где учиться в EVO»;
 * ссылка покрывает всю карточку), строка «чем занимается» из самой карточки каталога и объяснение «почему» словами Эви.
 * Процентов и оценок нет: сравнивать не с чем (CLAUDE.md, «Что считается ложью»).
 */
export function EviResults({ results, strings }: Readonly<{
  results: readonly EviResult[];
  strings: PortalStrings<"professions">;
}>) {
  return (
    <ol className="pt-evi-results" aria-label={strings["evi.resultsLabel"]}>
      {results.map((result, index) => (
        <li key={result.cardId} className="pt-evi-result">
          <span className="pt-evi-result-n pt-data" aria-hidden="true">{index + 1}</span>
          <h3 className="pt-evi-result-title">
            <IntentPrefetchLink href={`/portal/professions/${result.cardId}`}>{result.title}</IntentPrefetchLink>
          </h3>
          {result.summary ? <p className="pt-evi-result-what">{result.summary}</p> : null}
          <p className="pt-evi-result-why">{result.why}</p>
        </li>
      ))}
    </ol>
  );
}
