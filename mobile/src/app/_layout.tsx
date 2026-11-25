import "@/polyfills";

import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConfigError, getConfig } from "@/config";
import { usePreferencesReady } from "@/features/app/PreferencesGate";
import { UpdatePrompt } from "@/features/app/UpdatePrompt";
import { LangProvider, useLang } from "@/i18n/LangProvider";
import { bindAutoRefresh, getSupabase } from "@/lib/supabase";
import { SessionProvider, useSession } from "@/session/SessionProvider";
import { FONT_FILES } from "@/theme/fonts";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { primeReducedMotion } from "@/ui/motion";
import { Text } from "@/ui/Text";

// Сбой отрисовки: свой экран на языке студента вместо английского «Something went wrong» expo-router (G5 аудита паритета).
export { AppErrorBoundary as ErrorBoundary } from "@/features/app/AppErrorBoundary";

void SplashScreen.preventAutoHideAsync();
// Настройка «Уменьшить движение» читается при запуске: к первому показу «Главной» она уже известна.
primeReducedMotion();

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

/**
 * Без EXPO_PUBLIC_* приложение не стартует и говорит почему (src/config.ts). Заставка держится, пока не загрузились шрифты и
 * не прочитан выбор темы и языка с устройства (`usePreferencesReady`): первый показанный кадр уже в теме и на языке студента.
 */
function ConfiguredApp() {
  const { tokens } = useTheme();
  const { m } = useLang();
  const preferencesReady = usePreferencesReady();
  const [fontsLoaded] = useFonts(FONT_FILES);
  let configError: string | null = null;
  try {
    getConfig();
  } catch (error) {
    configError = error instanceof ConfigError ? error.message : "Config";
  }
  useEffect(() => {
    if (configError && fontsLoaded && preferencesReady) void SplashScreen.hideAsync();
  }, [configError, fontsLoaded, preferencesReady]);

  if (configError) {
    return fontsLoaded && preferencesReady ? (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: tokens.bg }} testID="config-error">
        <Text variant="title">{m("config.errorTitle")}</Text>
        <Text variant="secondary" tone="text2">
          {configError}
        </Text>
      </View>
    ) : null;
  }
  return (
    <SessionProvider>
      <Routes fontsLoaded={fontsLoaded} preferencesReady={preferencesReady} />
    </SessionProvider>
  );
}

function Routes({ fontsLoaded, preferencesReady }: { fontsLoaded: boolean; preferencesReady: boolean }) {
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

  const show = fontsLoaded && ready && preferencesReady;
  useEffect(() => {
    if (show) void SplashScreen.hideAsync();
  }, [show]);
  if (!show) return null;

  const signedOut = state.kind === "signedOut" || state.kind === "authenticating";
  const setPassword = !signedOut && mustSetPassword;
  const active = !signedOut && !mustSetPassword && state.kind === "active";
  const consent = !signedOut && !mustSetPassword && state.kind === "needsConsent";
  const gate = !signedOut && !mustSetPassword && state.kind !== "active" && state.kind !== "needsConsent";

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ statusBarStyle: scheme === "dark" ? "light" : "dark", headerShown: false, animation: "fade", contentStyle: { backgroundColor: tokens.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={setPassword}>
          <Stack.Screen name="set-password" />
        </Stack.Protected>
        <Stack.Protected guard={consent}>
          <Stack.Screen name="consent" />
        </Stack.Protected>
        <Stack.Protected guard={gate}>
          <Stack.Screen name="gate" />
        </Stack.Protected>
        <Stack.Protected guard={active}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
      {/* Обновление скачано: предложить перезапуск (G4). Без обновлений и в разработке карточки нет. */}
      <UpdatePrompt />
    </>
  );
}
