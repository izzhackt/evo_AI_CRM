import { useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Props = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  label: string;
  secure?: boolean;
  showLabel?: string;
  hideLabel?: string;
  hint?: string;
};

/** Поле: граница `--pt-control-edge`, радиус 8, высота 44+. */
export function TextField({ label, secure = false, showLabel = "", hideLabel = "", hint, ...input }: Props) {
  const { tokens } = useTheme();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="secondary" tone="text2" bold>
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 48,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? tokens.accent : tokens.controlEdge,
          borderRadius: tokens.radiusControl,
          backgroundColor: tokens.surface,
          paddingHorizontal: 12,
        }}
      >
        <TextInput
          {...input}
          accessibilityLabel={label}
          accessibilityHint={hint}
          secureTextEntry={secure && !visible}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={{ flex: 1, minHeight: 44, fontFamily: sansFont(), fontSize: tokens.sizeBody, color: tokens.text }}
          placeholderTextColor={tokens.text2}
        />
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? hideLabel : showLabel} onPress={() => setVisible((v) => !v)} hitSlop={8} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 8 }}>
            <Text variant="secondary" tone="accent" bold>
              {visible ? "••" : "Aa"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text variant="caption" tone="text2">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
