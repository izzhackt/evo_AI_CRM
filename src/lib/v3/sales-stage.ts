/**
 * Этап лида в продажах — одно правило для доски, воронки, «Сегодня» и
 * Lead 360 (Э2 «Честные числа», решения владельца 26.09.2026).
 *
 * Зеркало SQL `platform_private.sales_lead_stage` (миграция 247) с той же
 * таблицей истинности (tests/v3-honest-numbers.test.mjs и
 * supabase/tests/platform_sales_one_truth.sql):
 *
 *  - лид не открыт (закрыт, дисквалифицирован, в архиве) — `closed`: рабочим
 *    он не считается никогда, на доске и в воронке его нет;
 *  - завершённая передача в поступление — `handed_off`, колонка «Переданы»,
 *    каким бы ни остался `stage_key`; запись продажи в архиве передачу не
 *    отменяет и на рабочую доску лида не возвращает;
 *  - иначе — канонический этап `stage_key`.
 *
 * «Завершённая передача» определена один раз в SQL
 * (`platform_private.sales_lead_handoffs`) и приходит сюда флагом из
 * `staff_sales_handoff_facts` или `staff_lead_handoff_strip_v1`.
 */
import { PLATFORM_SALES_STAGES, type PlatformSalesStage } from "../platform-sales-contract.ts";

export type SalesBoardStage = PlatformSalesStage | "handed_off";
export type ResolvedSalesStage = SalesBoardStage | "closed";

/** Колонки доски по порядку: шесть рабочих этапов и «Переданы». */
export const SALES_BOARD_STAGES: readonly SalesBoardStage[] = Object.freeze([...PLATFORM_SALES_STAGES, "handed_off"]);

export function resolveSalesStage(input: Readonly<{
  lifecycleState: string;
  stageKey: PlatformSalesStage;
  handedOff: boolean;
}>): ResolvedSalesStage {
  if (input.lifecycleState !== "open") return "closed";
  if (input.handedOff) return "handed_off";
  return input.stageKey;
}

/** Рабочий этап: лид на доске и не передан. */
export function isWorkingSalesStage(stage: string): stage is PlatformSalesStage {
  return (PLATFORM_SALES_STAGES as readonly string[]).includes(stage);
}

export function isResolvedSalesStage(value: unknown): value is ResolvedSalesStage {
  return typeof value === "string" && (value === "closed" || (SALES_BOARD_STAGES as readonly string[]).includes(value));
}
