import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { SignInFailure } from "@/api/portal-auth";
import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";
import { useSession } from "@/session/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { EvoMark } from "@/ui/EvoMark";
import { LangSwitch } from "@/ui/LangSwitch";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function SignInScreen() {
  const { tokens } = useTheme();
  const { m, recovery } = useLang();
  const { state, signIn } = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const busy = state.kind === "authenticating";
  const accountDeleted = state.kind === "signedOut" && state.accountDeleted && failure === null;

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    if (login.trim() === "" || password === "") {
      setFailure("invalid_request");
      return;
    }
    const result = await signIn(login, password);
    if (!result.ok) setFailure(result.reason);
  };

  return (
    <Screen>
      <View style={{ alignItems: "flex-end" }}>
        <LangSwitch />
      </View>
      <View style={{ marginTop: 32, marginBottom: 24, gap: 12 }}>
        <EvoMark size={44} color={tokens.brandRed} />
        <Text variant="display" accessibilityRole="header">
          {m("auth.title")}
        </Text>
        <Text variant="body" tone="text2">
          {m("auth.intro")}
        </Text>
      </View>
      <Card>
        {accountDeleted ? (
          <Text variant="secondary" tone="text2" accessibilityRole="alert">
            {m("auth.accountDeleted")}
          </Text>
        ) : null}
        <TextField
          label={m("auth.login")}
          value={login}
          onChangeText={setLogin}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          keyboardType="email-address"
          maxLength={320}
          returnKeyType="next"
          editable={!busy}
          testID="login-input"
        />
        <TextField
          label={m("auth.password")}
          value={password}
          onChangeText={setPassword}
          secure
          showLabel={m("auth.showPassword")}
          hideLabel={m("auth.hidePassword")}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          maxLength={4096}
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          testID="password-input"
        />
        {failure ? (
          <Text variant="secondary" tone="error" accessibilityRole="alert" testID="sign-in-error">
            {m(`auth.err.${failure}` as MobileStringKey)}
          </Text>
        ) : null}
        <Button label={busy ? m("auth.signingIn") : m("auth.signIn")} onPress={submit} busy={busy} testID="sign-in-submit" />
        <Link href="/forgot-password" style={{ alignSelf: "center", minHeight: 44, paddingVertical: 12 }} testID="forgot-link">
          <Text variant="secondary" tone="accent" bold>
            {recovery.forgotLink}
          </Text>
        </Link>
      </Card>
    </Screen>
  );
}
