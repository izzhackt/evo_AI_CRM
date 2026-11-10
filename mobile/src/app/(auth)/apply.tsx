import { useLocalSearchParams } from "expo-router";

import { ApplyScreen } from "@/features/registration/ApplyScreen";
import { inviteFromParam } from "@/features/registration/invite-link";

/**
 * /apply?invite=<токен>: сюда ведут universal link / App Link https://app.evoadmissions.com/apply
 * и схема evoadmissions://apply. Без токена экран просит вставить ссылку из письма или WhatsApp.
 */
export default function ApplyRoute() {
  const { invite } = useLocalSearchParams<{ invite?: string | string[] }>();
  return <ApplyScreen inviteParam={inviteFromParam(invite)} />;
}
