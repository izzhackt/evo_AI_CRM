// Общие части экранов «Учёба»: шапка стека с «назад», страница, плашка состояния, чип,
// строка варианта ответа. Ничего про данные: только оформление по токенам приложения.
import { useRouter, type Href } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Назад по стеку; если стека нет (ссылка, перезапуск), на корень раздела. */
export function useBack(fallback: string): () => void {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.navigate(fallback as Href));
}

export function SubHeader({ title, subtitle, onBack, backLabel, testID, right }: { title: string; subtitle?: string | null; onBack: () => void; backLabel: string; testID?: string; right?: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: tokens.line, backgroundColor: tokens.bg }}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} testID={testID ? `${testID}-back` : undefined} hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
        <ArrowLeft size={22} strokeWidth={1.75} color={tokens.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text variant="body" bold accessibilityRole="header" numberOfLines={1} testID={testID}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="text2" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Страница со шапкой и прокруткой. */
export function StackPage({ children, header, refreshing, onRefresh, bottomPad = 32, testID }: { children: ReactNode; header: ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomPad?: number; testID?: string }) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={tokens.text2} /> : undefined}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: Math.max(insets.bottom, 16) + bottomPad }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Chip({ label, tone = "neutral", testID }: { label: string; tone?: "neutral" | "ok" | "warn" | "bad" | "accent"; testID?: string }) {
  const { tokens } = useTheme();
  const color = tone === "ok" ? tokens.ok : tone === "warn" ? tokens.warn : tone === "bad" ? tokens.error : tone === "accent" ? tokens.accent : tokens.text2;
  return (
    <View testID={testID} style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: color }}>
      <Text variant="caption" style={{ color }} bold>
        {label}
      </Text>
    </View>
  );
}

/** Полоса шагов (сегменты): готово / верно / неверно / текущий. */
export function SegmentBar({ states, onPress, testID, labels }: { states: readonly ("todo" | "current" | "ok" | "bad" | "done")[]; onPress?: (i: number) => void; testID?: string; labels?: readonly string[] }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 3 }}>
      {states.map((s, i) => {
        const bg = s === "ok" || s === "done" ? tokens.ok : s === "bad" ? tokens.error : s === "current" ? tokens.accent : tokens.line;
        return (
          <Pressable key={i} disabled={!onPress} accessibilityRole={onPress ? "button" : "image"} accessibilityLabel={labels?.[i]} onPress={() => onPress?.(i)} hitSlop={{ top: 12, bottom: 12 }} style={{ flex: 1 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: bg }} />
          </Pressable>
        );
      })}
    </View>
  );
}
