// Плавающая кнопка «Написать EVO» (веб Shell.tsx `chat-fab`, 10.11.2026): чистые правила показа и размеры.
// Чат есть только у клиента с сопровождением; на «Входящих» и в самой беседе кнопка лишняя.
import type { AccessTier } from "@/session/access";
import { hasTabBar } from "@/shell/sections";

export const CHAT_FAB_SIZE = 52;
/** Запас между кнопкой и панелью вкладок (и краем экрана, если панели нет). */
export const CHAT_FAB_GAP = 12;
/** Высота панели вкладок без внешнего отступа: вкладка 52 + поля 4 + 4 + рамка 1 + 1. */
export const TAB_BAR_BODY = 62;

/** Экран разговора с Эви (как беседа с командой): поле ввода и клавиатура получают весь низ экрана. */
export const EVI_ROUTE = "/professions/evi";

/** Экраны-беседы: плавающая панель вкладок и кнопка «Написать EVO» на них убраны. */
export function isConversationPath(pathname: string): boolean {
  return pathname === "/messages/chat" || pathname === EVI_ROUTE;
}

/**
 * Список «Входящих», лента «Что нового» и сама беседа: кнопка «Написать EVO» на них лишняя (веб Shell.tsx: скрыта на
 * /portal/messages). Экраны решения (ответ куратора, решение по документу и по комплекту) в вебе лежат вне /portal/messages
 * (/portal/notifications/..., /portal/document-notifications/..., /portal/package-notifications/...), и кнопка на них есть:
 * прочитав ответ куратора, студент пишет команде оттуда. В приложении они живут в стеке «Входящих», поэтому правило по пути.
 */
const INBOX_PATHS: readonly string[] = ["/messages", "/messages/updates", "/messages/chat"];

export function chatFabVisible(tier: AccessTier, pathname: string): boolean {
  if (tier !== "assisted") return false;
  return !INBOX_PATHS.includes(pathname) && pathname !== EVI_ROUTE;
}

/** Расстояние от низа экрана до низа кнопки: над панелью вкладок, а без панели (approved) просто над безопасной зоной. */
export function chatFabBottom(tier: AccessTier, safeBottom: number): number {
  const edge = Math.max(safeBottom, 12);
  return hasTabBar(tier) ? edge + TAB_BAR_BODY + CHAT_FAB_GAP : edge + CHAT_FAB_GAP;
}
