// Раскрывающийся блок (веб: `<details>`): заголовок-кнопка с состоянием «раскрыто» для читалки.
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function Collapsible({ title, children, initiallyOpen = false, onToggle, testID }: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  /** Сообщает новое состояние (веб: `onToggle` у `details`, история читается при первом раскрытии). */
  onToggle?: (open: boolean) => void;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View testID={testID} style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          const next = !open;
          setOpen(next);
          onToggle?.(next);
        }}
        testID={testID ? `${testID}-toggle` : undefined}
        style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Chevron size={18} strokeWidth={1.75} color={tokens.text2} />
        <Text variant="body" bold style={{ flex: 1 }}>
          {title}
        </Text>
      </Pressable>
      {open ? <View style={{ gap: 12, paddingLeft: 4 }}>{children}</View> : null}
    </View>
  );
}
