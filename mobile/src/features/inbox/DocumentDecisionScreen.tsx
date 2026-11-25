// Решение по документу программы (веб: /portal/document-notifications/[notificationId]): что решили по отправленному
// файлу, замечание сотрудника, файл (имя, версия) и ссылка на программу. Строка уведомления несёт только название и причину,
// слово решения есть лишь здесь. Скачивание файла и якорь требования строит экран программы (срез «Требования программы»):
// отсюда ведёт ссылка на него.
import { router } from "expo-router";
import { View } from "react-native";

import { isNotificationId } from "@/api/inbox-detail-api";
import { useDocumentNotification } from "@/api/inbox-queries";
import { DetailFrame } from "@/features/inbox/DetailFrame";
import { DetailNotFound, isNotFoundError, SubmissionEvidence } from "@/features/inbox/DecisionParts";
import { go } from "@/features/portal/navigation";
import { preparationHref } from "@/features/preparations/routes";
import { useLang } from "@/i18n/LangProvider";
import { InlineAlert, LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function DocumentDecisionScreen({ notificationId }: { notificationId: string }) {
  const { m, t } = useLang();
  const admission = t("admission");
  const docs = t("programDocuments");
  const query = useDocumentNotification(notificationId);
  const notification = query.data;
  const retry = () => void query.refetch();

  return (
    <DetailFrame title={admission.targetProgramDocument} backLabel={admission.replyAllNotifications} testID="document-decision-screen">
      <View style={{ alignItems: "flex-start" }}>
        <LinkButton label={admission.replyAllNotifications} onPress={() => go("/messages/updates")} testID="decision-all" />
      </View>
      {notification ? (
        <View style={{ gap: 16 }}>
          <Text variant="secondary" tone="text2" testID="decision-snapshot">
            {docs.notificationSnapshot}
          </Text>
          <SubmissionEvidence submission={notification.submission} />
          <View style={{ alignItems: "flex-start" }}>
            <LinkButton label={docs.openProgram} onPress={() => router.navigate(preparationHref(notification.applicationId))} testID="decision-open-program" />
          </View>
        </View>
      ) : !isNotificationId(notificationId) || isNotFoundError(query.error) ? (
        <DetailNotFound />
      ) : query.status === "error" ? (
        <InlineAlert message={docs.readUnavailable} retryLabel={docs.refresh} onRetry={retry} testID="document-decision-error" />
      ) : (
        <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
          {m("state.loading")}
        </Text>
      )}
    </DetailFrame>
  );
}
