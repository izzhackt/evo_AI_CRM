// Общие части экранов «Учёба»: шапка стека с «назад», страница, плашка состояния, чип,
// строка варианта ответа. Ничего про данные: только оформление по токенам приложения.
import { useRouter, type Href } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import type { ReactNode, RefObject } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatFabClearance, useTabBarClearance } from "@/shell/useTabBarClearance";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import type { ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Назад по стеку; если стека нет (ссылка, перезапуск), на корень раздела. */
export function useBack(fallback: string): () => void {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.navigate(fallback as Href));
}

export function SubHeader({ title, subtitle, subtitleExtra, avatar, subtitleBelow = false, onBack, backLabel, testID, right }: {
  title: string;
  subtitle?: string | null;
  /** Рядом со второй строкой (бегущие точки «печатает»); без `subtitle` не рисуется. */
  subtitleExtra?: ReactNode;
  /** Между «назад» и названием (неподвижный робот в шапке Эви). */
  avatar?: ReactNode;
  /**
   * Вторая строка стоит под рядом «аватар, название, кнопка» и берёт его ширину, а не узкую колонку между аватаром и кнопкой.
   * Нужно Эви: рядом с кнопкой «Новый чат» на экране 360-402 pt для подписи остаётся 87-136 pt, и «ИИ-профориентатор EVO» (162 pt при
   * 13 pt), «EVO ЖИ-кесиптик кеңешчиси» (191 pt) и «10 суроонун 3-суроосу» (154 pt) обрезались. Две строки в той колонке не спасали:
   * слово «ИИ-профориентатор» (133 pt) шире её на половине телефонов. Остальным экранам такая шапка не нужна.
   */
  subtitleBelow?: boolean;
  onBack: () => void;
  backLabel: string;
  testID?: string;
  right?: ReactNode;
}) {
  const { tokens } = useTheme();
  const frame = { gap: 8, paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: tokens.line, backgroundColor: tokens.bg } as const;
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} testID={testID ? `${testID}-back` : undefined} hitSlop={4} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
      <ArrowLeft size={22} strokeWidth={1.75} color={tokens.text} />
    </Pressable>
  );
  const line = subtitle ? (
    subtitleExtra ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text variant="caption" tone="text2" numberOfLines={subtitleBelow ? 2 : 1} style={{ flexShrink: 1 }} testID={testID ? `${testID}-subtitle` : undefined}>
          {subtitle}
        </Text>
        {subtitleExtra}
      </View>
    ) : (
      <Text variant="caption" tone="text2" numberOfLines={subtitleBelow ? 2 : 1} testID={testID ? `${testID}-subtitle` : undefined}>
        {subtitle}
      </Text>
    )
  ) : null;
  if (subtitleBelow) {
    return (
      <View style={{ ...frame, flexDirection: "row", alignItems: "flex-start" }}>
        {back}
        <View style={{ flex: 1 }}>
          <View testID={testID ? `${testID}-row` : undefined} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: MIN_TARGET }}>
            {avatar}
            <Text variant="body" bold accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }} testID={testID}>
              {title}
            </Text>
            {right}
          </View>
          {line}
        </View>
      </View>
    );
  }
  return (
    <View style={{ ...frame, flexDirection: "row", alignItems: "center" }}>
      {back}
      {avatar}
      <View style={{ flex: 1 }}>
        <Text variant="body" bold accessibilityRole="header" numberOfLines={1} testID={testID}>
          {title}
        </Text>
        {line}
      </View>
      {right}
    </View>
  );
}

/**
 * Нижний отступ страницы стека, как у `Screen`: запас под плавающую панель вкладок и под кнопку «Написать EVO» (одни и те же правила
 * и те же хуки). Без него главная кнопка внизу страницы («Начать» и «Продолжить» в тесте) оказывалась под панелью (ревью QA 22).
 * `extra` - запас сверху этого, если экрану нужен свой.
 */
export function useStackPageBottom(extra = 0): number {
  const insets = useSafeAreaInsets();
  const tabBar = useTabBarClearance();
  const chatFab = useChatFabClearance();
  return Math.max(insets.bottom, 16) + extra + tabBar + chatFab;
}

/** Страница со шапкой и прокруткой. */
export function StackPage({ children, header, refreshing, onRefresh, bottomPad = 0, scrollRef, onScrollY, testID }: { children: ReactNode; header: ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomPad?: number; scrollRef?: RefObject<ScrollTarget | null>; onScrollY?: (y: number) => void; testID?: string }) {
  const { tokens } = useTheme();
  const bottom = useStackPageBottom(bottomPad);
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      {header}
      <ScrollView
        ref={scrollRef as RefObject<never> | undefined}
        testID={testID ? `${testID}-scroll` : undefined}
        onScroll={onScrollY ? (event) => onScrollY(event.nativeEvent.contentOffset.y) : undefined}
        scrollEventThrottle={onScrollY ? 16 : undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={tokens.text2} /> : undefined}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottom }}
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

