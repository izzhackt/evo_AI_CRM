// Плавающая кнопка «Написать EVO» (веб Shell.tsx `chat-fab`, 10.11.2026): чистые правила показа и размеры.
// Чат есть только у клиента с сопровождением; на «Входящих» и в самой беседе кнопка лишняя.
import type { AccessTier } from "@/session/access";
import { hasTabBar } from "@/shell/sections";

export const CHAT_FAB_SIZE = 52;
/** Запас между кнопкой и панелью вкладок (и краем экрана, если панели нет). */
export const CHAT_FAB_GAP = 12;
/** Высота панели вкладок без внешнего отступа: вкладка 52 + поля 4 + 4 + рамка 1 + 1. */
export const TAB_BAR_BODY = 62;

export function chatFabVisible(tier: AccessTier, pathname: string): boolean {
  if (tier !== "assisted") return false;
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return first !== "messages";
}

/** Расстояние от низа экрана до низа кнопки: над панелью вкладок, а без панели (approved) просто над безопасной зоной. */
export function chatFabBottom(tier: AccessTier, safeBottom: number): number {
  const edge = Math.max(safeBottom, 12);
  return hasTabBar(tier) ? edge + TAB_BAR_BODY + CHAT_FAB_GAP : edge + CHAT_FAB_GAP;
}
