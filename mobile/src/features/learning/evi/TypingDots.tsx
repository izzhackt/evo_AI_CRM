// Три точки «Эви печатает»: в облачке переписки (8 pt) и во второй строке шапки (4 pt). Порт `.pt-evi-typing i` / `.pt-evi-dots i` и
// блока «Эви пишет ответ» в portal.css (исключение владельца 17.11.2026): точки есть на экране только пока идёт настоящий запрос, поэтому
// и бегут они только тогда, волной с шагом 150 мс (период 1,2 с: яркость 0,35 -> 1 -> 0,35 и подъём на 3 pt). При «уменьшить движение»
// точки стоят ступенями яркости 1, 0,6 и 0,3, «печатает» сказано словом (его читает строка рядом, сами точки для читалки скрыты).
import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { useReduceMotion } from "@/ui/useReduceMotion";

/** Яркость точек, когда они стоят (веб: `:nth-of-type(2) { opacity: 0.6 }`, `(3) { opacity: 0.3 }`). */
export const STILL_DOT_OPACITY = [1, 0.6, 0.3] as const;
/** Шаг волны между точками, мс. */
const WAVE_STEP_MS = 150;
const CYCLE_MS = 1200;
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);

export function TypingDots({ size = 8, gap = 6, tone = "text2", testID }: Readonly<{ size?: number; gap?: number; tone?: "text" | "text2"; testID?: string }>) {
  const { tokens } = useTheme();
  const reduceMotion = useReduceMotion();
  const [waves] = useState(() => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)] as const);
  useEffect(() => {
    if (reduceMotion) return;
    // Кадры CSS: 0 %, 60 %, 100 % - покой, 30 % - пик; задержка стоит один раз перед первым кругом.
    const runs = waves.map((wave, index) =>
      Animated.sequence([
        Animated.delay(index * WAVE_STEP_MS),
        Animated.loop(
          Animated.sequence([
            Animated.timing(wave, { toValue: 1, duration: CYCLE_MS * 0.3, easing: EASE_IN_OUT, useNativeDriver: true }),
            Animated.timing(wave, { toValue: 0, duration: CYCLE_MS * 0.3, easing: EASE_IN_OUT, useNativeDriver: true }),
            Animated.delay(CYCLE_MS * 0.4),
          ]),
        ),
      ]),
    );
    const all = Animated.parallel(runs);
    all.start();
    return () => {
      all.stop();
      for (const wave of waves) wave.setValue(0);
    };
  }, [reduceMotion, waves]);
  const styles = useMemo(
    () =>
      waves.map((wave) => ({
        opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
        transform: [{ translateY: wave.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
      })),
    [waves],
  );
  const color = tone === "text" ? tokens.text : tokens.text2;
  return (
    <View testID={testID ?? "evi-dots"} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "center", gap }}>
      {styles.map((style, index) => (
        <Animated.View
          key={index}
          style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, reduceMotion ? { opacity: STILL_DOT_OPACITY[index] } : style]}
        />
      ))}
    </View>
  );
}
