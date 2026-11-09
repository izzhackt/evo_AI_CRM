import { View } from "react-native";

import type { PortalTone } from "@/domain/documents-model";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Плашка статуса (`.pt-status`): слово несёт смысл, цвет только подкрепляет. */
export function StatusPill({ label, tone, testID }: { label: string; tone: PortalTone; testID?: string }) {
  const { tokens } = useTheme();
  const color = tone === "ok" ? tokens.ok : tone === "warn" ? tokens.warn : tone === "danger" ? tokens.error : tone === "info" ? tokens.accent : tokens.text2;
  return (
    <View testID={testID} style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: color }}>
      <Text variant="caption" bold style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
