import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/ThemeProvider";

/** Страница: фон `--pt-bg`, боковое поле 16, прокрутка, учёт безопасных зон. */
export function Screen({
  children,
  bottomInset = 0,
  topInset = true,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  bottomInset?: number;
  topInset?: boolean;
  /** Потянуть вниз, чтобы обновить (если задано). */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: tokens.bg }}>
      <ScrollView
        testID="screen-scroll"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.text2} /> : undefined}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: topInset ? insets.top + 16 : 16, paddingBottom: Math.max(insets.bottom, 16) + bottomInset }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const { tokens, scheme } = useTheme();
  return (
    <View
      style={{
        backgroundColor: tokens.surface,
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        padding: 16,
        gap: 12,
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
      }}
    >
      {children}
    </View>
  );
}
