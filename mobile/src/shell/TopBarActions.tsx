// Правая часть верхней полосы телефона (веб `.pt-topbar-actions`): колокольчик «Что нового» у клиента с сопровождением (у
// approved ленты нет). Отдельным файлом, чтобы следующие кнопки полосы (тема) вставлялись сюда, а не в разметку самой полосы.
import { usePortalApi } from "@/api/PortalApi";
import { NotificationBell } from "@/shell/NotificationBell";

export function TopBarActions() {
  const { tier } = usePortalApi();
  return tier === "assisted" ? <NotificationBell /> : null;
}
