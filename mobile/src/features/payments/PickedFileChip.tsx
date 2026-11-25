// Выбранный файл чека: значок (картинка или документ), имя и «Убрать файл» (веб: `.pt-pay-picked`, `.pt-pay-clear`).
import { FileText, Image as ImageIcon, X } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function PickedFileChip({ name, onClear, disabled = false, testID }: { name: string; onClear: () => void; disabled?: boolean; testID: string }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const strings = t("admission");
  const Icon = /\.(png|jpe?g)$/i.test(name) ? ImageIcon : FileText;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={16} strokeWidth={1.75} color={tokens.text2} />
      </View>
      <Text variant="secondary" style={{ flexShrink: 1 }} testID={`${testID}-name`}>
        {name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.receiptClearFile}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onClear}
        hitSlop={4}
        testID={`${testID}-clear`}
        style={{ minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.6 : 1 }}
      >
        <X size={16} strokeWidth={1.75} color={tokens.text2} />
      </Pressable>
    </View>
  );
}
