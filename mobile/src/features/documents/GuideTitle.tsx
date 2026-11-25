// Заголовок раздела в листе «Пример» («ПРИМЕР», «ПРИМЕРЫ», «КАКИМ ДОЛЖНО БЫТЬ ФОТО»): мелкий, серый, прописными с разрядкой,
// как у веба (`.pt-doc-guide-sample-head h3`: caption, 700, letter-spacing .06em, uppercase). Читалке - заголовок раздела.
import type { StyleProp, TextStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export function GuideTitle({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const { tokens } = useTheme();
  return (
    <Text variant="caption" tone="text2" bold accessibilityRole="header" style={[{ textTransform: "uppercase", letterSpacing: 0.06 * tokens.sizeCaption }, style]}>
      {children}
    </Text>
  );
}
