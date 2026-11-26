import { useLocalSearchParams } from "expo-router";

import { ReplyScreen } from "@/features/inbox/ReplyScreen";

// Веб: /portal/notifications/[notificationId].
export default function MessagesReplyScreen() {
  const { notificationId } = useLocalSearchParams<{ notificationId: string | string[] }>();
  return <ReplyScreen notificationId={Array.isArray(notificationId) ? (notificationId[0] ?? "") : (notificationId ?? "")} />;
}
