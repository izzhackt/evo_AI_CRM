// Страница урока: то же, что `StackPage` («Учёба»: шапка и прокрутка с теми же отступами), но прокрутку можно вернуть наверх.
// Веб после «Начать урок», «Далее» и «Завершить» переводит фокус на заголовок и прокручивает к нему; на телефоне упражнение с
// текстом для чтения выше экрана, и без этого следующее открылось бы с середины. Свой компонент, а не правка `StackPage`:
// общий файл `features/learning/ui.tsx` ведёт Волна 0, и параллельные срезы его не правят.
import type { ReactNode, RefObject } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatFabClearance, useTabBarClearance } from "@/shell/useTabBarClearance";
import { useTheme } from "@/theme/ThemeProvider";
import type { ScrollTarget } from "@/ui/Screen";

/**
 * Нижний запас такой же, как у `Screen`: безопасная зона плюс высота плавающей панели вкладок плюс место под кнопку «Написать EVO»
 * (те же хуки, а не число). Без этого последняя кнопка урока в конце прокрутки оказывалась наполовину под панелью.
 */
export function useLessonPageBottomPadding(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, 16) + useTabBarClearance() + useChatFabClearance();
}

export function LessonPage({ children, header, scrollRef, testID }: { children: ReactNode; header: ReactNode; scrollRef?: RefObject<ScrollTarget | null>; testID?: string }) {
  const { tokens } = useTheme();
  const paddingBottom = useLessonPageBottomPadding();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      {header}
      <ScrollView ref={scrollRef as RefObject<never> | undefined} testID={testID ? `${testID}-scroll` : undefined} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom }}>
        {children}
      </ScrollView>
    </View>
  );
}
