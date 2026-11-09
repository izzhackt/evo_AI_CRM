// «Что нового»: лента уведомлений в одном месте под одним названием (#1358).
// Нажатие отмечает прочитанным (детерминированный id) и ведёт на целевой экран.
import { useRouter } from "expo-router";
import { ArrowLeft, Bell } from "lucide-react-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useNotifications, useRefetchOnFocus } from "@/api/queries";
import { unreadNotifications } from "@/domain/inbox-model";
import type { StudentPortalNotification } from "@/domain/portal-source";
import { formatPortalDeadline, formatPortalTimestamp, notificationRoute, notificationTargetLabel, portalNotificationText } from "@/domain/presentation";
import { useNotificationRead } from "@/features/inbox/useNotificationRead";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { EmptyBlock, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function UpdatesScreen() {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const router = useRouter();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useRefetchOnFocus();
  const messages = t("messages");
  const admission = t("admission");
  const notifications = useNotifications();
  const read = useNotificationRead();
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: ["portal", userKey, "notifications"] });
    } finally {
      setRefreshing(false);
    }
  }, [client, userKey]);

  const items = notifications.data ?? [];
  const unread = unreadNotifications(items);
  const back = () => (router.canGoBack() ? router.back() : router.navigate("/messages"));

  const open = async (item: StudentPortalNotification) => {
    const route = notificationRoute(item);
    if (item.readAt === null) {
      const ok = await read.markRead([item]);
      if (!ok) return; // сбой записи: остаёмся здесь, плашка ошибки ниже
    }
    if (route === "/messages/updates") setExpanded((current) => (current === item.notificationId ? null : item.notificationId));
    else go(route);
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID="updates-screen">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={messages.backToList} onPress={back} testID="updates-back" hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={22} strokeWidth={1.75} color={tokens.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="body" bold accessibilityRole="header" testID="title-updates">
            {messages.updatesTitle}
          </Text>
          <Text variant="caption" tone="text2" numberOfLines={1}>
            {messages.updatesSubline}
          </Text>
        </View>
      </View>
      {notifications.data === undefined ? (
        <View style={{ padding: 16 }}>
          {notifications.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(notifications.error))} retryLabel={m("gate.retry")} onRetry={() => void notifications.refetch()} testID="updates-error" />
          ) : (
            <Text variant="secondary" tone="text2">
              {m("state.loading")}
            </Text>
          )}
        </View>
      ) : items.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyBlock icon={Bell} title={admission.notificationsEmptyTitle} body={admission.notificationsEmptyBody} />
        </View>
      ) : (
        <FlatList
          testID="updates-list"
          data={items}
          keyExtractor={(n) => n.notificationId}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CLEARANCE, gap: 8 }}
          ListHeaderComponent={
            <View style={{ gap: 8, marginBottom: 8 }}>
              <Text variant="caption" tone="text2">
                {admission.notificationsTimeNote}
              </Text>
              {read.errorKey ? <InlineAlert message={m(read.errorKey)} testID="updates-read-error" /> : null}
              {unread.length > 0 ? (
                <Button variant="ghost" label={admission.markAllRead} busy={read.busy} onPress={() => void read.markRead(unread)} testID="updates-mark-all" />
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const isUnread = item.readAt === null;
            const text = portalNotificationText(item, admission);
            const created = formatPortalTimestamp(item.createdAt);
            const due = formatPortalDeadline(item.dueAt);
            const targetLabel = notificationTargetLabel(item, admission);
            const showDetail = expanded === item.notificationId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? `${admission.statusNew}: ` : ""}${text.title}${created ? `. ${created}` : ""}`}
                accessibilityHint={isUnread ? m("inbox.markReadHint") : undefined}
                onPress={() => void open(item)}
                testID={`update-${item.notificationId}`}
                style={{ minHeight: MIN_TARGET, padding: 12, gap: 4, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: isUnread ? tokens.accent : tokens.line, backgroundColor: tokens.surface }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isUnread ? tokens.accent : "transparent" }} />
                  <Text variant="body" bold={isUnread} style={{ flex: 1 }}>
                    {text.title}
                  </Text>
                </View>
                {text.detail ? (
                  <Text variant="secondary" tone="text2" numberOfLines={showDetail ? undefined : 3}>
                    {text.detail}
                  </Text>
                ) : null}
                {created || due ? (
                  <Text variant="caption" tone="text2">
                    {created ?? admission.dateUnavailable}
                    {due ? ` · ${admission.dueTerm} ${due}` : ""}
                  </Text>
                ) : null}
                {targetLabel ? (
                  <Text variant="secondary" tone="accent" bold>
                    {targetLabel}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
