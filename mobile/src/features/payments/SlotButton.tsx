// Три кнопки страницы «Оплата» (веб: portal.css `.pt-btn`, `.pt-pay-slot`, `.pt-pay-textbtn`):
//  - «primary»: «+ Добавить платёж» в шапке (красная, со значком «+»);
//  - «dashed»: «+ Приложить чек» на строке (пунктирная рамка, значок «+»);
//  - «text»: «Заменить» у отклонённого чека (акцентный подчёркнутый текст).
// Цель нажатия 44 pt у всех. `expanded` - у кнопки, которая раскрывает форму (читалка скажет «свёрнуто/развёрнуто»).
import { Plus } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type SlotLook = "primary" | "dashed" | "text";

export function SlotButton({
  label,
  look,
  onPress,
  disabled = false,
  expanded,
  accessibilityLabel,
  testID,
}: {
  label: string;
  look: SlotLook;
  onPress: () => void;
  disabled?: boolean;
  expanded?: boolean;
  /** Полное имя для читалки (с датой и суммой строки); без него читается `label`. */
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const primary = look === "primary";
  const text = look === "text";
  const ink = primary ? tokens.onAccent : text ? tokens.accent : tokens.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: MIN_TARGET,
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.6 : 1,
          transform: [{ scale: pressed && !text ? tokens.pressScale : 1 }],
        },
        text
          ? null
          : {
              paddingHorizontal: primary ? 16 : 12,
              borderRadius: tokens.radiusControl,
              borderWidth: 1,
              borderStyle: primary ? "solid" : "dashed",
              borderColor: primary ? tokens.accent : tokens.controlEdge,
              backgroundColor: primary ? tokens.accent : tokens.surface,
            },
      ]}
    >
      {text ? null : (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Plus size={14} strokeWidth={2} color={ink} />
        </View>
      )}
      <Text variant="body" style={{ color: ink, fontFamily: sansFont("semibold"), textDecorationLine: text ? "underline" : "none" }}>
        {label}
      </Text>
    </Pressable>
  );
}
