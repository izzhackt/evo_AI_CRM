import { Redirect, Stack } from "expo-router";

import { useCscaAccess } from "@/features/learning/csca/useCscaAccess";
import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

// Внутри раздела свой стек: корень, уроки, тесты. Системная «назад» на Android возвращает
// на предыдущий экран раздела, а не на другую вкладку.
export const unstable_settings = { anchor: "index" };

// Решение владельца 21.11.2026: CSCA только у студента с выбором «Китай». Стража стоит в самом
// разделе, чтобы ссылка на любой его экран у остальных вела на «Главную».
export default function SectionLayout() {
  const statusBarStyle = useStatusBarStyle();
  const { pending, available } = useCscaAccess();
  if (pending) return null;
  if (!available) return <Redirect href="/home" />;
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}
