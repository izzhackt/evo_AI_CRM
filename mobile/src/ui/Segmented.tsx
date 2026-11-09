import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Option<T extends string> = { value: T; label: string };

/** Переключатель из 2-3 вариантов (`.pt-pill-tab`: высота 44, активный на поверхности). */
export function Segmented<T extends string>({ value, options, onChange, testIDPrefix }: { value: T; options: readonly Option<T>[]; onChange: (v: T) => void; testIDPrefix?: string }) {
  const { tokens, scheme } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: tokens.skeleton, borderRadius: tokens.radiusChip, padding: 3 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
            style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: tokens.radiusChip, backgroundColor: active ? tokens.surface : "transparent", boxShadow: active && scheme === "light" ? tokens.shadowCard : undefined }}
          >
            <Text variant="secondary" bold={active} tone={active ? "text" : "text2"}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
