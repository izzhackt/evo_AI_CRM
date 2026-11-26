// «Регистрация по приглашению»: ссылка не открыла анкету (веб: RegistrationInviteRequired.tsx, 341). Аккаунт создаётся только
// по личной ссылке менеджера; здесь человек узнаёт, что именно не так со ссылкой (уже использована, срок вышел, не удалось
// проверить, такой нет), и куда идти: войти, если аккаунт уже создан, или вставить другую ссылку.
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export type InviteProblem = "used" | "expired" | "unknown" | "unavailable";

export function InviteRequired({
  status,
  onSignIn,
  onChangeLink,
  onRetry,
}: {
  status: InviteProblem;
  onSignIn: () => void;
  onChangeLink: () => void;
  /** Только у «не удалось проверить»: проверку можно повторить (веб просит обновить страницу). */
  onRetry?: () => void;
}) {
  const { m, t } = useLang();
  const strings = t("apply");
  const text = status === "used" ? strings["invite.used"] : status === "expired" ? strings["invite.expired"] : status === "unavailable" ? strings["invite.unavailable"] : strings["invite.text"];
  return (
    <Card>
      <View style={{ gap: 12 }} testID={`invite-required-${status}`}>
        <Text variant="title" accessibilityRole="header">
          {strings["invite.title"]}
        </Text>
        <Text variant="body" tone="text2" accessibilityRole={status === "unavailable" ? "alert" : undefined} testID="invite-required-text">
          {text}
        </Text>
        {status === "unavailable" && onRetry ? <Button label={m("gate.retry")} onPress={onRetry} testID="invite-required-retry" /> : null}
        <Button label={strings["invite.login"]} variant={status === "unavailable" && onRetry ? "ghost" : "primary"} onPress={onSignIn} testID="invite-required-sign-in" />
        <Button label={m("apply.changeLink")} variant="ghost" onPress={onChangeLink} testID="invite-required-change-link" />
      </View>
    </Card>
  );
}
