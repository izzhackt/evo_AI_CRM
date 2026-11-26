// Страница прохождения теста: то же, что `StackPage` («Учёба»: шапка и прокрутка с теми же отступами), но прокрутку можно
// вернуть наверх. Веб после «Далее» переводит фокус на заголовок страницы и прокручивает к нему; на телефоне страница из
// четырёх утверждений выше экрана, и без этого следующая страница открылась бы с середины. Где сейчас прокручена страница,
// сообщает `onScrollY` (как у `StackPage`): раннеру нужно знать, видит ли студент блок сбоя (`features/learning/page-reveal.ts`).
import type { ReactNode, RefObject } from "react";
import { ScrollView, View } from "react-native";

import { useStackPageBottom } from "@/features/learning/ui";
import { useTheme } from "@/theme/ThemeProvider";
import type { ScrollTarget } from "@/ui/Screen";

export function RunnerPage({ children, header, scrollRef, onScrollY, testID }: { children: ReactNode; header: ReactNode; scrollRef?: RefObject<ScrollTarget | null>; onScrollY?: (y: number) => void; testID?: string }) {
  const { tokens } = useTheme();
  // Тот же запас под панель и кнопку «Написать EVO», что у `StackPage`: «Продолжить» и «Далее» внизу страницы не прячутся под панелью.
  const bottom = useStackPageBottom();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      {header}
      <ScrollView
        ref={scrollRef as RefObject<never> | undefined}
        testID={testID ? `${testID}-scroll` : undefined}
        onScroll={onScrollY ? (event) => onScrollY(event.nativeEvent.contentOffset.y) : undefined}
        scrollEventThrottle={onScrollY ? 16 : undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottom }}
      >
        {children}
      </ScrollView>
    </View>
  );
}
