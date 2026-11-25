// Страница прохождения теста: то же, что `StackPage` («Учёба»: шапка и прокрутка с теми же отступами), но прокрутку можно
// вернуть наверх. Веб после «Далее» переводит фокус на заголовок страницы и прокручивает к нему; на телефоне страница из
// четырёх утверждений выше экрана, и без этого следующая страница открылась бы с середины. Свой компонент, а не правка
// `StackPage`: общий файл `features/learning/ui.tsx` ведёт Волна 0, и параллельные срезы его не правят.
import type { ReactNode, RefObject } from "react";
import { ScrollView, View } from "react-native";

import { useStackPageBottom } from "@/features/learning/ui";
import { useTheme } from "@/theme/ThemeProvider";
import type { ScrollTarget } from "@/ui/Screen";

export function RunnerPage({ children, header, scrollRef, testID }: { children: ReactNode; header: ReactNode; scrollRef?: RefObject<ScrollTarget | null>; testID?: string }) {
  const { tokens } = useTheme();
  // Тот же запас под панель и кнопку «Написать EVO», что у `StackPage`: «Продолжить» и «Далее» внизу страницы не прячутся под панелью.
  const bottom = useStackPageBottom();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }} testID={testID}>
      {header}
      <ScrollView ref={scrollRef as RefObject<never> | undefined} testID={testID ? `${testID}-scroll` : undefined} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottom }}>
        {children}
      </ScrollView>
    </View>
  );
}
