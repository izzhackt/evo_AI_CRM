// «Входящие»: список из двух бесед, как в вебе (InboxList): «Что нового» и «Команда EVO».
import { Bell } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useChatLatest } from "@/api/inbox-queries";
import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useNotifications, useRefetchOnFocus } from "@/api/queries";
import { unreadNotifications } from "@/domain/inbox-model";
import { portalNotificationText } from "@/domain/presentation";
import { dayKey, timeLabel } from "@/features/inbox/format";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function Avatar({ team }: { team: boolean }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: team ? tokens.accent : tokens.accentSoft, alignItems: "center", justifyContent: "center" }}
    >
      {team ? (
        <Text variant="caption" tone="onAccent" bold>
          EVO
        </Text>
      ) : (
        <Bell size={20} strokeWidth={1.75} color={tokens.accent} />
      )}
    </View>
  );
}

function Row({ team, title, preview, time, badge, onPress, testID, label }: { team: boolean; title: string; preview: string; time?: string | null; badge?: number; onPress: () => void; testID: string; label: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={{ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <Avatar team={team} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" bold numberOfLines={1}>
          {title}
        </Text>
        <Text variant="secondary" tone="text2" numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4, minWidth: MIN_TARGET - 12 }}>
        {time ? (
          <Text variant="caption" tone="text2">
            {time}
          </Text>
        ) : null}
        {badge ? (
          <View testID={`${testID}-badge`} style={{ minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, borderRadius: tokens.radiusChip, backgroundColor: tokens.accent, alignItems: "center" }}>
            <Text variant="caption" tone="onAccent" bold>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function InboxScreen() {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const messages = t("messages");
  const admission = t("admission");
  const notifications = useNotifications();
  const chat = useChatLatest();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey], type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const unread = unreadNotifications(notifications.data);
  const latestUpdate = notifications.data?.[0] ?? null;
  const latestMessage = chat.data?.messages[0] ?? null;
  const updatesPreview = latestUpdate ? portalNotificationText(latestUpdate, admission).title : messages.updatesSubline;
  const chatPreview = latestMessage ? latestMessage.body || latestMessage.attachmentLabel || messages.chatSubline : messages.chatSubline;
  const chatTime = latestMessage ? (dayKey(latestMessage.createdAt) === dayKey(new Date().toISOString()) ? timeLabel(latestMessage.createdAt, lang) : null) : null;
  const failed = notifications.status === "error" && notifications.data === undefined ? notifications.error : chat.status === "error" && chat.data === undefined ? chat.error : null;

  return (
    <Screen topInset={false} tabBar chatFab={false} onRefresh={() => void refresh()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="inbox-screen">
        <Text variant="display" accessibilityRole="header" maxFontSizeMultiplier={1.2} testID="title-messages">
          {messages.title}
        </Text>
        {failed ? <InlineAlert message={m(loadErrorKey(failed))} retryLabel={m("gate.retry")} onRetry={() => void refresh()} testID="inbox-error" /> : null}
        <Card>
          <Row
            team={false}
            title={messages.updatesTitle}
            preview={updatesPreview}
            badge={unread.length}
            onPress={() => go("/messages/updates")}
            testID="inbox-updates"
            label={`${messages.updatesTitle}. ${updatesPreview}${unread.length > 0 ? `. ${format(messages.unreadCount, { count: String(unread.length) })}` : ""}`}
          />
          <View style={{ height: 1, backgroundColor: tokens.line }} />
          <Row team title={messages.chatTitle} preview={chatPreview} time={chatTime} onPress={() => go("/messages/chat")} testID="inbox-chat" label={`${messages.chatTitle}. ${chatPreview}`} />
        </Card>
      </View>
    </Screen>
  );
}
