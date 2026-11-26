// Одна кнопка «солнце/луна» (веб: src/components/ThemeToggle.tsx, решение владельца 02.10): светлая и тёмная одним нажатием, без
// захода в «Профиль». Значок показывает текущую тему, имя постоянное («Тёмная тема»), состояние - переключатель (веб:
// `aria-pressed`). Выбор живёт на устройстве; тема приложения (не системная) ведёт и значки строки состояния, поэтому после
// нажатия они меняются вместе с экранами (`useStatusBarStyle`, корневой макет). Три варианта «Светлая | Тёмная | Как в системе»
// остаются в «Профиле»: если выбрано «Как в системе», кнопка ставит явно противоположную тему к той, что действует сейчас.
import { Moon, Sun } from "lucide-react-native";
import { Pressable } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";

export function ThemeToggle() {
  const { scheme, setChoice, tokens } = useTheme();
  const { shell } = useLang();
  const dark = scheme === "dark";
  const Icon = dark ? Moon : Sun;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={shell["theme.dark"]}
      accessibilityState={{ checked: dark }}
      onPress={() => setChoice(dark ? "light" : "dark")}
      hitSlop={4}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
      testID="theme-toggle"
    >
      <Icon size={22} strokeWidth={1.75} color={tokens.text} />
    </Pressable>
  );
}
