// Значок `.cs-chip` веба: тонкая рамка, тон бумаги, строка не рвётся. `on` - рамка цвета текста («Моя сессия»).
import { View } from "react-native";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export function MetaChip({ label, on = false, testID }: { label: string; on?: boolean; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} style={{ alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 2, borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: on ? tokens.text : tokens.line, backgroundColor: tokens.bg }}>
      <Text variant="caption" style={{ fontFamily: sansFont("medium") }}>
        {label}
      </Text>
    </View>
  );
}
