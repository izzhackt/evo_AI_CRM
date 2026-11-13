// Согласие на ИИ-помощников (AiConsentSettingsRow веба; Apple 5.1.2(i)). Условия студент читает и принимает при
// регистрации и на экране «Конфиденциальность»; на рабочем экране (решение владельца 14.11.2026) остаётся одна строка
// секции «Конфиденциальность» в «Профиле»: подпись, состояние словом и одна кнопка, которая отзывает согласие или даёт
// его снова. Состояние честное: «сохранено» показываем только после ответа сервера, сбой оставляет прежнее
// состояние и ту же кнопку для повтора.
import { View } from "react-native";
import { aiConsentState, type AiConsentStatus } from "@web/lib/portal/ai-consent";

import { useAiConsent, useDecideAiConsent } from "@/features/profile/use-profile";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { InlineAlert } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Decision = ReturnType<typeof useDecideAiConsent>;

function Feedback({ decision, status }: { decision: Decision; status: AiConsentStatus | null | undefined }) {
  const { t } = useLang();
  const strings = t("aiConsent");
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      {decision.isPending ? (
        <Text variant="secondary" tone="text2" testID="ai-consent-saving">
          {strings.saving}
        </Text>
      ) : decision.isSuccess ? (
        <Text variant="secondary" tone="ok" testID="ai-consent-saved">
          {status === "granted" ? strings.savedGranted : strings.savedDeclined}
        </Text>
      ) : null}
      {decision.isError ? <InlineAlert message={strings.error} testID="ai-consent-error" /> : null}
    </View>
  );
}

function DecisionButton({ decision, status, primary, label, testID }: { decision: Decision; status: AiConsentStatus; primary: boolean; label: string; testID: string }) {
  return <Button label={label} variant={primary ? "primary" : "ghost"} disabled={decision.isPending} onPress={() => decision.decide(status)} testID={testID} />;
}

/**
 * Строка в «Профиле»: «Отозвать согласие на ИИ» записывает отказ, а при отказе или без выбора та же кнопка даёт
 * согласие снова (то же решение, что на вебе). Сбой чтения — честная строка с повтором.
 */
export function AiConsentRow() {
  const { t, m } = useLang();
  const strings = t("aiConsent");
  const read = useAiConsent();
  const decision = useDecideAiConsent();
  const consent = read.data;

  if (consent === undefined) {
    return read.isError ? (
      <InlineAlert message={strings.unavailable} retryLabel={m("profile.retry")} onRetry={() => void read.refetch()} testID="ai-consent-unavailable" />
    ) : (
      <Text variant="secondary" tone="text2">
        {m("state.loading")}
      </Text>
    );
  }

  const state = aiConsentState(consent);
  const word = state === "granted" ? strings.stateGranted : state === "declined" ? strings.stateDeclined : strings.stateUndecided;
  return (
    <View style={{ gap: 12 }} testID="ai-consent-row" accessibilityLabel={`${strings.title}: ${word}`}>
      <View style={{ gap: 2 }}>
        <Text variant="body" bold>
          {strings.title}
        </Text>
        <Text variant="secondary" tone={state === "granted" ? "ok" : "text2"} bold testID="ai-consent-state">
          {word}
        </Text>
      </View>
      {state === "granted" ? (
        <DecisionButton decision={decision} status="declined" primary={false} label={strings.revoke} testID="ai-consent-revoke" />
      ) : (
        <DecisionButton decision={decision} status="granted" primary label={strings.allow} testID="ai-consent-allow" />
      )}
      <Feedback decision={decision} status={consent.status} />
    </View>
  );
}
