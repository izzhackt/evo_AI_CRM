// Правая часть верхней полосы телефона (веб `.pt-topbar-actions`): колокольчик «Что нового» у клиента с сопровождением (у
// approved ленты нет), затем кнопка темы у всех (порядок веба: колокольчик, потом тема, Shell.tsx). Отдельным файлом, чтобы
// следующие кнопки полосы вставлялись сюда, а не в разметку самой полосы. Без провайдера кабинета (тест, экран вне оболочки)
// полоса не падает: колокольчика нет, кнопка темы остаётся.
import { useOptionalPortalApi } from "@/api/PortalApi";
import { NotificationBell } from "@/shell/NotificationBell";
import { ThemeToggle } from "@/theme/ThemeToggle";

export function TopBarActions() {
  const tier = useOptionalPortalApi()?.tier;
  return (
    <>
      {tier === "assisted" ? <NotificationBell /> : null}
      <ThemeToggle />
    </>
  );
}
