import { dueWordOf, type DueWordView } from "@/components/v3/queue/due-bucket";
import { leadDisplayName } from "@/lib/v3/wording";
import type { PipelineLead, PipelineStage, PipelineStageKey } from "@/components/v3/pipeline-next/types";

/**
 * Чистые помощники «Воронки продаж» нового вида (без JSX — их проверяют тесты напрямую). Правила те же, что у прежней доски
 * (`Pipeline.tsx`): имя лида из звонка, срок словом от дня чтения страницы, срез «Переданы».
 */

/** Терминальная колонка копится вечно: свёрнутой она показывает только последние карточки (строки приходят новыми вперёд). */
export const HANDED_VISIBLE_LIMIT = 20;

export const leadLabel = (lead: Pick<PipelineLead, "source" | "name">): string => leadDisplayName(lead.source, lead.name);

/** «на этапе 4 дн» — слово этапа и «дн». */
export const stageAgeCopy = (days: number): string => `на этапе ${days} дн`;

/** Срок лида словом от полудня сегодняшнего дня Бишкека, который прочитала страница; без срока — null. */
export function leadDueWord(lead: PipelineLead, today: string): DueWordView | null {
  const dueDate = lead.nextActionAt ? lead.workflow.nextActionDueDate : null;
  if (!dueDate) return null;
  return dueWordOf({ dueOn: dueDate, dueAt: null }, new Date(`${today}T06:00:00.000Z`));
}

export type StageColumn = Readonly<{ stage: PipelineStage; inStage: readonly PipelineLead[]; visible: readonly PipelineLead[] }>;

/**
 * Колонки доски. «Все этапы» — рабочие этапы рядом; «Переданы» (терминальный исход) отдельной вкладкой, не колонкой. Фокус на
 * этапе — одна колонка. Переданные: последние `HANDED_VISIBLE_LIMIT`, пока не раскрыты (`handed=all`).
 */
export function boardColumns(
  stages: readonly PipelineStage[],
  leads: readonly PipelineLead[],
  focus: PipelineStageKey | "all",
  handedExpanded: boolean,
): readonly StageColumn[] {
  return stages
    .filter((stage) => (focus === "all" ? !stage.terminal : stage.key === focus))
    .map((stage) => {
      const inStage = leads.filter((lead) => lead.stageKey === stage.key);
      const visible = stage.terminal && !handedExpanded ? inStage.slice(0, HANDED_VISIBLE_LIMIT) : inStage;
      return { stage, inStage, visible };
    });
}

/** Адрес доски с изменёнными параметрами; прочие параметры сохраняются. */
export function boardHrefOf(pathname: string, search: string, patch: Readonly<Record<string, string | null>>): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
