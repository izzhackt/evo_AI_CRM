import { IntentPrefetchLink } from "@/components/IntentPrefetchLink";
import { ProfessionPhoto } from "@/components/portal/professions/ProfessionPhoto";
import type { EviResult } from "@/lib/portal/evi";
import type { PortalStrings } from "@/lib/portal/i18n";

/**
 * Три профессии от Эви — карточки с фото: снимок профессии (по ключу карточки каталога; нет файла — нет фото), номер
 * красным кружком на фото, название-ссылка на карточку каталога (там «Где учиться в EVO»; ссылка покрывает всю карточку),
 * строка «чем занимается» из самой карточки каталога и объяснение «почему» словами Эви. Процентов и оценок нет:
 * сравнивать не с чем (CLAUDE.md, «Что считается ложью»).
 */
export function EviResults({ results, strings }: Readonly<{
  results: readonly EviResult[];
  strings: PortalStrings<"professions">;
}>) {
  return (
    <ol className="pt-evi-results" aria-label={strings["evi.resultsLabel"]}>
      {results.map((result, index) => (
        <li key={result.cardId} className="pt-evi-result">
          <span className="pt-evi-result-media" aria-hidden="true">
            <ProfessionPhoto cardKey={result.cardKey} className="pt-evi-result-photo" />
            <span className="pt-evi-result-n pt-data">{index + 1}</span>
          </span>
          <div className="pt-evi-result-body">
            <h3 className="pt-evi-result-title">
              <IntentPrefetchLink href={`/portal/professions/${result.cardId}`}>{result.title}</IntentPrefetchLink>
            </h3>
            {result.summary ? <p className="pt-evi-result-what">{result.summary}</p> : null}
            <p className="pt-evi-result-why">{result.why}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
