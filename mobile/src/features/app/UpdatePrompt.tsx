// Предложение обновиться (G4 аудита паритета 25.11.2026; веб: PortalStaleDeploymentNotice.tsx, «Вышла новая версия»).
// Приложение получает исправления JS как EAS Update на ту же сборку: `checkAutomatically: ON_LOAD` скачивает обновление при
// запуске, а применяется оно только при следующем холодном старте. Студент, который не закрывает приложение днями, так и
// остаётся на старой версии. Когда обновление скачано (`isUpdatePending`), сверху появляется тихая карточка «Вышла новая версия -
// обновите приложение» с «Обновить» (перезапуск на новую версию) и «Позже» (до следующего запуска).
// Осторожно по умолчанию: путь OTA ещё ни разу не проходился до конца. Карточка молчит, пока обновлений нет и пока обновления
// выключены (разработка, Expo Go: `Updates.isEnabled === false`); любой сбой чтения состояния или перезапуска не доходит до
// экрана и не роняет приложение.
import * as Updates from "expo-updates";
import { Component, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

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
  // Хук читает состояние нативного модуля; при выключенных обновлениях он возвращает пустое состояние.
  const { isUpdatePending } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!Updates.isEnabled || !isUpdatePending || dismissed) return null;

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Перезапуск не вышел: обновление применится при следующем запуске, карточка остаётся с рабочей кнопкой.
      setBusy(false);
    }
  };

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: insets.top + 8, paddingHorizontal: 16 }} testID="update-prompt-host">
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
          {m("app.update.text")}
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
