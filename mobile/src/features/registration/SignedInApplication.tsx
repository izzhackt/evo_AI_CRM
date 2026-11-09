// Вошедший студент без анкеты (SessionState.needsApplication): либо сохранённый при регистрации
// черновик отправляется сразу (resume, expected_revision 0), либо мастер в режиме signedIn.
// Порт ApplicationIntake iPhone: приглашение (invite-acceptance) только предзаполняет имя и
// никогда не блокирует; конфликт ревизии ведёт на статус уже существующей анкеты.
import { userDraftScope } from "@/features/registration/draft-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { getConfig } from "@/config";
import { registrationAiConsentChoice } from "@/features/registration/ai-consent";
import { ApplicationWizard, type WizardSubmit } from "@/features/registration/ApplicationWizard";
import { createRegistrationApi } from "@/features/registration/registration-api";
import {
  METADATA_KEYS_TO_CLEAR,
  readMetadataSubmission,
  submitStudentApplication,
  type SubmitOutcome,
} from "@/features/registration/submit-application";
import { namePrefillFromDisplayName, type NamePrefill } from "@/features/registration/wizard-model";
import { useLang } from "@/i18n/LangProvider";
import { getSupabase, platformTransport } from "@/lib/supabase";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import type { StudentApplicationDraft } from "@/features/registration/application-contract";

type MessageKey = "wizard.err.network" | "wizard.err.conflict" | "wizard.err.invalid" | "error.forbidden" | "error.rateLimited" | "error.server" | "wizard.err.submit";

export function outcomeMessageKey(outcome: Exclude<SubmitOutcome, "submitted">): MessageKey {
  switch (outcome) {
    case "offline":
      return "wizard.err.network";
    case "conflict":
      return "wizard.err.conflict";
    case "invalid":
      return "wizard.err.invalid";
    case "forbidden":
      return "error.forbidden";
    case "rate_limited":
      return "error.rateLimited";
    case "server":
      return "error.server";
    default:
      return "wizard.err.submit";
  }
}

/** Реальные зависимости отправки: RPC платформы и очистка метаданных пользователя. */
export function useSubmitDeps() {
  return useMemo(() => {
    const supabase = getSupabase();
    return {
      supabase,
      transport: platformTransport(supabase),
      clearMetadata: async () => {
        await supabase.auth.updateUser({ data: METADATA_KEYS_TO_CLEAR });
      },
    };
  }, []);
}

export function SignedInWizard({
  email,
  expectedRevision,
  initialDraft = null,
  namePrefill = null,
  onDone,
  onExit,
}: {
  email: string;
  expectedRevision: number;
  initialDraft?: StudentApplicationDraft | null;
  namePrefill?: NamePrefill | null;
  /** Анкета принята (или уже существует): обновить маршрут сессии. */
  onDone: () => void;
  onExit?: () => void;
}) {
  const { m } = useLang();
  const deps = useSubmitDeps();
  const onSubmit: WizardSubmit = useCallback(
    async ({ draft }) => {
      const aiChoice = await registrationAiConsentChoice(draft.requestId);
      const outcome = await submitStudentApplication(deps, { draft, expectedRevision, aiChoice });
      if (outcome === "submitted" || outcome === "conflict") {
        // Конфликт: анкета уже есть, маршрут покажет её статус.
        onDone();
        return null;
      }
      return m(outcomeMessageKey(outcome));
    },
    [deps, expectedRevision, m, onDone],
  );
  return (
    <ApplicationWizard
      signedInEmail={email}
      scope={userDraftScope(email, expectedRevision)}
      initialDraft={initialDraft}
      namePrefill={namePrefill}
      onSubmit={onSubmit}
      onExit={onExit}
    />
  );
}

export function NeedsApplicationScreen({ email, resume }: { email: string | null; resume: boolean }) {
  const { tokens } = useTheme();
  const { m, profile } = useLang();
  const { refreshAccess, signOut } = useSession();
  const deps = useSubmitDeps();
  const [mode, setMode] = useState<"checking" | "submitting" | "failed" | "wizard">(resume ? "submitting" : "checking");
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [prefill, setPrefill] = useState<NamePrefill | null>(null);
  const started = useRef(false);

  const doResume = useCallback(async () => {
    const { data } = await deps.supabase.auth.getSession();
    const pending = readMetadataSubmission(data.session?.user?.user_metadata);
    if (!pending) {
      setMode("wizard");
      return;
    }
    const outcome = await submitStudentApplication(deps, { draft: pending.draft, expectedRevision: 0, aiChoice: pending.aiChoice });
    if (outcome === "submitted" || outcome === "conflict") {
      await refreshAccess();
      return;
    }
    setFailure(outcomeMessageKey(outcome));
    setMode("failed");
  }, [deps, refreshAccess]);

  const retryResume = () => {
    setMode("submitting");
    void doResume();
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (resume) {
        await doResume();
        return;
      }
      // Приглашение только предзаполняет имя; любой сбой молча пропускается.
      try {
        const { data } = await deps.supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const result = await createRegistrationApi({ baseUrl: getConfig().portalBaseUrl }).acceptInvite(token);
          if (result.ok && result.acceptance.intakeFlow === "anketa_v1") setPrefill(namePrefillFromDisplayName(result.acceptance.displayName));
        }
      } catch {
        // не блокирует
      }
      setMode("wizard");
    })();
  }, [deps, resume, doResume]);

  if (mode === "wizard" && email) {
    return <SignedInWizard email={email} expectedRevision={0} namePrefill={prefill} onDone={() => void refreshAccess()} />;
  }

  if (mode === "failed") {
    return (
      <Screen>
        <Card>
          <Text variant="title" accessibilityRole="header">
            {m("resume.failedTitle")}
          </Text>
          <Text variant="body">{m("resume.failedBody")}</Text>
          {failure ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert">
              {m(failure)}
            </Text>
          ) : null}
          <Button label={m("resume.retry")} onPress={retryResume} testID="resume-retry" />
          <Button label={m("resume.fillAgain")} variant="ghost" onPress={() => setMode("wizard")} testID="resume-fill-again" />
          <Button label={m("gate.refresh")} variant="ghost" onPress={() => void refreshAccess()} />
          <Button label={profile.logout} variant="ghost" onPress={() => void signOut()} />
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: tokens.bg }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={tokens.accent} />
      <Text variant="secondary" tone="text2">
        {mode === "submitting" ? m("resume.title") : m("gate.resolving")}
      </Text>
    </View>
  );
}
