import { useState } from "react";
import { View } from "react-native";

import { ConsentChecks } from "@/features/consent/ConsentChecks";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const MIN_LENGTH = 12;
const MAX_BYTES = 72;

type Problem = "consent" | "tooShort" | "tooLong" | "mismatch" | "weak" | "unauthorized" | "staff" | "rateLimited" | "unavailable" | null;

// Правило веба (profile.passwordHint): не короче 12 символов, не длиннее 72 байт.
export function checkNewPassword(password: string, confirm: string): Exclude<Problem, "consent" | "weak" | "unauthorized" | "staff" | "rateLimited" | "unavailable"> {
  if ([...password].length < MIN_LENGTH) return "tooShort";
  if (new TextEncoder().encode(password).length > MAX_BYTES) return "tooLong";
  if (password !== confirm) return "mismatch";
  return null;
}

export default function SetPasswordScreen() {
  const { m, profile, t } = useLang();
  const { setOwnPassword, signOut } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  // 356 (решение владельца 09.11.2026): обе галочки «Конфиденциальность» обязательны и здесь, как на вебе.
  const [policy, setPolicy] = useState(false);
  const [ai, setAi] = useState(false);

  const submit = async () => {
    if (!policy || !ai) {
      setProblem("consent");
      return;
    }
    const local = checkNewPassword(password, confirm);
    if (local) {
      setProblem(local);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await setOwnPassword(password, true);
    setBusy(false);
    if (result === "ok") return;
    setProblem(
      result === "weak_password" ? "weak" : result === "unauthorized" ? "unauthorized" : result === "staff_account" ? "staff" : result === "rate_limited" ? "rateLimited" : "unavailable",
    );
  };

  const text: Record<Exclude<Problem, null>, string> = {
    consent: t("consentGate").needBoth,
    tooShort: profile.passwordTooShort,
    tooLong: profile.passwordTooLong,
    mismatch: profile.passwordMismatch,
    weak: profile.passwordRejected,
    unauthorized: m("setPassword.unauthorized"),
    staff: m("auth.err.staff_account"),
    rateLimited: profile.passwordRateLimited,
    unavailable: profile.passwordUnavailable,
  };

  return (
    <Screen>
      <View style={{ gap: 8, marginBottom: 24 }}>
        <Text variant="display" accessibilityRole="header">
          {m("setPassword.title")}
        </Text>
        <Text variant="body" tone="text2">
          {m("setPassword.intro")}
        </Text>
      </View>
      <Card>
        <TextField label={profile.passwordNew} hint={profile.passwordHint} value={password} onChangeText={setPassword} secure showLabel={m("auth.showPassword")} hideLabel={m("auth.hidePassword")} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" maxLength={4096} editable={!busy} testID="new-password" />
        <TextField label={profile.passwordConfirm} value={confirm} onChangeText={setConfirm} secure showLabel={m("auth.showPassword")} hideLabel={m("auth.hidePassword")} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" maxLength={4096} editable={!busy} testID="confirm-password" />
        <ConsentChecks policy={policy} ai={ai} onPolicy={setPolicy} onAi={setAi} editable={!busy} />
        {problem ? (
          <Text variant="secondary" tone="error" accessibilityRole="alert">
            {text[problem]}
          </Text>
        ) : null}
        <Button label={busy ? m("setPassword.saving") : m("setPassword.submit")} onPress={submit} busy={busy} testID="set-password-submit" />
        <Button label={profile.logout} variant="ghost" onPress={() => void signOut()} disabled={busy} />
      </Card>
    </Screen>
  );
}
