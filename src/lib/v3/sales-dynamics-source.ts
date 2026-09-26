import "server-only";

import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readPeriodDashboard, type Period, type PeriodDashboard } from "@/lib/v3/funnel-source";
import { readPipelineLeads, readPipelineStages } from "@/lib/v3/pipeline-source";
import { salesBoardFunnel, type SalesBoardFunnel } from "@/lib/v3/sales-board-funnel";

export type SalesDynamicsRead = Readonly<{
  /** null — период не прочитан: «Не удалось загрузить» и «Повторить». */
  dashboard: PeriodDashboard | null;
  /**
   * Воронка по определению доски. `preview` — просмотр роли: проекция передач
   * ему отказывает, числа Admin не показываются; `unavailable` — чтение не
   * удалось.
   */
  funnel: SalesBoardFunnel | Readonly<{ status: "preview" | "unavailable" }>;
}>;

/**
 * «Динамика по дням» «Отчёта продаж» (Э3, 26.09.2026) — те же чтения, что
 * были у Главной: когорта периода (`readPeriodDashboard`) и доска продаж
 * (`readPipelineLeads`) вместо `current_sales_funnel`, который считал
 * переданного лида в его старом этапе. Два чтения независимы.
 */
export async function readSalesDynamics(actor: ActivePlatformActor, period: Period): Promise<SalesDynamicsRead> {
  const [dashboard, funnel] = await Promise.all([
    readPeriodDashboard(actor, period).catch(() => null),
    isStaffPreview(actor)
      ? Promise.resolve({ status: "preview" } as const)
      : readPipelineLeads(actor)
        .then((read): SalesDynamicsRead["funnel"] => salesBoardFunnel(read, readPipelineStages()))
        .catch(() => ({ status: "unavailable" } as const)),
  ]);
  return Object.freeze({ dashboard, funnel });
}
