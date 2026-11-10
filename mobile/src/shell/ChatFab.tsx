import { usePathname } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalApi } from "@/api/PortalApi";
import { go, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { CHAT_FAB_SIZE, chatFabBottom, chatFabVisible } from "@/shell/chat-fab-rules";
import { useTheme } from "@/theme/ThemeProvider";

/** Круглая кнопка «Написать EVO» в правом нижнем углу любого экрана кабинета (веб `.pt-chat-fab`): открывает беседу. */
export function ChatFab() {
  const { tier } = usePortalApi();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { tokens, scheme } = useTheme();
  const { t } = useLang();
  if (!chatFabVisible(tier, pathname)) return null;
  const label = t("home").writeAction;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: Math.max(insets.right, 16), bottom: chatFabBottom(tier, insets.bottom) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => go(WRITE_EVO_ROUTE)}
        testID="chat-fab"
        hitSlop={4}
        style={{
          width: CHAT_FAB_SIZE,
          height: CHAT_FAB_SIZE,
          borderRadius: CHAT_FAB_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.accent,
          boxShadow: scheme === "dark" ? undefined : tokens.shadowRaised,
        }}
      >
        <MessageCircle size={24} strokeWidth={1.75} color={tokens.onAccent} />
      </Pressable>
    </View>
  );
}
