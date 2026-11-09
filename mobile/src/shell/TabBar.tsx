import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang } from "@/i18n/LangProvider";
import { SECTION_ICONS } from "@/shell/icons";
import { PHONE_TABS, SECTIONS } from "@/shell/sections";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Высота плавающей панели вместе с отступом; контент получает такой нижний запас. */
export const TAB_BAR_CLEARANCE = 96;

/** Плавающая панель: отступ 12, радиус 20, поверхность + линия + тень, вкладка >= 52. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { tokens, scheme } = useTheme();
  const { shell } = useLang();
  const insets = useSafeAreaInsets();
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
              onPress={() => {
                if (!focused) navigateToTab(route.key);
              }}
              testID={`tab-${section.id}`}
              style={{ flex: 1, minHeight: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: focused ? tokens.accentSoft : "transparent" }}
            >
              {Icon ? <Icon size={20} strokeWidth={1.75} color={color} /> : null}
              <Text variant="tab" style={{ color }} numberOfLines={1}>
                {shell[section.navKey]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
