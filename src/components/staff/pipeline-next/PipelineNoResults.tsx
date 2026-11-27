import Link from "next/link";

import type { PipelineLead, PipelineStageKey } from "@/components/staff/pipeline-next/types";
import { pipelineWords } from "@/lib/v3/wording";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Пустой поиск на доске «Воронки продаж»: одно состояние вместо «Нет лидов» в каждой колонке. На вкладке этапа «лидов нет» было бы
 * ложью, когда лид найден на другом этапе (27.11.2026): тогда сказано «на этом этапе» и дана ссылка «Показать все этапы». Вынесено из
 * доски, чтобы она осталась в 150 строках после «Показать ещё» (26.11.2026); слова, ссылки и разметка не менялись.
 */
export function PipelineNoResults({ query, filtered, stage, leads, handedFound, href, resetHref }: Readonly<{
  query: string;
  /** Выбраны срок, назначение или ответственный: слова это называют, а сброс снимает всё сразу. */
  filtered: boolean;
  stage: PipelineStageKey | "all";
  /** Всё, что нашло чтение: доска читает все этапы, поэтому лид из запроса приходит и с другого этапа. */
  leads: readonly PipelineLead[];
  /** Совпали переданные лиды, а выбранная вкладка — не «Переданы». */
  handedFound: boolean;
  href: (patch: Readonly<Record<string, string | null>>) => string;
  resetHref: string;
}>) {
  // Этап — вид, а не фильтр чтения (доска читает все этапы): если на выбранной вкладке пусто, а лиды по запросу есть, они на других этапах.
  // «Все этапы» ведёт к рабочим этапам, а переданных там нет — для них своя ссылка.
  const stageEmpty = stage !== "all" && leads.length > 0;
  const workingElsewhere = stageEmpty && leads.some((lead) => lead.stageKey !== "handed_off");
  return (
    <div className="grid justify-items-start gap-2 py-6" data-testid="v3-pipeline-no-results">
      <p role="status" className="t-body text-fg">{stageEmpty ? pipelineWords.noResultsInStage(query, filtered) : pipelineWords.noResults(query, filtered)}</p>
      {workingElsewhere ? <Link href={href({ stage: null, lead: null })} className={LINK}>{pipelineWords.showAllStages}</Link> : null}
      {handedFound ? <Link href={href({ stage: "handed_off", lead: null })} className={LINK}>{pipelineWords.foundHanded}</Link> : null}
      <Link href={filtered ? resetHref : href({ q: null, lead: null })} className={LINK}>{pipelineWords.resetSearch(filtered)}</Link>
    </div>
  );
}
