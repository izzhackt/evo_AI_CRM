import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/session/SessionProvider";
import { Button } from "@/ui/Button";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const RESEND_SECONDS = 60;
type Status = "idle" | "sending" | "sent" | "invalid_email" | "rate_limited" | "unavailable";

export default function ForgotPasswordScreen() {
  const { recovery, fill } = useLang();
  const { portalAuth } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const submit = async () => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320) {
      setStatus("invalid_email");
      return;
    }
    setStatus("sending");
    const result = await portalAuth.requestPasswordRecovery(value);
    if (result.ok) {
      setStatus("sent");
      setWait(RESEND_SECONDS);
    } else {
      setStatus(result.reason === "rate_limited" ? "rate_limited" : "unavailable");
    }
  };

  const error = status === "invalid_email" ? recovery.invalid_email : status === "rate_limited" ? recovery.rate_limited : status === "unavailable" ? recovery.unavailable : null;

  return (
    <Screen>
      <View style={{ gap: 8, marginBottom: 24 }}>
        <Text variant="display" accessibilityRole="header">
          {recovery.forgotTitle}
        </Text>
        <Text variant="body" tone="text2">
          {recovery.forgotIntro}
        </Text>
      </View>
      <Card>
        <TextField
          label={recovery.emailLabel}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          maxLength={320}
          editable={status !== "sending"}
          testID="recovery-email"
        />
        {error ? (
          <Text variant="secondary" tone="error" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {status === "sent" ? (
          <View style={{ gap: 4 }} accessibilityRole="alert">
            <Text variant="secondary">{recovery.sent}</Text>
            <Text variant="caption" tone="text2">
              {recovery.sentValidity}
            </Text>
          </View>
        ) : null}
        <Button
          label={wait > 0 ? fill(recovery.resendIn, { seconds: wait }) : status === "sent" ? recovery.resend : recovery.submit}
          onPress={submit}
          busy={status === "sending"}
          disabled={wait > 0}
          testID="recovery-submit"
        />
        <Link href="/sign-in" replace style={{ alignSelf: "center", minHeight: 44, paddingVertical: 12 }}>
          <Text variant="secondary" tone="accent" bold>
            {recovery.backToLogin}
          </Text>
        </Link>
        <Text variant="caption" tone="text2">
          {recovery.staffNote}
        </Text>
      </Card>
    </Screen>
  );
}
