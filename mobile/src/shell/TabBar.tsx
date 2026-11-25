import { usePathname } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePortalUnread } from "@/api/PortalPoll";
import { usePortalApi } from "@/api/PortalApi";
import { useLang } from "@/i18n/LangProvider";
import { SECTION_ICONS } from "@/shell/icons";
import { isConversationPath } from "@/shell/chat-fab-rules";
import { PHONE_TABS, SECTIONS, hasTabBar } from "@/shell/sections";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export { TAB_BAR_CLEARANCE } from "@/shell/useTabBarClearance";

/** Плавающая панель: отступ 12, радиус 20, поверхность + линия + тень, вкладка >= 52. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { tokens, scheme } = useTheme();
  const { shell, format } = useLang();
  const insets = useSafeAreaInsets();
  const unread = usePortalUnread();
  const pathname = usePathname();
  const { tier } = usePortalApi();
  // В беседе (с командой и с Эви) панель убрана: поле ввода и клавиатура получают весь низ экрана.
  if (isConversationPath(pathname)) return null;
  // Одна вкладка (approved) - не панель: остаётся шапка с ☰ (веб Shell.tsx, `tabSections.length > 1`).
  if (!hasTabBar(tier)) return null;
  const visible = state.routes.filter((r) => (PHONE_TABS as readonly string[]).includes(r.name));
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }}
    >
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          backgroundColor: tokens.surface,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: tokens.line,
          padding: 4,
          boxShadow: scheme === "dark" ? undefined : tokens.shadowRaised,
        }}
      >
        {visible.map((route) => {
          const section = SECTIONS.find((s) => s.id === route.name);
          if (!section) return null;
          const focused = state.routes[state.index]?.key === route.key;
          const Icon = SECTION_ICONS[section.icon];
          const color = focused ? tokens.accent : tokens.text2;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              // Имя вкладки со словами, а не голой цифрой (веб: «Входящие» и скрытое «Новых уведомлений: N» в одной ссылке).
              accessibilityLabel={section.id === "messages" && unread ? `${shell[section.navKey]}, ${format(shell.notificationsUnread, { count: String(unread) })}` : undefined}
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}
              testID={`tab-${section.id}`}
              // Открытая вкладка: красные значок и слово, без плашки (веб, телефон: `.pt-nav-link[aria-current]` без фона и планки).
              style={{ flex: 1, minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <View>
                {Icon ? <Icon size={20} strokeWidth={1.75} color={color} /> : null}
                {section.id === "messages" && unread ? (
                  <View testID="tab-messages-badge" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", top: -6, right: -12, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center" }}>
                    <Text variant="caption" tone="onAccent" bold style={{ fontSize: 11, lineHeight: 14 }}>
                      {unread > 99 ? "99+" : unread}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="tab" bold={focused} style={{ color }} numberOfLines={1}>
                {shell[section.navKey]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
