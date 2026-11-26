// Раскрывающаяся строка результата теста: `<details>` сайта (`.pt-res-details`, `.pt-res-more`). Заголовок со стрелкой и целью
// нажатия 44 pt, под ним содержимое; читалка слышит «развёрнуто/свёрнуто» (`expanded`). Вид `card` - рамка и тень карточки
// (разбор задания, профессия, ограничения), вид `link` - строка-ссылка акцентным цветом («Посмотреть остальные направления»).
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function Disclosure({ title, children, variant = "card", testID }: { title: string; children: ReactNode; variant?: "card" | "link"; testID?: string }) {
  const { tokens, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronUp : ChevronDown;
  const link = variant === "link";
  return (
    <View
      testID={testID}
      style={link ? { gap: 12 } : { paddingHorizontal: 16, paddingVertical: 4, backgroundColor: tokens.surface, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        testID={testID ? `${testID}-toggle` : undefined}
        style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", justifyContent: link ? "flex-start" : "space-between", gap: 8 }}
      >
        <Text variant={link ? "secondary" : "body"} bold tone={link ? "accent" : "text"} style={link ? { textDecorationLine: "underline" } : { flex: 1 }}>
          {title}
        </Text>
        <Icon size={18} strokeWidth={1.75} color={link ? tokens.accent : tokens.text2} />
      </Pressable>
      {open ? <View style={{ gap: 12, paddingBottom: link ? 0 : 16 }}>{children}</View> : null}
    </View>
  );
}
