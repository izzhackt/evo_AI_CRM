// Карточка «Не удалось обновить уведомления» + «Повторить» (веб: `.pt-notification-error` в PortalNotificationUpdates): тихая
// карточка под верхней полосой справа, показывается, пока последний опрос не удался. Кнопка опрашивает сразу.
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalPollFailure } from "@/api/PortalPoll";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Высота верхней полосы (TopBar) без отступа безопасной зоны. */
const TOPBAR_HEIGHT = 52;

export function PollFailureNotice() {
  const { failed, retry } = usePortalPollFailure();
  const { shell } = useLang();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (!failed) return null;
  return (
    <View pointerEvents="box-none" testID="poll-failure-anchor" style={{ position: "absolute", top: insets.top + TOPBAR_HEIGHT + 8, right: 16 }}>
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
