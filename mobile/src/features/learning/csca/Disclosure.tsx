// Раскрывающийся блок (веб: `<details>` с `<summary>`): модули программы, «Темы без уроков», вопросы обзора. Заголовок
// это кнопка с состоянием «раскрыто» для читалки и шевроном, который переворачивается при открытии.
import { ChevronDown } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";

export function Disclosure({
  header,
  children,
  defaultOpen = false,
  minHeight = MIN_TARGET,
  headerStyle,
  testID,
  headerTestID,
  accessibilityLabel,
}: {
  /** Содержимое заголовка; шеврон ставится справа. */
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  minHeight?: number;
  headerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  headerTestID?: string;
  /** Что читает читалка вместо собранного из заголовка текста. */
  accessibilityLabel?: string;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        testID={headerTestID}
        style={[{ minHeight, flexDirection: "row", alignItems: "center", gap: 12 }, headerStyle]}
      >
        <View style={{ flex: 1 }}>{header}</View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} />
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}
