// Тонкие полосы доли (веб: `.cs-meter` и `.cs-pace`): заполнение цветом текста на линии, для читалки скрыты, потому что то же
// сказано словами рядом.
import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

const clamp01 = (ratio: number) => Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));

/** Доля от нуля до единицы. */
export function Meter({ ratio, testID }: { ratio: number; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 6, borderRadius: tokens.radiusChip, backgroundColor: tokens.line, overflow: "hidden" }}>
      <View style={{ width: `${Math.round(clamp01(ratio) * 100)}%`, height: 6, backgroundColor: tokens.text }} />
    </View>
  );
}

/** Темп: заполнение и красная метка ориентира экзамена посередине полосы (правее метки медленнее ориентира). */
export function PaceMeter({ ratio, testID }: { ratio: number; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 6, borderRadius: tokens.radiusChip, backgroundColor: tokens.line }}>
      <View style={{ width: `${Math.round(clamp01(ratio) * 100)}%`, height: 6, borderRadius: tokens.radiusChip, backgroundColor: tokens.text }} />
      <View style={{ position: "absolute", top: -4, bottom: -4, left: "50%", width: 2, borderRadius: 1, backgroundColor: tokens.accent }} />
    </View>
  );
}
