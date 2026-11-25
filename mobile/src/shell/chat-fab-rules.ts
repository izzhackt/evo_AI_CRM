// Плавающая кнопка «Написать EVO» (веб Shell.tsx `chat-fab`, 10.11.2026): чистые правила показа и размеры.
// Чат есть только у клиента с сопровождением; на «Входящих» и в самой беседе кнопка лишняя.
import type { AccessTier } from "@/session/access";
import { hasTabBar } from "@/shell/sections";

export const CHAT_FAB_SIZE = 52;
/** Запас между кнопкой и панелью вкладок (и краем экрана, если панели нет). */
export const CHAT_FAB_GAP = 12;
/** Обычная высота панели вкладок без внешнего отступа: вкладка 52 + поля 4 + 4 + рамка 1 + 1 (измеренная может быть больше). */
export const TAB_BAR_BODY = 62;

/** Экран разговора с Эви (как беседа с командой): поле ввода и клавиатура получают весь низ экрана. */
export const EVI_ROUTE = "/professions/evi";

/** Экраны-беседы: плавающая панель вкладок и кнопка «Написать EVO» на них убраны. */
export function isConversationPath(pathname: string): boolean {
  return pathname === "/messages/chat" || pathname === EVI_ROUTE;
}

export function chatFabVisible(tier: AccessTier, pathname: string): boolean {
  if (tier !== "assisted") return false;
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return first !== "messages" && pathname !== EVI_ROUTE;
}

/**
 * Расстояние от низа экрана до низа кнопки: над панелью вкладок, а без панели (approved) просто над безопасной зоной.
 * `tabBarHeight` - высота панели, которую она измерила сама (`tab-bar-metrics.ts`): кнопка стоит над настоящим верхом панели, где
 * бы он ни оказался (крупный шрифт, другая раскладка), и не ложится на неё и на кружок «Входящих». Меньше обычной высоты
 * (`TAB_BAR_BODY`) она не бывает: пока панель не измерена (0, первый кадр), берётся обычная.
 */
export function chatFabBottom(tier: AccessTier, safeBottom: number, tabBarHeight: number = TAB_BAR_BODY): number {
  const edge = Math.max(safeBottom, 12);
  if (!hasTabBar(tier)) return edge + CHAT_FAB_GAP;
  const body = Number.isFinite(tabBarHeight) ? Math.max(tabBarHeight, TAB_BAR_BODY) : TAB_BAR_BODY;
  return edge + body + CHAT_FAB_GAP;
}
