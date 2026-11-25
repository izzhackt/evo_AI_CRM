// Карточка «Не удалось обновить уведомления» + «Повторить» (веб: `.pt-notification-error` в PortalNotificationUpdates): тихая
// карточка под верхней полосой справа, показывается, пока последний опрос не удался. Кнопка опрашивает сразу.
// Пока скачано обновление приложения (карточка «Вышла новая версия», features/app/UpdatePrompt), эту карточку не показываем: веб в
// такой момент останавливает опросы и прячет её (`failed && !stale`), а обе карточки в верхнем правом углу легли бы друг на друга.
// Состояние обновлений читается так же осторожно, как у UpdatePrompt: сбой чтения прячет карточку, а не роняет оболочку.
import * as Updates from "expo-updates";
import { Component, useEffect, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalPollFailure } from "@/api/PortalPoll";
import { useLang } from "@/i18n/LangProvider";
import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Сбой чтения состояния обновлений не должен стоить студенту приложения: при любой ошибке отрисовки карточки просто нет. */
class NoticeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PollFailureCard() {
  const { failed, retry } = usePortalPollFailure();
  const { shell } = useLang();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // При выключенных обновлениях (разработка, Expo Go) хук возвращает пустое состояние.
  const { isUpdatePending } = Updates.useUpdates();
  const visible = failed && !(Updates.isEnabled && isUpdatePending);
  // Веб: `role="alert"` читается сам. В React Native iPhone `accessibilityRole="alert"` ничего не говорит, поэтому карточку, когда она
  // появилась, озвучивает `announce` (повторные сбои подряд карточку не пересоздают и не повторяют сообщение).
  useEffect(() => {
    if (visible) announce(shell.notificationsFailed);
  }, [visible, shell.notificationsFailed]);
  if (!visible) return null;
  return (
    <View pointerEvents="box-none" testID="poll-failure-anchor" style={{ position: "absolute", top: insets.top + TOP_BAR_HEIGHT + 8, right: 16 }}>
      <View
        accessibilityRole="alert"
        testID="poll-failure"
        style={{ width: Math.min(320, width - 32), padding: 12, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
      >
        <Text variant="caption">{shell.notificationsFailed}</Text>
        <LinkButton label={shell.notificationsRetry} onPress={retry} testID="poll-failure-retry" />
      </View>
    </View>
  );
}

export function PollFailureNotice() {
  return (
    <NoticeBoundary>
      <PollFailureCard />
    </NoticeBoundary>
  );
}
