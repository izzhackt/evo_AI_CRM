import type { SalesRegisterRow } from "@/lib/platform-sales-register-contract";

import { salesMoney } from "./sales-next-rows";
import type { SalesManagerSummaryData } from "./sales-next-types";

/**
 * «Продажи по менеджерам» за выбранный месяц: по каждому менеджеру число продаж и сумма стоимости, внизу — итог. Считается из тех же
 * строк выборки, что и «Суммы по записям» (все страницы выборки), по тем же правилам: архивные записи и «Убрано из продаж» (307) в
 * число и суммы не входят. Сумма — по валюте стоимости, как записана: валюты не пересчитываются и не складываются между собой; запись без
 * стоимости считается продажей, но в сумму не входит (число таких записей названо рядом). Нет строк выборки — нет и сводки.
 */
export function salesManagerSummary(
  rows: readonly SalesRegisterRow[],
  managerName: (row: Pick<SalesRegisterRow, "managerKey" | "managerLabel">) => string,
): SalesManagerSummaryData {
  type Acc = { name: string; count: number; noCost: number; sums: Map<string, number> };
  const make = (name: string): Acc => ({ name, count: 0, noCost: 0, sums: new Map() });
  const byManager = new Map<string, Acc>();
  const total = make("Итого");
  const add = (acc: Acc, row: SalesRegisterRow) => {
    acc.count += 1;
    if (row.serviceCostMinor === null || row.serviceCostCurrency === null) acc.noCost += 1;
    else acc.sums.set(row.serviceCostCurrency, (acc.sums.get(row.serviceCostCurrency) ?? 0) + row.serviceCostMinor);
  };
  for (const row of rows) {
    if (row.archived || row.withdrawal) continue;
    const name = managerName(row) || "Менеджер не указан";
    const key = row.managerKey || name.toLocaleLowerCase("ru");
    const acc = byManager.get(key) ?? make(name);
    byManager.set(key, acc);
    add(acc, row);
    add(total, row);
  }
  const line = (acc: Acc) => ({
    name: acc.name,
    count: acc.count,
    sums: [...acc.sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => salesMoney(minor, currency) ?? ""),
    noCost: acc.noCost,
  });
  return {
    managers: [...byManager.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru")).map(line),
    total: line(total),
  };
}
