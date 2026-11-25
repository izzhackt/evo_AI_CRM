// Ответ куратора (веб: /portal/notifications/[notificationId], «Ответ куратора»): вопрос студента, ответ EVO с временем и,
// пока уведомление не прочитано, кнопка «Отметить прочитанным». Открывается из ленты «Что нового» и с «Главной».
import { useState } from "react";
import { View } from "react-native";

import { isNotificationId } from "@/api/inbox-detail-api";
import { useHelpReply } from "@/api/inbox-queries";
import { loadErrorKey } from "@/api/queries";
import { formatPortalTimestamp } from "@/domain/presentation";
import { DetailFrame } from "@/features/inbox/DetailFrame";
import { useNotificationRead } from "@/features/inbox/useNotificationRead";
import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { InlineAlert, LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function ReplyScreen({ notificationId }: { notificationId: string }) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const admission = t("admission");
  const valid = isNotificationId(notificationId);
  const query = useHelpReply(notificationId);
  const read = useNotificationRead();
  const [marked, setMarked] = useState(false);
  const reply = query.data;
  const unread = reply !== undefined && reply.readAt === null && !marked;

  const markRead = async () => {
    if (await read.markRead([{ notificationId }])) {
      setMarked(true);
      void query.refetch();
    }
  };

  return (
    <DetailFrame title={admission.replyTitle} backLabel={admission.replyAllNotifications} testID="reply-screen">
      <View style={{ alignItems: "flex-start" }}>
        <LinkButton label={admission.replyAllNotifications} onPress={() => go("/messages/updates")} testID="reply-all" />
      </View>
      {reply ? (
        <Card>
          <Text variant="heading" accessibilityRole="header" testID="reply-subject">
            {reply.request.subject}
          </Text>
          <View style={{ gap: 8 }}>
            <Text variant="secondary" bold>
              {admission.replyYourQuestion}
            </Text>
            <Text variant="secondary" selectable testID="reply-question">
              {reply.request.body}
            </Text>
          </View>
          <View style={{ gap: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: tokens.accent }}>
            <Text variant="secondary" bold>
              {admission.replyAnswer}
            </Text>
            <Text variant="secondary" selectable testID="reply-answer">
              {reply.request.answer}
            </Text>
            {reply.request.answeredAt ? (
              <Text variant="caption" tone="text2">
                {formatPortalTimestamp(reply.request.answeredAt)}
              </Text>
            ) : null}
          </View>
          {unread ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              {read.failure ? <InlineAlert message={admission.markReadError} testID="reply-read-error" /> : null}
              <Button variant="ghost" label={read.busy ? admission.marking : admission.markRead} disabled={read.busy} onPress={() => void markRead()} testID="reply-mark-read" />
            </View>
          ) : null}
        </Card>
      ) : !valid ? (
        <InlineAlert message={m("error.load")} testID="reply-error" />
      ) : query.status === "error" ? (
        <InlineAlert message={m(loadErrorKey(query.error))} retryLabel={m("gate.retry")} onRetry={() => void query.refetch()} testID="reply-error" />
      ) : (
        <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
          {m("state.loading")}
        </Text>
      )}
    </DetailFrame>
  );
}
