import { Menu } from "lucide-react-native";
import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { go } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";
import { TopBarActions } from "@/shell/TopBarActions";
import { useTheme } from "@/theme/ThemeProvider";

// Лого веба (`public/brand/evo-logo.png` и `evo-logo-on-dark.png`, 1843 x 842): полный знак с подписью, 88 pt шириной, как в
// полосе телефона. В тёмной теме - тот же файл с белыми буквами и тем же красным знаком (EvoLogo `onDark`), без плашки.
const LOGO = require("../../assets/images/evo-logo.png");
const LOGO_ON_DARK = require("../../assets/images/evo-logo-on-dark.png");
const LOGO_WIDTH = 88;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 842) / 1843);

/** Верх телефона: ☰, лого-ссылка на «Главную», справа колокольчик; фон страницы, без рамки (высота - общая мера `TOP_BAR_HEIGHT`). */
export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { tokens, scheme } = useTheme();
  const { shell } = useLang();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: tokens.bg }}>
      <View testID="topbar-row" style={{ height: TOP_BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 4 }}>
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
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={shell.home}
          onPress={() => go("/home")}
          hitSlop={4}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}
          testID="topbar-logo"
        >
          <Image source={scheme === "dark" ? LOGO_ON_DARK : LOGO} style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} resizeMode="contain" accessibilityIgnoresInvertColors testID="topbar-logo-image" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <TopBarActions />
      </View>
    </View>
  );
}
