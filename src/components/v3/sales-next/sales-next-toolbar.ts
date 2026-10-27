import { staffCanAccessRoute } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { SalesRegisterPage } from "@/lib/v3/sales-register-page";
import { salesManagersHref, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { groupSalesLabels, salesLabelGroupOf, salesPeriodSteps } from "@/lib/sales-register-view";

import { salesTidy } from "./sales-next-rows";

/**
 * Что нужно строке поиска и фильтров и переключателю периода (`SalesReportToolbar`, `SalesPeriodStepper`): адреса с теми же параметрами,
 * что у прежнего вида, выбранные значения и число включённых фильтров. Считается так же, как в `SalesRegisterView`.
 */
export function salesToolbarInputs(page: SalesRegisterPage, query: SalesReportQuery, actor: ActivePlatformActor) {
  const { workspace, params, year, month, directions, directionControl, searchQuery, saleSlice, canImport } = page;
  const filterHref = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params);
    next.delete("offset");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/v3/main?${next.toString()}`;
  };
  const selectedManager = query.manager || null;
  const selectedManagerName = workspace && workspace.managerKey !== null
    ? workspace.managerOptions.find((option) => option.key === workspace.managerKey)?.name ?? salesTidy(selectedManager ?? "") : selectedManager ? salesTidy(selectedManager) : null;
  const directionGroups = groupSalesLabels(directions ?? []);
  const selectedDirection = directionControl.value || null;
  const directionGroup = salesLabelGroupOf(directionGroups, selectedDirection);
  return {
    filterHref,
    periodHref: (nextYear: number, nextMonth: number | undefined) => filterHref({ year: String(nextYear), month: nextMonth ? String(nextMonth) : "all" }),
    steps: salesPeriodSteps(year, month),
    selectedManager,
    selectedManagerName,
    directionGroups,
    selectedDirection,
    variantNote: Boolean(directionGroup && directionGroup.variants.length > 1),
    activeCount: [query.manager, query.direction, query.review, query.archived === "true" ? "1" : "", saleSlice].filter(Boolean).length,
    hidden: Object.fromEntries([...params.entries()].filter(([key]) => key !== "q" && key !== "offset")),
    managersHref: canImport ? salesManagersHref(query) : null,
    // «Перенос данных» живёт в «Настройки → Платформа»; держателю права без доступа к настройкам остаётся ссылка здесь.
    importLinkHere: canImport && !staffCanAccessRoute(actor, "/v3/settings"),
    searchValue: searchQuery ?? (typeof query.q === "string" ? query.q : ""),
  };
}
