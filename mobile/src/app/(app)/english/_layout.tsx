import { Stack } from "expo-router";

// Внутри раздела свой стек: корень, уроки, тесты. Системная «назад» на Android возвращает
// на предыдущий экран раздела, а не на другую вкладку.
export const unstable_settings = { anchor: "index" };

export default function SectionLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}
