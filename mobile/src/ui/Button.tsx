import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger" | "dangerSolid";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
};

/** `.pt-btn` / `.pt-btn-ghost`: высота 44, радиус 8, вес 600. */
export function Button({ label, onPress, variant = "primary", busy = false, disabled = false, style, testID, accessibilityLabel }: Props) {
  const { tokens } = useTheme();
  const primary = variant === "primary";
  const solid = primary || variant === "dangerSolid";
  const danger = variant === "danger" || variant === "dangerSolid";
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: tokens.radiusControl,
          backgroundColor: primary ? tokens.accent : variant === "dangerSolid" ? tokens.error : tokens.surface,
          borderColor: primary ? tokens.accent : danger ? tokens.error : tokens.line,
          opacity: inactive ? 0.6 : 1,
          transform: [{ scale: pressed ? tokens.pressScale : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={solid ? tokens.onAccent : tokens.text} />
      ) : (
        <Text variant="body" tone={solid ? "onAccent" : variant === "danger" ? "error" : "text"} style={{ fontFamily: sansFont("semibold") }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
