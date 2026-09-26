/**
 * Воронка раздела «Динамика по дням» «Отчёта продаж» — по определению доски
 * продаж (Э3, 26.09.2026): рабочие этапы и «Переданы» из того же чтения, что
 * у доски (`readPipelineLeads`: переданный лид — колонка «Переданы», а не
 * свой старый этап). Прежняя воронка Главной считала этап `stage_key` и
 * показывала переданного лида «Новым» — одно дело, два числа.
 *
 * Чистая функция: по ней рисует раздел и проверяет unit-тест.
 */
import type { PipelineLead, PipelineStage } from "../../components/v3/Pipeline.tsx";

export type SalesBoardFunnel =
  | Readonly<{
      status: "available";
      stages: readonly Readonly<{ key: string; name: string; value: number }>[];
      /** В работе — как число в заголовке доски: всё, кроме «Переданы». */
      working: number;
    }>
  /** Чтение доски упёрлось в предел: чисел нет, а не заниженные числа. */
  | Readonly<{ status: "truncated" }>;

export function salesBoardFunnel(
  read: Readonly<{ leads: readonly Pick<PipelineLead, "stageKey">[]; truncated: boolean }>,
  stages: readonly PipelineStage[],
): SalesBoardFunnel {
  if (read.truncated) return Object.freeze({ status: "truncated" });
  const counts = new Map<string, number>();
  for (const lead of read.leads) {
    if (!stages.some((stage) => stage.key === lead.stageKey)) throw new Error("Sales board returned a lead outside its stages.");
    counts.set(lead.stageKey, (counts.get(lead.stageKey) ?? 0) + 1);
  }
  return Object.freeze({
    status: "available",
    stages: Object.freeze(stages.map((stage) => Object.freeze({ key: stage.key, name: stage.title, value: counts.get(stage.key) ?? 0 }))),
    working: read.leads.filter((lead) => lead.stageKey !== "handed_off").length,
  });
}
