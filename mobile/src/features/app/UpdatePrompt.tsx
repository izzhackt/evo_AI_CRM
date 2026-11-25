// Предложение обновиться (G4 аудита паритета 25.11.2026; веб: PortalStaleDeploymentNotice.tsx, «Вышла новая версия»).
// Приложение получает исправления JS как EAS Update на ту же сборку: `checkAutomatically: ON_LOAD` скачивает обновление при
// запуске, а применяется оно только при следующем холодном старте. Студент, который не закрывает приложение днями, так и
// остаётся на старой версии. Когда обновление скачано (`isUpdatePending`), сверху появляется тихая карточка «Вышла новая версия -
// обновите приложение» с «Обновить» (перезапуск на новую версию) и «Позже» (до следующего запуска).
// Осторожно по умолчанию: путь OTA ещё ни разу не проходился до конца. Карточка молчит, пока обновлений нет и пока обновления
// выключены (разработка, Expo Go: `Updates.isEnabled === false`); любой сбой чтения состояния или перезапуска не доходит до
// экрана и не роняет приложение.
// Рецензия #1568: (а) `useUpdates` сам ничего не проверяет, поэтому при возврате на передний план приложение раз в час спрашивает
// EAS Update и скачивает найденное (`update-check.ts`), карточка появляется, когда оно скачано; (б) если `reloadAsync` вернулся, а
// перезапуска нет, кнопка через 8 секунд снова нажимается; (в) появление карточки озвучивается читалке (iOS живые области
// не слышит); (г) карточка стоит под верхней полосой кабинета, а не поверх неё: ☰, кнопка темы и всё, что добавят справа,
// остаются нажимаемыми.
import * as Updates from "expo-updates";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useForegroundUpdateCheck } from "@/features/app/update-check";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Text } from "@/ui/Text";

/** Высота ряда верхней полосы кабинета (`shell/TopBar.tsx`: `height: 52` под отступом безопасной зоны); тест сверяет число с файлом полосы. */
export const TOP_BAR_HEIGHT = 52;
/** Если перезапуск не случился, кнопка «Обновить» снова нажимается через это время. */
export const RELOAD_RESET_MS = 8_000;

/** Сбой карточки не должен стоить студенту приложения: при любой ошибке отрисовки карточки просто нет. */
class PromptBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function UpdatePromptCard() {
  const { tokens, scheme } = useTheme();
  const { m } = useLang();
  const insets = useSafeAreaInsets();
  const { state } = useSession();
  // Хук читает состояние нативного модуля; при выключенных обновлениях он возвращает пустое состояние.
  const { isUpdatePending } = Updates.useUpdates();
  useForegroundUpdateCheck();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = Updates.isEnabled && isUpdatePending && !dismissed;
  const text = m("app.update.text");

  // iOS не озвучивает живые области: карточка, появившаяся сама, говорится читалке явно.
  useEffect(() => {
    if (visible) announce(text);
  }, [visible, text]);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );
  if (!visible) return null;

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    // `reloadAsync` мог вернуться, а перезапуск не случиться (или не вернуться вовсе): кнопка не остаётся занятой навсегда.
    resetTimer.current = setTimeout(() => setBusy(false), RELOAD_RESET_MS);
    try {
      await Updates.reloadAsync();
    } catch {
      // Перезапуск не вышел: обновление применится при следующем запуске, карточка остаётся с рабочей кнопкой.
      if (resetTimer.current) clearTimeout(resetTimer.current);
      setBusy(false);
    }
  };

  // Верхняя полоса есть у всего кабинета (`header` его вкладок), и только у него: под ней карточка не закрывает ☰, кнопку темы и
  // то, что появится справа; на экранах без полосы (вход, анкета, шлюз) она у верха безопасной зоны.
  const top = insets.top + (state.kind === "active" ? TOP_BAR_HEIGHT : 0) + 8;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top, paddingHorizontal: 16 }} testID="update-prompt-host">
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{
          gap: 4,
          padding: 12,
          borderRadius: tokens.radiusCard,
          borderWidth: 1,
          borderColor: tokens.line,
          backgroundColor: tokens.surface,
          boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
        }}
        testID="update-prompt"
      >
        <Text variant="body" bold>
          {text}
        </Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} onPress={() => void reload()} style={{ minHeight: 44, justifyContent: "center" }} testID="update-prompt-reload">
            <Text variant="secondary" tone="accent" bold>
              {m("app.update.action")}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setDismissed(true)} style={{ minHeight: 44, justifyContent: "center" }} testID="update-prompt-later">
            <Text variant="secondary" tone="text2" bold>
              {m("app.update.later")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function UpdatePrompt() {
  return (
    <PromptBoundary>
      <UpdatePromptCard />
    </PromptBoundary>
  );
}
