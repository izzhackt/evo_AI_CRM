import { Menu } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

/** Верх телефона: ☰, знак и подпись, фон страницы, без рамки (высота 52). */
export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { tokens } = useTheme();
  const { shell } = useLang();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: tokens.bg }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shell["nav.menu"]}
          onPress={onMenu}
          hitSlop={4}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          testID="menu-button"
        >
          <Menu size={24} strokeWidth={1.75} color={tokens.text} />
        </Pressable>
        <EvoMark size={26} color={tokens.brandRed} />
        <Text variant="body" bold>
          EVO admissions
        </Text>
      </View>
    </View>
  );
}