type SegmentBarCommon = {
  states: readonly SegmentState[];
  onPress?: (i: number) => void;
  testID?: string;
  labels?: readonly string[];
  /** Слова состояний: к подписи сегмента добавляется слово («Задание 3 из 12, верно»). Текущему шагу ставится `selected`. */
  stateWords?: SegmentStateWords;
  /**
   * Зона нажатия сегмента 44 pt вместо прежних 30 pt (HIG, WCAG 2.5.8), рамка фокуса читалки тоже 44 pt; вид полосы и её
   * место в раскладке те же. Действует только вместе с `onPress`: у полосы только для показа (без `onPress`) свойство
   * ничего не меняет, иначе невидимые отключённые элементы по 44 pt перехватывали бы касания того, что лежит под ними.
   *
   * Правило: сверху и снизу от такой полосы держите не меньше 19 pt свободного места. Зона заходит за полосу на
   * (44 - 6) / 2 = 19 pt, а в пересечении касание достаётся тому из соседей, кто нарисован позже: кнопка ближе 19 pt над
   * полосой теряла бы касания, а элемент ближе 19 pt под ней перекрывал бы часть полосы.
   */
  largeTarget?: boolean;
};

/** Полоса сегментов: по элементу на шаг. Вид и поведение прежние, пока не включены `stateWords` и `largeTarget`. */
type SegmentsBarProps = SegmentBarCommon & { variant?: "segments"; summaryLabel?: undefined };

/**
 * Цельная полоса для длинных тестов (92 утверждения: сегмент в 1 pt нельзя ни нажать, ни услышать 92 раза). Как
 * `<progress>` веба: читалка слышит один элемент с названием `summaryLabel` и долей; перехода по шагам нет, `onPress`,
 * `labels`, `stateWords` и `largeTarget` игнорируются. Название обязательно: без него читалка услышит безымянную полосу.
 */
type ContinuousBarProps = SegmentBarCommon & { variant: "continuous"; summaryLabel: string };

export type SegmentBarProps = SegmentsBarProps | ContinuousBarProps;

/** Полоса шагов (сегменты): готово / верно / неверно / текущий. Для длинных тестов - `variant="continuous"`. */
export function SegmentBar(props: SegmentBarProps) {
  const { states, onPress, testID, labels, stateWords, largeTarget = false } = props;
  const { tokens } = useTheme();
  if (props.variant === "continuous") {
    const total = states.length;
    const answered = answeredSegments(states);
    return (
      <View
        testID={testID}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={props.summaryLabel}
        accessibilityValue={{ min: 0, max: Math.max(total, 1), now: answered }}
        style={{ height: PROGRESS_HEIGHT, borderRadius: tokens.radiusChip, backgroundColor: tokens.line, overflow: "hidden" }}
      >
        <View style={{ height: PROGRESS_HEIGHT, width: `${total ? (answered / total) * 100 : 0}%`, borderRadius: tokens.radiusChip, backgroundColor: tokens.accent }} />
      </View>
    );
  }
  // Большая зона только у полосы с нажатиями: у полосы для показа она создала бы невидимые отключённые элементы по 44 pt,
  // которые перехватывают касания соседей.
  const large = largeTarget && onPress !== undefined;
  // Зона нажатия 44 pt: сам Pressable высотой 44, полоса по центру. Не `hitSlop`: он расширяет только место касания
  // пальцем (в RN 0.88 его читают лишь проверки попадания: Android `TouchTargetHelper`, iOS `hitTestEdgeInsets`), а
  // рамка фокуса читалки (VoiceOver, TalkBack) и цель Switch Control и Voice Control остаются размером самого элемента,
  // то есть 6 pt. Отрицательное поле возвращает строке прежние 6 pt в раскладке, экран не сдвигается; о соседях см. JSDoc
  // `largeTarget`.
  const reach = (MIN_TARGET - SEGMENT_HEIGHT) / 2;
  return (
    <View testID={testID} style={large ? { flexDirection: "row", gap: 3, marginVertical: -reach } : { flexDirection: "row", gap: 3 }}>
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
            hitSlop={large ? undefined : { top: 12, bottom: 12 }}
            style={large ? { flex: 1, minHeight: MIN_TARGET, justifyContent: "center" } : { flex: 1 }}
          >
            <View style={{ height: SEGMENT_HEIGHT, borderRadius: 3, backgroundColor: bg }} />
          </Pressable>
        );
      })}
    </View>
  );
}
