import { ActivityIndicator, View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/**
 * Состояния маршрутизатора, при которых кабинет не открывается:
 * resolvingAccess, networkError, accessPending, needsApplication, applicationStatus.
 */
export default function GateScreen() {
  const { tokens } = useTheme();
  const { m, profile } = useLang();
  const { state, retry, refreshAccess, signOut } = useSession();

  if (state.kind === "resolvingAccess") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: tokens.bg }} accessibilityLiveRegion="polite">
        <ActivityIndicator color={tokens.accent} />
        <Text variant="secondary" tone="text2">
          {m("gate.resolving")}
        </Text>
      </View>
    );
  }

  const logout = <Button label={profile.logout} variant="ghost" onPress={() => void signOut()} />;

  if (state.kind === "networkError") {
    return (
      <Screen>
        <Card>
          <Text variant="title" accessibilityRole="header">
            {state.messageKey === "error.offline" ? m("gate.offlineTitle") : m("gate.serverTitle")}
          </Text>
          <Text variant="secondary" tone="text2">
            {m(state.messageKey)}
          </Text>
          <Button label={m("gate.retry")} onPress={() => void retry()} testID="gate-retry" />
          {logout}
        </Card>
      </Screen>
    );
  }

  if (state.kind === "needsApplication") {
    // TODO(M7): мастер анкеты по личной ссылке (submit_student_application_v1, S1). Пока только честная заглушка.
    return (
      <Screen>
        <Card>
          <Text variant="title" accessibilityRole="header">
            {m("gate.applicationTitle")}
          </Text>
          <Text variant="body">{m("gate.applicationSoon")}</Text>
          <Text variant="secondary" tone="text2">
            {m("gate.applicationSoonHint")}
          </Text>
          <Button label={m("gate.refresh")} onPress={() => void refreshAccess()} />
          {logout}
        </Card>
      </Screen>
    );
  }

  if (state.kind === "applicationStatus") {
    // TODO(M7): статус и ответы анкеты, исправление отклонённой (docs/mobile/PLAN.md, M7).
    return (
      <Screen>
        <Card>
          <Text variant="title" accessibilityRole="header">
            {m("gate.statusTitle")}
          </Text>
          <Text variant="body" bold>
            {m(`gate.status.${state.application.status}`)}
          </Text>
          <Text variant="secondary" tone="text2">
            {m("gate.applicationSoon")}
          </Text>
          <Button label={m("gate.refresh")} onPress={() => void refreshAccess()} testID="gate-refresh" />
          {logout}
        </Card>
      </Screen>
    );
  }

  // accessPending (и страховка для остальных видов)
  return (
    <Screen>
      <Card>
        <Text variant="title" accessibilityRole="header">
          {m("gate.pendingTitle")}
        </Text>
        <Text variant="secondary" tone="text2">
          {m("gate.pendingBody")}
        </Text>
        <Button label={m("gate.retry")} onPress={() => void retry()} />
        {logout}
      </Card>
    </Screen>
  );
}
