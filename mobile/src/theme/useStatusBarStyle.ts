import { useTheme } from "@/theme/ThemeProvider";

/**
 * Стиль значков строки состояния по теме приложения (выбор студента, а не системная).
 *
 * Нельзя оставлять у экранов react-native-screens значение по умолчанию «auto»: на iOS оно считается по
 * `UITraitCollection.currentTraitCollection`, то есть по системной теме, и при тёмной теме приложения на светлой
 * системе значки получаются тёмными на тёмном (и наоборот). Явный стиль у каждого стека это исключает.
 */
export function useStatusBarStyle(): "light" | "dark" {
  return useTheme().scheme === "dark" ? "light" : "dark";
}
