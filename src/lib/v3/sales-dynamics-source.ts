import "server-only";

import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readPeriodDashboard, type Period, type PeriodDashboard } from "@/lib/v3/funnel-source";
import { readPipelineLeads, readPipelineStages } from "@/lib/v3/pipeline-source";
import { salesBoardFunnel, type SalesBoardFunnel } from "@/lib/v3/sales-board-funnel";
import type { SalesCountRead } from "@/lib/sales-numbers-contract";
import { readSalesCount } from "@/lib/v3/sales-numbers-source";

export type SalesDynamicsRead = Readonly<{
  /** null — период не прочитан: «Не удалось загрузить» и «Повторить». */
  dashboard: PeriodDashboard | null;
  /**
   * Воронка по определению доски. `preview` — просмотр роли: проекция передач
   * ему отказывает, числа Admin не показываются; `unavailable` — чтение не
   * удалось.
   */
  funnel: SalesBoardFunnel | Readonly<{ status: "preview" | "unavailable" }>;
  /**
   * «Продажи» за период — одно определение для каждого числа «Продажи» (Э2,
   * решение владельца 26.09.2026): записи отчёта не в архиве с датой продажи
   * в периоде (`staff_sales_count_v1`, миграция 247). `denied` — роль не
   * читает отчёт: числа нет.
   */
  sales: SalesCountRead;
}>;

/**
 * «Динамика по дням» «Отчёта продаж» (Э3, 26.09.2026) — те же чтения, что
 * были у Главной: когорта периода (`readPeriodDashboard`) и доска продаж
 * (`readPipelineLeads`) вместо `current_sales_funnel`, который считал
 * переданного лида в его старом этапе; и «Продажи» периода по одному
 * определению (Э2). Три чтения независимы.
 */
export async function readSalesDynamics(actor: ActivePlatformActor, period: Period): Promise<SalesDynamicsRead> {
  const [dashboard, funnel, sales] = await Promise.all([
    readPeriodDashboard(actor, period).catch(() => null),
    isStaffPreview(actor)
      ? Promise.resolve({ status: "preview" } as const)
      : readPipelineLeads(actor)
        .then((read): SalesDynamicsRead["funnel"] => salesBoardFunnel(read, readPipelineStages()))
        .catch(() => ({ status: "unavailable" } as const)),
    readSalesCount(actor, { from: period.from, to: period.to }),
  ]);
  return Object.freeze({ dashboard, funnel, sales });
}
