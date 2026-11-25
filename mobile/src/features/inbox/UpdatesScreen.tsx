// «Что нового»: лента уведомлений в одном месте под одним названием (#1358). Строка ведёт на свой экран (ответ куратора,
// решение по документу или по комплекту, документы, оплата, чат, «Главная») с подписью ссылки, как у веба (NotificationsView).
// Прочитанным отмечает и нажатие на строку (приложение), и кнопка «Отметить прочитанным» у каждого непрочитанного (веб);
// переход от записи не зависит: экран всё равно открывается (как в вебе). Сбой записи стоит плашкой с «Повторить» ПОД самой
// строкой (не вверху ленты: лента могла уйти вверх, а студент - на другой экран), хранится по уведомлению и читается вслух.
// Сбой «Отметить все» - плашка вверху ленты, как в вебе (markAllReadError); она стоит, пока непрочитано хотя бы одно из тех уведомлений,
// что остались неотмеченными при этой попытке (отметили поодиночке или прочитали на сайте - уходит, новое уведомление её не воскрешает).
import { useRouter } from "expo-router";
import { ArrowLeft, Bell } from "lucide-react-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { usePortalApi } from "@/api/PortalApi";
import { useNotifications, useRefetchOnFocus } from "@/api/queries";
import { unreadNotifications } from "@/domain/inbox-model";
import type { StudentPortalNotification } from "@/domain/portal-source";
import { formatPortalDeadline, formatPortalTimestamp, notificationRoute, notificationTargetLabel, portalNotificationText } from "@/domain/presentation";
import { useNotificationRead } from "@/features/inbox/useNotificationRead";
import { useScreenVisible } from "@/features/inbox/visibility";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
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
  const visible = useScreenVisible();
  // iPhone сам не читает accessibilityRole="alert": сбой записи озвучивается, пока лента на виду.
  const read = useNotificationRead({
    onFailure: (scope) => {
      if (visible) announce(scope === "all" ? admission.markAllReadError : admission.markReadError);
    },
  });
  const [refreshing, setRefreshing] = useState(false);
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
  const allFailed = unread.some((item) => read.allFailedIds.has(item.notificationId));
  const back = () => (router.canGoBack() ? router.back() : router.navigate("/messages"));

  const open = (item: StudentPortalNotification) => {
    // Запись «прочитано» идёт сама; переход её не ждёт, а при сбое плашка остаётся на ленте (она в стеке под экраном).
    if (item.readAt === null) void read.markRead([item], "one");
    go(notificationRoute(item));
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
            <InlineAlert message={messages.updatesUnavailable} retryLabel={m("gate.retry")} onRetry={() => void notifications.refetch()} testID="updates-error" />
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
              {allFailed ? (
                <InlineAlert message={admission.markAllReadError} retryLabel={m("gate.retry")} onRetry={() => void read.markRead(unread, "all")} testID="updates-read-error" />
              ) : null}
              {unread.length > 0 ? (
                <Button variant="ghost" label={read.busy ? admission.marking : admission.markAllRead} disabled={read.busy} onPress={() => void read.markRead(unread, "all")} testID="updates-mark-all" />
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const isUnread = item.readAt === null;
            const text = portalNotificationText(item, admission);
            const created = formatPortalTimestamp(item.createdAt);
            const due = formatPortalDeadline(item.dueAt);
            const targetLabel = notificationTargetLabel(item, admission);
            return (
              <View
                testID={`update-card-${item.notificationId}`}
                style={{ borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: isUnread ? tokens.accent : tokens.line, backgroundColor: tokens.surface }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isUnread ? `${admission.statusNew}: ` : ""}${text.title}${text.detail ? `. ${text.detail}` : ""}${created ? `. ${created}` : ""}${due ? `. ${admission.dueTerm} ${due}` : ""}`}
                  accessibilityHint={targetLabel}
                  onPress={() => open(item)}
                  testID={`update-${item.notificationId}`}
                  style={{ minHeight: MIN_TARGET, padding: 12, gap: 4 }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isUnread ? tokens.accent : "transparent" }} />
                    <Text variant="body" bold={isUnread} style={{ flex: 1 }}>
                      {text.title}
                    </Text>
                  </View>
                  {text.detail ? (
                    <Text variant="secondary" tone="text2">
                      {text.detail}
                    </Text>
                  ) : null}
                  {created || due ? (
                    <Text variant="caption" tone="text2">
                      {created ?? admission.dateUnavailable}
                      {due ? ` · ${admission.dueTerm} ${due}` : ""}
                    </Text>
                  ) : null}
                  <Text variant="secondary" tone="accent" bold>
                    {targetLabel}
                  </Text>
                </Pressable>
                {isUnread && read.failedIds.has(item.notificationId) ? (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                    <InlineAlert message={admission.markReadError} retryLabel={m("gate.retry")} onRetry={() => void read.markRead([item], "one")} testID={`update-read-error-${item.notificationId}`} />
                  </View>
                ) : null}
                {isUnread ? (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 12, alignItems: "flex-start" }}>
                    <Button
                      variant="ghost"
                      label={read.isPending(item.notificationId) ? admission.marking : admission.markRead}
                      accessibilityLabel={`${read.isPending(item.notificationId) ? admission.marking : admission.markRead}: ${text.title}`}
                      disabled={read.isPending(item.notificationId)}
                      onPress={() => void read.markRead([item], "one")}
                      testID={`update-read-${item.notificationId}`}
                    />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
