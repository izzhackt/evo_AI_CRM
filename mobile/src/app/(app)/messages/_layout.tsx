import { Stack } from "expo-router";

import { useRestoreInboxRoot } from "@/shell/useRestoreInboxRoot";
import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

// Внутри вкладки «Входящие» свой стек: список, чат, лента. Системная «назад» на Android
// возвращает из чата в список, а не на другую вкладку.
export const unstable_settings = { anchor: "index" };

export default function MessagesLayout() {
  const statusBarStyle = useStatusBarStyle();
  // Вход снаружи (колокольчик, «Главная», «Написать EVO») оставляет в стеке один экран без списка: при уходе с вкладки стек
  // возвращается к списку (`shell/inbox-stack.ts`).
  useRestoreInboxRoot();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}
