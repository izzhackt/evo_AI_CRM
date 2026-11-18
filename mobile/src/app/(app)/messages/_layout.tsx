import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

// Внутри вкладки «Входящие» свой стек: список, чат, лента. Системная «назад» на Android
// возвращает из чата в список, а не на другую вкладку.
export const unstable_settings = { anchor: "index" };

export default function MessagesLayout() {
  const statusBarStyle = useStatusBarStyle();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}
