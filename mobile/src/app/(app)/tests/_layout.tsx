import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

// Внутри раздела свой стек: корень, уроки, тесты. Системная «назад» на Android возвращает
// на предыдущий экран раздела, а не на другую вкладку.
export const unstable_settings = { anchor: "index" };

export default function SectionLayout() {
  const statusBarStyle = useStatusBarStyle();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}
