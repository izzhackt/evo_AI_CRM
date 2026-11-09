import { useOptionalPortalApi } from "@/api/PortalApi";
import { hasTabBar } from "@/shell/sections";

/** Высота плавающей панели вместе с отступом; контент получает такой нижний запас. */
export const TAB_BAR_CLEARANCE = 96;

/** Нижний запас под панель: 0, когда у уровня панели нет (то же правило `hasTabBar`, что и у самой панели). */
export function useTabBarClearance(): number {
  const tier = useOptionalPortalApi()?.tier;
  return tier !== undefined && !hasTabBar(tier) ? 0 : TAB_BAR_CLEARANCE;
}
