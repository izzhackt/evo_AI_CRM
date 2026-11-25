// Выбор темы и языка студента читается с устройства асинхронно: провайдеры (`ThemeProvider`, `LangProvider`) сообщают об этом
// полем `hydrated`. Экраны, которые могут появиться раньше остальных (сбой экрана, «приложение не настроено», первый кадр
// после заставки), не рисуются, пока выбор не прочитан: иначе студент с тёмной темой или кыргызским языком видел бы на один
// кадр светлый русский экран, а читалка экрана дважды озвучила бы предупреждение (сначала по-русски). Рецензия #1568, п. 4.
import type { ReactNode } from "react";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";

/** Выбор темы и языка с устройства применён (или его там нет, или чтение сорвалось или не уложилось в предел ожидания). */
export function usePreferencesReady(): boolean {
  const theme = useTheme();
  const lang = useLang();
  return theme.hydrated && lang.hydrated;
}

/** Рисует детей, только когда выбор прочитан; до этого ничего (на месте экрана остаются заставка или фон окна). */
export function PreferencesGate({ children }: { children: ReactNode }) {
  return usePreferencesReady() ? <>{children}</> : null;
}
