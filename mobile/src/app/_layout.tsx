import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConfigError, getConfig } from "@/config";
import { LangProvider, useLang } from "@/i18n/LangProvider";
import { bindAutoRefresh, getSupabase } from "@/lib/supabase";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { FONT_FILES } from "@/theme/fonts";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LangProvider>
          <ConfiguredApp />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Без EXPO_PUBLIC_* приложение не стартует и говорит почему (src/config.ts). */
function ConfiguredApp() {
  const { tokens } = useTheme();
  const { m } = useLang();
  const [fontsLoaded] = useFonts(FONT_FILES);
  let configError: string | null = null;
  try {
    getConfig();
  } catch (error) {
    configError = error instanceof ConfigError ? error.message : "Config";
  }
  useEffect(() => {
    if (configError && fontsLoaded) void SplashScreen.hideAsync();
  }, [configError, fontsLoaded]);

  if (configError) {
    return fontsLoaded ? (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: tokens.bg }}>
        <Text variant="title">{m("config.errorTitle")}</Text>
        <Text variant="secondary" tone="text2">
          {configError}
        </Text>
      </View>
    ) : null;
  }
  return (
    <SessionProvider>
      <Routes fontsLoaded={fontsLoaded} />
    </SessionProvider>
  );
}

function Routes({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { tokens, scheme, choice } = useTheme();
  const { state, mustSetPassword, ready } = useSession();

  useEffect(() => {
    const unbind = bindAutoRefresh(getSupabase());
    return unbind;
  }, []);

  // Родные элементы (клавиатура, диалоги) следуют выбору студента.
  useEffect(() => {
    Appearance.setColorScheme(choice === "system" ? "unspecified" : choice);
  }, [choice]);

  const show = fontsLoaded && ready;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync();
  }, [show]);
  if (!show) return null;

  const signedOut = state.kind === "signedOut" || state.kind === "authenticating";
  const setPassword = !signedOut && mustSetPassword;
  const active = !signedOut && !mustSetPassword && state.kind === "active";
  const gate = !signedOut && !mustSetPassword && state.kind !== "active";

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: tokens.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={setPassword}>
          <Stack.Screen name="set-password" />
        </Stack.Protected>
        <Stack.Protected guard={gate}>
          <Stack.Screen name="gate" />
        </Stack.Protected>
        <Stack.Protected guard={active}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
