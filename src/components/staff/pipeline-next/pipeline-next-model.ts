import { dueWordOf, type DueWordView } from "@/components/staff/queue/due-bucket";
import { leadDisplayName } from "@/lib/v3/wording";
import type { PipelineLead, PipelineStage, PipelineStageKey } from "@/components/staff/pipeline-next/types";

/**
 * Чистые помощники «Воронки продаж» нового вида (без JSX — их проверяют тесты напрямую). Правила те же, что у прежней доски
 * (`Pipeline.tsx`): имя лида из звонка, срок словом от дня чтения страницы, срез «Переданы».
 */

/** Терминальная колонка копится вечно: свёрнутой она показывает только последние карточки (строки приходят новыми вперёд). */
export const HANDED_VISIBLE_LIMIT = 20;

/**
 * Рабочая колонка «Всех этапов» (26.11.2026: в «Новом» 559 карточек одной лентой): сначала первые 20, «Показать ещё» прибавляет по 20.
 * Остаток в пару карточек показывается сразу — кнопка «ещё 1» хуже самой карточки. Открытый лид виден всегда.
 */
export const COLUMN_STEP = 20;
const COLUMN_SLACK = 2;
export function columnLimit(inStage: readonly PipelineLead[], shown: number | undefined, selectedId: string | null): number {
  const base = Math.max(COLUMN_STEP, shown ?? 0);
  const selected = selectedId === null ? -1 : inStage.findIndex((lead) => lead.id === selectedId);
  const limit = Math.max(base, selected + 1);
  return inStage.length - limit <= COLUMN_SLACK ? inStage.length : limit;
}

export const leadLabel = (lead: Pick<PipelineLead, "source" | "name">): string => leadDisplayName(lead.source, lead.name);

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
  shown: Readonly<Partial<Record<string, number>>> = {},
  selectedId: string | null = null,
): readonly StageColumn[] {
  return stages
    .filter((stage) => (focus === "all" ? !stage.terminal : stage.key === focus))
    .map((stage) => {
      const inStage = leads.filter((lead) => lead.stageKey === stage.key);
      const visible = stage.terminal
        ? (handedExpanded ? inStage : inStage.slice(0, HANDED_VISIBLE_LIMIT))
        : focus === "all" ? inStage.slice(0, columnLimit(inStage, shown[stage.key], selectedId)) : inStage;
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
