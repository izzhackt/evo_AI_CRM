// Регистрация по личной ссылке (аноним): ссылка -> анкета -> «Проверьте почту».
// Ссылка приходит из universal link / App Link / evoadmissions://apply?invite=…
// (параметр маршрута) или вставляется вручную. Без неё аккаунт не создаётся (SEC-1, 341).
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { getConfig } from "@/config";
import { ApplicationWizard, type WizardSubmit } from "@/features/registration/ApplicationWizard";
import { ConfirmationPending } from "@/features/registration/ConfirmationPending";
import { clearDraft, clearInviteToken, loadInviteToken, saveInviteToken } from "@/features/registration/draft-store";
import { parseInviteToken } from "@/features/registration/invite-link";
import { createRegistrationApi, type PendingConfirmation, type RegisterFailure, type RegistrationApi } from "@/features/registration/registration-api";
import { buildQuestionnaire } from "@/features/registration/wizard-model";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { EvoMark } from "@/ui/EvoMark";
import { LangSwitch } from "@/ui/LangSwitch";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { getSignupConfirmationStrings } from "@web/lib/portal/signup-confirmation-i18n";

type Phase = { kind: "loading" } | { kind: "entry" } | { kind: "wizard"; invite: string } | { kind: "pending"; pending: PendingConfirmation };

/** Сообщение пользователю для отказа регистрации (тексты веба, ответ сервера не показывается). */
export function useRegisterFailureMessage(): (reason: RegisterFailure) => string {
  const { lang, m, t } = useLang();
  const apply = t("apply") as unknown as Readonly<Record<string, string>>;
  return useCallback(
    (reason) => {
      switch (reason) {
        case "password":
          return apply["server.password"];
        case "password_too_long":
          return apply["server.password_too_long"];
        case "rate_limit":
          return apply["server.rate_limit"];
        case "conflict":
          return apply["server.conflict"];
        case "invalid":
          return apply["server.invalid"];
        case "invite":
          return apply["server.invite"];
        case "create_unknown":
          return getSignupConfirmationStrings(lang).create_unknown;
        case "upgrade_required":
          return m("wizard.err.upgrade");
        case "network":
          return m("wizard.err.network");
        default:
          return apply["server.unavailable"];
      }
    },
    [apply, lang, m],
  );
}

export function ApplyScreen({ inviteParam, api: apiProp }: { inviteParam?: string | null; api?: RegistrationApi }) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const api = useMemo(() => apiProp ?? createRegistrationApi({ baseUrl: getConfig().portalBaseUrl }), [apiProp]);
  const failureMessage = useRegisterFailureMessage();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState(false);

  // Токен из ссылки приложения важнее сохранённого; без обоих — ввод вручную.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (inviteParam) {
        await saveInviteToken(inviteParam);
        if (!cancelled) setPhase({ kind: "wizard", invite: inviteParam });
        return;
      }
      const stored = await loadInviteToken();
      if (!cancelled) setPhase(stored ? { kind: "wizard", invite: stored } : { kind: "entry" });
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteParam]);

  const submitPasted = async () => {
    const token = parseInviteToken(pasted);
    if (!token) {
      setPasteError(true);
      return;
    }
    setPasteError(false);
    await saveInviteToken(token);
    setPhase({ kind: "wizard", invite: token });
  };

  const changeLink = async () => {
    await clearInviteToken();
    setPasted("");
    setPhase({ kind: "entry" });
  };

  const onSubmit: WizardSubmit = useCallback(
    async ({ values, password }) => {
      if (phase.kind !== "wizard" || password === null) return failureMessage("invalid");
      const result = await api.register({
        email: values.email.trim().toLowerCase(),
        password,
        questionnaire: buildQuestionnaire({ ...values, email: values.email.trim().toLowerCase() }),
        invite: phase.invite,
      });
      if (result.ok) {
        await clearInviteToken();
        await clearDraft("anonymous");
        setPhase({ kind: "pending", pending: result.pending });
        return null;
      }
      return failureMessage(result.reason);
    },
    [api, failureMessage, phase],
  );

  if (phase.kind === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.bg }}>
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase.kind === "wizard") {
    return <ApplicationWizard signedInEmail={null} scope="anonymous" onSubmit={onSubmit} onExit={() => void changeLink()} exitLabel={m("apply.changeLink")} />;
  }

  return (
    <Screen>
      <View style={{ alignItems: "flex-end" }}>
        <LangSwitch />
      </View>
      <View style={{ marginTop: 24, marginBottom: 20, gap: 12 }}>
        <EvoMark size={44} color={tokens.brandRed} />
        {phase.kind === "pending" ? null : (
          <Text variant="display" accessibilityRole="header">
            {m("apply.entryTitle")}
          </Text>
        )}
      </View>
      {phase.kind === "pending" ? (
        <ConfirmationPending initial={phase.pending} api={api} onSignIn={() => router.replace("/sign-in")} />
      ) : (
        <Card>
          <Text variant="body" tone="text2">
            {m("apply.entryIntro")}
          </Text>
          <TextField
            label={m("apply.pasteLabel")}
            value={pasted}
            onChangeText={(value) => {
              setPasted(value);
              setPasteError(false);
            }}
            placeholder={m("apply.pastePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={600}
            returnKeyType="go"
            onSubmitEditing={() => void submitPasted()}
            testID="invite-input"
          />
          {pasteError ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert" testID="invite-error">
              {m("apply.pasteInvalid")}
            </Text>
          ) : null}
          <Button label={m("apply.pasteContinue")} onPress={() => void submitPasted()} testID="invite-continue" />
          <Text variant="secondary" tone="text2">
            {m("apply.noLink")}
          </Text>
          <LinkButton label={m("apply.toSignIn")} onPress={() => router.replace("/sign-in")} testID="apply-to-sign-in" />
        </Card>
      )}
    </Screen>
  );
}
