// Общие части карточек кабинета: шапка, пустое состояние, плашка сбоя с повтором,
// скелетон, ссылка-кнопка. Образец: src/components/portal/home/HomeParts.tsx (веб #1412).
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";
import type { LucideIcon } from "lucide-react-native";

/** Минимальная цель нажатия: 44 pt (HIG, WCAG 2.5.8). */
export const MIN_TARGET = 44;

/** Шапка карточки: заголовок со счётчиком слева, переход справа. */
export function CardHead({ title, count = null, action = null, headingId }: { title: string; count?: number | null; action?: ReactNode; headingId?: string }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        <Text variant="heading" accessibilityRole="header" nativeID={headingId} style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {count ? (
          <View style={{ minWidth: 24, paddingHorizontal: 8, paddingVertical: 2, borderRadius: tokens.radiusChip, backgroundColor: tokens.accentSoft, alignItems: "center" }}>
            <Text variant="caption" tone="accent" bold accessibilityLabel={String(count)}>
              {count}
            </Text>
          </View>
        ) : null}
      </View>
      {action}
    </View>
  );
}

/** Текстовая ссылка (`.pt-link`) с целью нажатия не меньше 44 pt. */
export function LinkButton({ label, onPress, testID, accessibilityHint }: { label: string; onPress: () => void; testID?: string; accessibilityHint?: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityHint={accessibilityHint} onPress={onPress} testID={testID} hitSlop={4} style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
      <Text variant="secondary" tone="accent" bold>
        {label}
      </Text>
    </Pressable>
  );
}

/** Пустое состояние: значок в бледно-красном круге, заголовок, строка и действие. */
export function EmptyBlock({ icon: Icon, title, body = null, action = null }: { icon: LucideIcon; title: string; body?: string | null; action?: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <View accessible={false} style={{ alignItems: "flex-start", gap: 4 }}>
      <View
        style={{ width: 48, height: 48, borderRadius: tokens.radiusChip, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 8 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={20} strokeWidth={1.75} color={tokens.accent} />
      </View>
      <Text variant="body" bold>
        {title}
      </Text>
      {body ? (
        <Text variant="secondary" tone="text2">
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

/**
 * Плашка сбоя источника. Текст берёт вызывающий из словаря i18n, ответ сервера сюда
 * не попадает. Повтор: кнопка с целью 44 pt.
 */
export function InlineAlert({ message, retryLabel, onRetry, testID }: { message: string; retryLabel?: string; onRetry?: () => void; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      style={{ gap: 4, padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.error, backgroundColor: tokens.surface }}
    >
      <Text variant="secondary" tone="error">
        {message}
      </Text>
      {onRetry && retryLabel ? <LinkButton label={retryLabel} onPress={onRetry} /> : null}
    </View>
  );
}

/** Блок скелетона: мягкая пульсация; читалке сообщает «загрузка» только родитель. */
export function Skeleton({ height = 16, width = "100%", radius = 6, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { tokens } = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View importantForAccessibility="no" accessibilityElementsHidden style={[{ height, width, borderRadius: radius, backgroundColor: tokens.skeleton, opacity }, style]} />;
}

/** Карточка-скелетон: заголовок и две строки. `label` читает читалка. */
export function CardSkeleton({ label, lines = 2, testID }: { label: string; lines?: number; testID?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} testID={testID} style={{ gap: 12 }}>
      <Skeleton height={22} width="55%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "70%" : "100%"} />
      ))}
    </View>
  );
}
