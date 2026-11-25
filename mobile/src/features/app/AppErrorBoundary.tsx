// Сбой экрана (G5 аудита паритета 25.11.2026; веб: src/app/(portal)/portal/error.tsx и boundary-i18n.ts): вместо английского
// «Something went wrong» от expo-router студент видит «Не удалось открыть кабинет» на своём языке и «Попробовать снова». Тексты
// RU и KY - общий словарь границ веба. Граница стоит над провайдерами приложения (при сбое корневого макета их уже нет), поэтому
// свои провайдеры темы и языка ставит сама: оба читают выбор студента с устройства. Пока выбор не прочитан (один-два кадра),
// экран не рисуется (`PreferencesGate`): студент с тёмной темой или кыргызским языком не видит светлый русский кадр, а читалка не
// озвучивает предупреждение дважды. Областей безопасности (SafeAreaProvider) она не ставит и от них не зависит: в сбойный момент
// нативный слой мог не успеть ответить, а экрану сбоя нужен только отступ сверху.
import { useEffect } from "react";
import { View } from "react-native";
import { getBoundaryStrings } from "@web/lib/portal/boundary-i18n";

import { PreferencesGate } from "@/features/app/PreferencesGate";
import { LangProvider, useLang } from "@/i18n/LangProvider";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type Props = Readonly<{
  error: Error;
  /** Перерисовать маршрут, сняв ошибку (expo-router `ErrorBoundaryProps.retry`). */
  retry: () => Promise<void>;
}>;

function ErrorCard({ retry }: { retry: () => Promise<void> }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const words = getBoundaryStrings(lang);
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 16, backgroundColor: tokens.bg }} testID="app-error">
      <Card>
        <Text variant="caption" tone="text2" bold>
          {words.portalErrorKicker}
        </Text>
        <Text variant="title" accessibilityRole="header">
          {words.portalErrorTitle}
        </Text>
        <Text variant="body" tone="text2" accessibilityRole="alert">
          {words.portalErrorText}
        </Text>
        <Button label={words.portalErrorAction} onPress={() => void retry()} testID="app-error-retry" />
      </Card>
    </View>
  );
}

/** Для `export { AppErrorBoundary as ErrorBoundary }` в корневом макете. */
export function AppErrorBoundary({ error, retry }: Props) {
  // Причина сбоя остаётся в журнале разработчика; на экран и в обращение к серверу она не идёт.
  useEffect(() => {
    if (__DEV__) console.error(error);
  }, [error]);
  return (
    <ThemeProvider>
      <LangProvider>
        <PreferencesGate>
          <ErrorCard retry={retry} />
        </PreferencesGate>
      </LangProvider>
    </ThemeProvider>
  );
}
