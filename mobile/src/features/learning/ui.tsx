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

/** Состояние шага в полосе: ещё не пройден, текущий, верно, неверно, готово. */
export type SegmentState = "todo" | "current" | "ok" | "bad" | "done";

/** Слово для читалки у каждого состояния («верно», «без ответа»). Слова даёт вызывающий из словаря RU и KY: здесь строк нет. */
export type SegmentStateWords = Partial<Record<SegmentState, string>>;

/** Высота сегмента и высота цельной полосы (`.pt-progress` веба: 8 px). */
const SEGMENT_HEIGHT = 6;
const PROGRESS_HEIGHT = 8;

/** Сколько шагов пройдено: верно, неверно или готово. Текущий и ещё не начатый в счёт не идут. */
export function answeredSegments(states: readonly SegmentState[]): number {
  return states.filter((s) => s === "ok" || s === "bad" || s === "done").length;
}

/**
 * Подпись сегмента для читалки: «Задание 3 из 12, верно» - название и слово состояния через запятую, как подписи ячеек
 * навигатора теста в вебе (`TimedTestRunner`: «Задание 3, отвечено»). Без слова состояния остаётся одно название.
 */
export function segmentA11yLabel(label: string | undefined, state: SegmentState, words?: SegmentStateWords): string | undefined {
  const word = words?.[state]?.trim();
  if (!word) return label;
  const name = label?.trim();
  return name ? `${name}, ${word}` : word;
}

export type SegmentBarProps = {
  states: readonly SegmentState[];
  onPress?: (i: number) => void;
  testID?: string;
  labels?: readonly string[];
  /**
   * `"segments"` (по умолчанию, вид и поведение прежние) - по сегменту на шаг. `"continuous"` - одна цельная полоса для
   * длинных тестов (92 утверждения: сегмент в 1 pt нельзя ни нажать, ни услышать 92 раза). Как `<progress>` веба:
   * читалка слышит один элемент с названием `summaryLabel` и долей; перехода по шагам нет, `onPress` и `labels`
   * игнорируются.
   */
  variant?: "segments" | "continuous";
  /** Слова состояний: к подписи сегмента добавляется слово («Задание 3 из 12, верно»). Текущему шагу ставится `selected`. */
  stateWords?: SegmentStateWords;
  /** Зона нажатия сегмента 44 pt вместо прежних 30 pt (HIG, WCAG 2.5.8); вид и место полосы на экране те же. */
  largeTarget?: boolean;
  /** Название цельной полосы для читалки («Ответили на 12 из 92»). Только для `"continuous"`. */
  summaryLabel?: string;
};

/** Полоса шагов (сегменты): готово / верно / неверно / текущий. Для длинных тестов - `variant="continuous"`. */
export function SegmentBar({ states, onPress, testID, labels, variant = "segments", stateWords, largeTarget = false, summaryLabel }: SegmentBarProps) {
  const { tokens } = useTheme();
  if (variant === "continuous") {
    const total = states.length;
    const answered = answeredSegments(states);
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={summaryLabel}
        accessibilityValue={{ min: 0, max: Math.max(total, 1), now: answered }}
        style={{ height: PROGRESS_HEIGHT, borderRadius: tokens.radiusChip, backgroundColor: tokens.line, overflow: "hidden" }}
      >
        <View style={{ height: PROGRESS_HEIGHT, width: `${total ? (answered / total) * 100 : 0}%`, borderRadius: tokens.radiusChip, backgroundColor: tokens.accent }} />
      </View>
    );
  }
  // Зона нажатия 44 pt: сам Pressable высотой 44, полоса по центру. Отрицательное поле возвращает строке прежние 6 pt
  // в раскладке, поэтому экран не сдвигается. `hitSlop` не годится: он не выходит за границы родителя (его высота 6 pt).
  const reach = (MIN_TARGET - SEGMENT_HEIGHT) / 2;
  return (
    <View testID={testID} style={largeTarget ? { flexDirection: "row", gap: 3, marginVertical: -reach } : { flexDirection: "row", gap: 3 }}>
      {states.map((s, i) => {
        const bg = s === "ok" || s === "done" ? tokens.ok : s === "bad" ? tokens.error : s === "current" ? tokens.accent : tokens.line;
        return (
          <Pressable
            key={i}
            disabled={!onPress}
            accessibilityRole={onPress ? "button" : "image"}
            accessibilityLabel={segmentA11yLabel(labels?.[i], s, stateWords)}
            accessibilityState={stateWords && s === "current" ? { selected: true } : undefined}
            onPress={() => onPress?.(i)}
            hitSlop={largeTarget ? undefined : { top: 12, bottom: 12 }}
            style={largeTarget ? { flex: 1, minHeight: MIN_TARGET, justifyContent: "center" } : { flex: 1 }}
          >
            <View style={{ height: SEGMENT_HEIGHT, borderRadius: 3, backgroundColor: bg }} />
          </Pressable>
        );
      })}
    </View>
  );
}
