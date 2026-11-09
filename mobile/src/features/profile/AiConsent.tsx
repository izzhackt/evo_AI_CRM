// Согласие на ИИ-помощников (AiConsentHomeCard + AiConsentSettingsRow веба; Apple 5.1.2(i)). Состояние честное:
// «сохранено» показываем только после ответа сервера, сбой оставляет прежнее состояние и ту же кнопку для повтора.
import { useState } from "react";
import { View } from "react-native";
import { aiConsentDate, aiConsentOutdated, aiConsentState, type AiConsent, type AiConsentStatus } from "@web/lib/portal/ai-consent";

import { go } from "@/features/portal/navigation";
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
 * Карточка на «Главной» клиента с делом на сопровождении, пока для текущей версии текста нет решения.
 * Не окно и не преграда. После решения в этом заходе остаётся подтверждение и переход в «Профиль»,
 * при следующем открытии карточки уже нет. Сбой чтения прячет карточку и не трогает остальное.
 */
export function AiConsentHomeCard() {
  const { t } = useLang();
  const strings = t("aiConsent");
  const read = useAiConsent("home");
  const decision = useDecideAiConsent();
  // Карточка, показанная в этом заходе, не пропадает сразу после ответа: сначала подтверждение.
  const [shown, setShown] = useState(false);
  const consent = read.data;
  const asking = consent !== undefined && aiConsentState(consent) === "undecided";
  if (asking && !shown) setShown(true);
  if (!consent || (!asking && !shown)) return null;

  return (
    <Card>
      <View style={{ gap: 12 }} testID="ai-consent-card">
        <CardHead title={strings.title} />
        {asking ? (
          <>
            <Text variant="body">{strings.body}</Text>
            {aiConsentOutdated(consent) ? (
              <Text variant="secondary" tone="text2">
                {strings.policyUpdated}
              </Text>
            ) : null}
            <PolicyLink />
            <View style={{ gap: 8 }}>
              <DecisionButton decision={decision} status="granted" primary label={strings.allow} testID="ai-consent-allow" />
              <DecisionButton decision={decision} status="declined" primary={false} label={strings.decline} testID="ai-consent-decline" />
            </View>
          </>
        ) : null}
        <Feedback decision={decision} consent={consent} />
        {asking ? null : <LinkButton label={strings.changeInProfile} onPress={() => go("/profile")} testID="ai-consent-to-profile" />}
      </View>
    </Card>
  );
}

/**
 * Строка в «Профиле»: состояние словом и датой, действия по состоянию. «Отозвать согласие» записывает отказ —
 * то же решение, что «Не разрешать» на «Главной». Сбой чтения — честная строка с повтором.
 */
export function AiConsentRow() {
  const { t, m } = useLang();
  const strings = t("aiConsent");
  const read = useAiConsent("profile");
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
