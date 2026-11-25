// Колокольчик «Что нового» в верхней полосе телефона (веб: PortalNotificationUpdates, `.pt-bell`): ведёт в ленту «Что нового»,
// число непрочитанного кружком (не больше 99+). Имя для читалки как у веба: «Новых уведомлений: N», «Новых уведомлений нет»
// или просто «Что нового», пока число неизвестно (первый опрос не пришёл или опрос не удался). Значок вкладки «Входящие»
// остаётся тоже (решение владельца D9: на телефоне веба значка нет, в приложении он помогает).
import { Bell } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Platform, Pressable, View } from "react-native";

import { usePortalUnread } from "@/api/PortalPoll";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Text } from "@/ui/Text";

export const BELL_ROUTE = "/messages/updates";

/** Подпись колокольчика по числу непрочитанного (веб: label в PortalNotificationUpdates). */
function useUnreadLabel(): string {
  const { shell, format } = useLang();
  const unread = usePortalUnread();
  if (unread === null) return shell.notifications;
  return unread > 0 ? format(shell.notificationsUnread, { count: String(unread) }) : shell.notificationsNone;
}

export function NotificationBell() {
  const { tokens } = useTheme();
  const unread = usePortalUnread();
  const label = useUnreadLabel();
  const previous = useRef<number | null>(null);

  // Веб: невидимый `role="status"` с той же подписью. На Android это живая область у самой кнопки, на iPhone - сообщение
  // читалке, когда известное число сменилось другим известным (первое число и возврат после сбоя не озвучиваются).
  useEffect(() => {
    const before = previous.current;
    previous.current = unread;
    if (Platform.OS === "ios" && before !== null && unread !== null && before !== unread) announce(label, { queue: true });
  }, [unread, label]);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      onPress={() => go(BELL_ROUTE)}
      hitSlop={4}
      testID="notification-bell"
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <Bell size={20} strokeWidth={1.75} color={tokens.text2} />
      {unread !== null && unread > 0 ? (
        <View
          testID="notification-bell-count"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: "absolute", top: 2, right: 0, minWidth: 18, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 999, backgroundColor: tokens.accent, alignItems: "center" }}
        >
          <Text variant="caption" tone="onAccent" bold style={{ fontSize: 11, lineHeight: 14 }}>
            {unread > 99 ? "99+" : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
