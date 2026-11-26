// Полоса заданий урока как на сайте (`.pt-ex-meter`): отрезок на задание высотой 6 с просветом 4, верные зелёные, ошибки красные,
// текущее цвета текста (не акцентного красного: красный здесь означал бы ошибку), остальные цвета линии. Для читалки полоса
// скрыта (у веба `aria-hidden`): позицию называет счётчик над ней. Общая `SegmentBar` рисует текущий шаг акцентом, поэтому своя.
import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

export type MeterState = "ok" | "bad" | "current" | "todo";

export function ExerciseMeter({ states, testID }: { states: readonly MeterState[]; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID} style={{ flexDirection: "row", gap: 4 }}>
      {states.map((state, i) => (
        <View
          key={i}
          testID={testID ? `${testID}-${i}` : undefined}
          style={{ flex: 1, height: 6, borderRadius: tokens.radiusChip, backgroundColor: state === "ok" ? tokens.ok : state === "bad" ? tokens.error : state === "current" ? tokens.text : tokens.line }}
        />
      ))}
    </View>
  );
}
