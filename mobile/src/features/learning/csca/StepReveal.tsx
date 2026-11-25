// Разбор по шагам (контракт §13, `example`, и разбор задания §6; веб: components/portal/csca/StepReveal.tsx). Сначала не
// показан ни один шаг: «Следующий шаг» открывает следующую строку, «Показать решение» все сразу, а ответ примера появляется
// только после последнего шага (иначе он выдал бы решение до попытки подумать). Новый шаг озвучивается читалке словами «Шаг N»
// и текстом шага (при «Показать решение» все открытые шаги одной фразой): перевод фокуса читалки на устройствах ведёт себя
// по-разному, а слово до студента доходит везде.
import { useState } from "react";
import { Pressable, View } from "react-native";

import { tint } from "@/features/learning/csca/tint";
import { MathText } from "@/features/learning/math/MathText";
import { speakMathText } from "@/features/learning/math/speak";
import { useLang } from "@/i18n/LangProvider";
import { monoFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function StepReveal({ steps, answer, answerLabel, testID }: { steps: readonly string[]; answer?: string; answerLabel?: string; testID?: string }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const [shown, setShown] = useState(0);
  const done = shown >= steps.length;

  /** Открыть шаги до `next` и прочитать читалке все вновь открытые: «Показать решение» открывает сразу несколько. */
  function reveal(next: number) {
    const first = shown;
    const upto = Math.min(next, steps.length);
    setShown(upto);
    const spoken = steps.slice(first, upto).map((text, offset) => `${format(c.exampleStep, { n: String(first + offset + 1) })}. ${speakMathText(text)}`);
    if (spoken.length > 0) announce(spoken.join(" "));
  }

  return (
    <View style={{ gap: 12 }} testID={testID}>
      {steps.slice(0, shown).map((step, index) => (
        <View key={index} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }} testID={testID ? `${testID}-step-${index + 1}` : undefined}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: tokens.controlEdge, alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="caption" tone="text2" bold style={{ fontFamily: monoFont("bold"), fontSize: 12 }}>
              {index + 1}
            </Text>
          </View>
          <View style={{ flex: 1, paddingTop: 2 }} accessible accessibilityLabel={`${format(c.exampleStep, { n: String(index + 1) })}. ${speakMathText(step)}`}>
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <MathText source={step} variant="secondary" />
            </View>
          </View>
        </View>
      ))}
      {done && answer ? (
        <View style={{ gap: 2, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tint(tokens.ok, 9) }} testID={testID ? `${testID}-answer` : undefined}>
          <Text variant="caption" bold tone="ok">
            {answerLabel ?? c.answerLabel}
          </Text>
          <MathText source={answer} />
        </View>
      ) : null}
      {!done ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 4 }}>
          <Button variant="ghost" label={c.nextSolutionStep} onPress={() => reveal(shown + 1)} testID={testID ? `${testID}-next` : undefined} />
          <Pressable accessibilityRole="button" onPress={() => reveal(steps.length)} testID={testID ? `${testID}-all` : undefined} style={{ minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 4 }}>
            <Text variant="secondary" style={{ textDecorationLine: "underline", textDecorationColor: tokens.controlEdge }}>
              {c.showSolution}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
