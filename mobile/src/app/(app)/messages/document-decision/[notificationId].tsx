import { useLocalSearchParams } from "expo-router";

import { DocumentDecisionScreen } from "@/features/inbox/DocumentDecisionScreen";

// Веб: /portal/document-notifications/[notificationId].
export default function MessagesDocumentDecisionScreen() {
  const { notificationId } = useLocalSearchParams<{ notificationId: string | string[] }>();
  return <DocumentDecisionScreen notificationId={Array.isArray(notificationId) ? (notificationId[0] ?? "") : (notificationId ?? "")} />;
}
