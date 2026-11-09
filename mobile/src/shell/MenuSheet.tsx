import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang } from "@/i18n/LangProvider";
import { SECTION_ICONS } from "@/shell/icons";
import { menuFor, type SectionId } from "@/shell/sections";
import type { AccessTier } from "@/session/access";
import { menuTokensFor, useTheme } from "@/theme/ThemeProvider";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

type Props = { visible: boolean; tier: AccessTier; active: SectionId | null; onSelect: (id: SectionId) => void; onClose: () => void };

/** Меню ☰: левая тёмная колонка шириной min(300, 84%), заезжает за 240 мс, подложка 45 %. */
export function MenuSheet({ visible, tier, active, onSelect, onClose }: Props) {
  const { scheme } = useTheme();
  const t = menuTokensFor(scheme);
  const { shell, m } = useLang();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const sheetWidth = Math.min(300, width * 0.84);
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(slide, { toValue: visible ? 1 : 0, duration: t.motionSlow, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [visible, slide, t.motionSlow]);

  const groupLabel = (g: "choice" | "prep") => (g === "choice" ? shell["nav.groupChoice"] : shell["nav.groupPrep"]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <Animated.View
          style={{
            width: sheetWidth,
            backgroundColor: t.surface,
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 12),
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-sheetWidth, 0] }) }],
          }}
          testID="menu-sheet"
        >
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
            <EvoMark size={28} color="#ffffff" />
            <Text variant="heading" style={{ color: t.text, flex: 1 }}>
              EVO admissions
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={m("shell.menuClose")} onPress={onClose} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <X size={22} strokeWidth={1.75} color={t.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}>
            {menuFor(tier).map((block, index) => (
              <View key={`${block.group ?? "top"}-${index}`} style={{ marginTop: block.group || index > 0 ? 12 : 0 }}>
                {block.group ? (
                  <Text variant="caption" style={{ color: t.railGroup, paddingHorizontal: 12, paddingBottom: 4 }}>
                    {groupLabel(block.group)}
                  </Text>
                ) : null}
                {block.sections.map((section) => {
                  const Icon = SECTION_ICONS[section.icon];
                  const isActive = active === section.id;
                  return (
                    <Pressable
                      key={section.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      onPress={() => onSelect(section.id)}
                      testID={`menu-${section.id}`}
                      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: t.radiusControl, backgroundColor: isActive ? t.bg : "transparent" }}
                    >
                      {Icon ? <Icon size={20} strokeWidth={1.75} color={t.text} /> : null}
                      <Text variant="body" style={{ color: t.text }}>
                        {shell[section.navKey]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
        <Pressable accessibilityElementsHidden importantForAccessibility="no" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }} />
      </View>
    </Modal>
  );
}
