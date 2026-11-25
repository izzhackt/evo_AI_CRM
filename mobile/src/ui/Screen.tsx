import type { ReactNode, RefObject } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatFabClearance, useTabBarClearance } from "@/shell/useTabBarClearance";
import { useTheme } from "@/theme/ThemeProvider";

/** То, что экран просит у прокрутки (RN 0.88: тип ScrollView - компонент, не экземпляр). */
export type ScrollTarget = { scrollTo: (options: { y: number; animated?: boolean }) => void };

/** Страница: фон `--pt-bg`, боковое поле 16, прокрутка, учёт безопасных зон. */
export function Screen({
  children,
  bottomInset = 0,
  tabBar = false,
  chatFab = true,
  topInset = true,
  onRefresh,
  refreshing = false,
  scrollRef,
  stickyHeaderIndices,
  onScrollY,
}: {
  children: ReactNode;
  bottomInset?: number;
  /** Экран под плавающей панелью вкладок: запас снизу есть, только если панель показана. */
  tabBar?: boolean;
  /** Запас под плавающую кнопку «Написать EVO»; `false` на экранах, где её нет («Входящие»). */
  chatFab?: boolean;
  topInset?: boolean;
  /** Потянуть вниз, чтобы обновить (если задано). */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Для экранов, которые сами прокручивают к блоку (переход «Весь путь» на «Главной»). */
  scrollRef?: RefObject<ScrollTarget | null>;
  /**
   * Блоки списка (прямые дети `children`, считая сверху с нуля), которые закрепляются у верха экрана при прокрутке:
   * строка текущего шага на «Главной». Закреплённый блок держится, пока следующий закреплённый не дойдёт до верха.
   */
  stickyHeaderIndices?: readonly number[];
  /** Где сейчас верх окна в списке (пункты от начала содержимого): для экранов, которым важно, ниже ли экран какого-то блока. */
  onScrollY?: (y: number) => void;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const fabClearance = useChatFabClearance();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: tokens.bg }}>
      <ScrollView
        ref={scrollRef as RefObject<never> | undefined}
        testID="screen-scroll"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.text2} /> : undefined}
        stickyHeaderIndices={stickyHeaderIndices ? [...stickyHeaderIndices] : undefined}
        onScroll={onScrollY ? (event) => onScrollY(event.nativeEvent.contentOffset.y) : undefined}
        scrollEventThrottle={onScrollY ? 16 : undefined}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: topInset ? insets.top + 16 : 16, paddingBottom: Math.max(insets.bottom, 16) + bottomInset + (tabBar ? clearance + (chatFab ? fabClearance : 0) : 0) }}
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
