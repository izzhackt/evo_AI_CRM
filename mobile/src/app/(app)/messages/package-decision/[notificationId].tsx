import { useLocalSearchParams } from "expo-router";

import { PackageDecisionScreen } from "@/features/inbox/PackageDecisionScreen";

// Веб: /portal/package-notifications/[notificationId].
export default function MessagesPackageDecisionScreen() {
  const { notificationId } = useLocalSearchParams<{ notificationId: string | string[] }>();
  return <PackageDecisionScreen notificationId={Array.isArray(notificationId) ? (notificationId[0] ?? "") : (notificationId ?? "")} />;
}
