// Согласие на ИИ-помощников (AiConsentSettingsRow веба; Apple 5.1.2(i)). Карточки на «Главной» больше нет (09.11.2026:
// первое решение принимается на экране «Конфиденциальность», здесь остаётся просмотр и «Отозвать»). Состояние честное:
// «сохранено» показываем только после ответа сервера, сбой оставляет прежнее состояние и ту же кнопку для повтора.
import { View } from "react-native";
import { aiConsentDate, aiConsentOutdated, aiConsentState, type AiConsent, type AiConsentStatus } from "@web/lib/portal/ai-consent";

import { openExternal, PRIVACY_URL } from "@/features/profile/external";
import { useAiConsent, useDecideAiConsent } from "@/features/profile/use-profile";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardHead, InlineAlert, LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Decision = ReturnType<typeof useDecideAiConsent>;

function Feedback({ decision, consent }: { decision: Decision; consent: AiConsent | undefined }) {
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
          {consent?.status === "granted" ? strings.savedGranted : strings.savedDeclined}
        </Text>
      ) : null}
      {decision.isError ? <InlineAlert message={strings.error} testID="ai-consent-error" /> : null}
    </View>
  );
}

function PolicyLink() {
  const { t } = useLang();
  return <LinkButton label={t("aiConsent").policyLink} onPress={() => void openExternal(PRIVACY_URL)} testID="ai-consent-policy" />;
}

function DecisionButton({ decision, status, primary, label, testID }: { decision: Decision; status: AiConsentStatus; primary: boolean; label: string; testID: string }) {
  return <Button label={label} variant={primary ? "primary" : "ghost"} disabled={decision.isPending} onPress={() => decision.decide(status)} testID={testID} />;
}

/**
 * Строка в «Профиле»: состояние словом и датой, действия по состоянию. «Отозвать согласие» записывает отказ —
 * то же решение, что «Не разрешать» на «Главной». Сбой чтения — честная строка с повтором.
 */
export function AiConsentRow() {
  const { t, m } = useLang();
  const strings = t("aiConsent");
  const read = useAiConsent();
  const decision = useDecideAiConsent();
  const consent = read.data;

  return (
    <Card>
      <CardHead title={strings.rowHeading} />
      {consent === undefined ? (
        read.isError ? (
          <InlineAlert message={strings.unavailable} retryLabel={m("profile.retry")} onRetry={() => void read.refetch()} testID="ai-consent-unavailable" />
        ) : (
          <Text variant="secondary" tone="text2">
            {m("state.loading")}
          </Text>
        )
      ) : (
        <View style={{ gap: 12 }} testID="ai-consent-row" accessibilityLabel={strings.rowHeading}>
          <ConsentState consent={consent} />
          <Text variant="body">{strings.body}</Text>
          {aiConsentOutdated(consent) ? (
            <Text variant="secondary" tone="text2">
              {strings.policyUpdated}
            </Text>
          ) : null}
          <View style={{ gap: 8 }}>
            {aiConsentState(consent) === "granted" ? (
              <DecisionButton decision={decision} status="declined" primary={false} label={strings.revoke} testID="ai-consent-revoke" />
            ) : (
              <>
                <DecisionButton decision={decision} status="granted" primary label={strings.allow} testID="ai-consent-allow" />
                {aiConsentState(consent) === "undecided" ? (
                  <DecisionButton decision={decision} status="declined" primary={false} label={strings.decline} testID="ai-consent-decline" />
                ) : null}
              </>
            )}
          </View>
          <Feedback decision={decision} consent={consent} />
          <PolicyLink />
        </View>
      )}
    </Card>
  );
}

function ConsentState({ consent }: { consent: AiConsent }) {
  const { t } = useLang();
  const strings = t("aiConsent");
  const state = aiConsentState(consent);
  const word = state === "granted" ? strings.stateGranted : state === "declined" ? strings.stateDeclined : strings.stateUndecided;
  return (
    <Text variant="body" testID="ai-consent-state">
      <Text variant="body" bold tone={state === "granted" ? "ok" : "text"}>
        {word}
      </Text>
      {state !== "undecided" && consent.decidedAt ? ` · ${aiConsentDate(consent.decidedAt)}` : ""}
    </Text>
  );
}
