// Одно задание или утверждение теста: формулировка («N. » перед утверждением orvis92, как веб `AssessmentQuestion.tsx`),
// текст для чтения (английский) и варианты ответа. Сохранение и страницы - забота раннера. Содержание приходит
// от сервера со своей локалью: английские задания читаются диктором как английские, русские утверждения как русские.
import { Pressable, View } from "react-native";

import type { AssessmentQuestion, StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function AssessmentQuestionView({ question, instrumentKey, answer, number, disabled = false, onSelect }: { question: AssessmentQuestion; instrumentKey: StudentAssessmentKey; answer: string | undefined; number: number; disabled?: boolean; onSelect: (questionId: string, optionId: string) => void }) {
  const { tokens } = useTheme();
  const english = instrumentKey === "english36";
  return (
    <View style={{ gap: 10 }} testID={`assessment-question-${question.id}`}>
      <Text variant="body" bold accessibilityLanguage={english ? "en" : "ru"} testID={`assessment-prompt-${question.id}`}>
        {instrumentKey === "orvis92" ? `${number}. ` : ""}
        {question.prompt}
      </Text>
      {question.passage ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: tokens.line, paddingLeft: 12 }}>
          <Text variant="secondary" accessibilityLanguage="en">
            {question.passage}
          </Text>
        </View>
      ) : null}
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {question.options.map((option) => {
          const on = answer === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled }}
              // Веб: у английских вариантов lang="en", кроме «Не знаю» (русское слово среди английских вариантов).
              accessibilityLanguage={english && option.id !== "unknown" ? "en" : "ru"}
              disabled={disabled}
              onPress={() => onSelect(question.id, option.id)}
              testID={`assessment-option-${question.id}-${option.id}`}
              style={{ minHeight: MIN_TARGET + 4, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: tokens.radiusItem, borderWidth: on ? 2 : 1, borderColor: on ? tokens.accent : tokens.line, backgroundColor: tokens.surface }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? tokens.accent : tokens.controlEdge, alignItems: "center", justifyContent: "center" }}>
                {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tokens.accent }} /> : null}
              </View>
              <Text variant="body" style={{ flex: 1 }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
