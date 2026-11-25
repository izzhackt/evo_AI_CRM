// Круглый значок перед подписью кнопки «Пример» (веб: `.pt-doc-guide-btn-mark` + GuideMarkIcon): бледно-красный круг 24 px
// с красным знаком. Решение 20.11.2026: серый «!» 16 px не замечали, значок рядом с подписью заметен. Для читалки скрыт,
// кнопку называет подпись.
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { useTheme } from "@/theme/ThemeProvider";

export function GuideMark() {
  const { tokens } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center" }}>
      <Svg width={14} height={14} viewBox="0 0 16 16" fill="none">
        <Path d="M8 3.6v5.3" stroke={tokens.accent} strokeWidth={2.1} strokeLinecap="round" />
        <Circle cx="8" cy="12.2" r="1.25" fill={tokens.accent} />
      </Svg>
    </View>
  );
}
