import { Stack } from "expo-router";

import { useStatusBarStyle } from "@/theme/useStatusBarStyle";

/**
 * «Требования программы»: один экран `[applicationId]` внутри кабинета. Шапку с ☰ и плавающую панель рисует оболочка
 * `(app)/_layout.tsx`, как у `universities/`, `tests/` и `professions/`; раздела в меню у экрана нет (в вебе его тоже нет:
 * сюда ведут «Мои программы», страница вуза, ближайшие даты и уведомления).
 */
export default function PreparationsLayout() {
  const statusBarStyle = useStatusBarStyle();
  return <Stack screenOptions={{ statusBarStyle, headerShown: false, animation: "slide_from_right" }} />;
}
