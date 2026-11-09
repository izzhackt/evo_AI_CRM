// Формы четырёх типов заданий английского и панель разбора (порт components/portal/english/exercises.tsx).
// Английские формулировки это учебное содержание (язык en для диктора), подписи интерфейса RU/KY.
import { Pressable, TextInput, View } from "react-native";

import type { LearningExercise, LearningExplain, LearningOption, LearningVerdict } from "@web/lib/portal/learning";

import { exercisePrompt, optionLabel, type ExerciseValue } from "@/features/learning/english/exercise-value";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

function Options({ options, selected, disabled, onSelect, testID }: { options: readonly LearningOption[]; selected: string | null; disabled: boolean; onSelect: (id: string) => void; testID?: string }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
      {options.map((option) => {
        const on = selected === option.id;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled }}
            accessibilityLanguage={option.label ? "en" : undefined}
            disabled={disabled}
            onPress={() => onSelect(option.id)}
            testID={testID ? `${testID}-${option.id}` : undefined}
            style={{ minHeight: MIN_TARGET + 4, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: tokens.radiusItem, borderWidth: on ? 2 : 1, borderColor: on ? tokens.accent : tokens.line, backgroundColor: tokens.surface }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? tokens.accent : tokens.controlEdge, alignItems: "center", justifyContent: "center" }}>
              {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tokens.accent }} /> : null}
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              {optionLabel(option, lang)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExerciseForm({ exercise, value, disabled, onChange }: { exercise: LearningExercise; value: ExerciseValue; disabled: boolean; onChange: (value: ExerciseValue) => void }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const e = t("english");
  const prompt = exercisePrompt(exercise, lang);
  if (exercise.type === "choice" && value.kind === "choice") {
    return (
      <View style={{ gap: 10 }}>
        {prompt ? (
          <Text variant="body" bold accessibilityLanguage={exercise.promptEn ? "en" : undefined} testID="exercise-prompt">
            {prompt}
          </Text>
        ) : null}
        <Options options={exercise.options ?? []} selected={value.selected} disabled={disabled} onSelect={(id) => onChange({ kind: "choice", selected: id })} testID="opt" />
      </View>
    );
  }
  if (exercise.type === "matching" && value.kind === "matching") {
    const instruction = lang === "ky" ? exercise.instructionKy : exercise.instructionRu;
    const rights = exercise.rights ?? [];
    return (
      <View style={{ gap: 10 }}>
        {instruction ? (
          <Text variant="body" bold>
            {instruction}
          </Text>
        ) : null}
        <Text variant="caption" tone="text2">
          {e.matchingHint}
        </Text>
        {(exercise.lefts ?? []).map((left, index) => {
          const used = new Set(value.matches.filter((m, i) => m !== null && i !== index));
          return (
            <View key={left} style={{ gap: 6 }} testID={`match-${index}`}>
              <Text variant="body" bold accessibilityLanguage="en">
                {left}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {rights.map((right, rightIndex) => {
                  const on = value.matches[index] === rightIndex;
                  const blocked = used.has(rightIndex);
                  return (
                    <Pressable
                      key={`${right.rightRu}-${rightIndex}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled: disabled || blocked }}
                      accessibilityLabel={`${e.matchingPairLabel.replace("{left}", left)}: ${lang === "ky" ? right.rightKy : right.rightRu}`}
                      disabled={disabled || blocked}
                      onPress={() => {
                        const next = [...value.matches];
                        next[index] = on ? null : rightIndex;
                        onChange({ kind: "matching", matches: next });
                      }}
                      testID={`match-${index}-${rightIndex}`}
                      style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderRadius: tokens.radiusChip, borderWidth: on ? 2 : 1, borderColor: on ? tokens.accent : tokens.line, backgroundColor: on ? tokens.accentSoft : tokens.surface, opacity: blocked ? 0.4 : 1 }}
                    >
                      <Text variant="secondary" bold={on}>
                        {lang === "ky" ? right.rightKy : right.rightRu}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  }
  if (exercise.type === "short_answer" && value.kind === "short_answer") {
    return (
      <View style={{ gap: 10 }}>
        {prompt ? (
          <Text variant="body" bold accessibilityLanguage={exercise.promptEn ? "en" : undefined}>
            {prompt}
          </Text>
        ) : null}
        <Text variant="secondary" tone="text2" bold>
          {e.shortAnswerLabel}
        </Text>
        <TextInput
          accessibilityLabel={e.shortAnswerLabel}
          accessibilityLanguage="en"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          maxLength={300}
          editable={!disabled}
          value={value.text}
          onChangeText={(text) => onChange({ kind: "short_answer", text })}
          testID="short-answer"
          style={{ minHeight: 48, borderWidth: 1, borderColor: tokens.controlEdge, borderRadius: tokens.radiusControl, backgroundColor: tokens.surface, paddingHorizontal: 12, fontFamily: sansFont(), fontSize: tokens.sizeBody, color: tokens.text }}
        />
        <Text variant="caption" tone="text2">
          {e.shortAnswerHint}
        </Text>
      </View>
    );
  }
  if (exercise.type === "reading" && value.kind === "reading") {
    return (
      <View style={{ gap: 12 }}>
        <Text variant="secondary" bold>
          {e.readingPassageHeading}
        </Text>
        <View style={{ borderLeftWidth: 3, borderLeftColor: tokens.line, paddingLeft: 12 }}>
          <Text variant="body" accessibilityLanguage="en">
            {exercise.passageEn}
          </Text>
        </View>
        {(exercise.questions ?? []).map((question, qi) => (
          <View key={question.id} style={{ gap: 8 }}>
            <Text variant="body" bold accessibilityLanguage="en">
              {qi + 1}. {question.promptEn}
            </Text>
            <Options options={question.options} selected={value.selected[question.id] ?? null} disabled={disabled} onSelect={(id) => onChange({ kind: "reading", selected: { ...value.selected, [question.id]: id } })} testID={`q${qi}`} />
          </View>
        ))}
      </View>
    );
  }
  return null;
}

/** Разбор отвеченного задания: вердикт, верный ответ и объяснения (приходят только после ответа). */
export function ExplainPanel({ exercise, verdict, explain, answer }: { exercise: LearningExercise; verdict: LearningVerdict; explain: LearningExplain; answer?: unknown }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const e = t("english");
  const text = (entry: { explainRu: string; explainKy: string }) => (lang === "ky" ? entry.explainKy : entry.explainRu);
  let body: React.ReactNode = null;
  if (exercise.type === "choice" && explain.options) {
    const selected = answer && typeof answer === "object" && "selected" in answer ? String((answer as { selected: unknown }).selected) : null;
    const correct = (exercise.options ?? []).find((o) => o.id === explain.correctOptionId);
    body = (
      <View style={{ gap: 6 }}>
        {!verdict.correct && correct ? (
          <Text variant="secondary">
            {e.correctAnswerLabel}:{" "}
            <Text variant="secondary" bold accessibilityLanguage="en">
              {optionLabel(correct, lang)}
            </Text>
          </Text>
        ) : null}
        {explain.options.filter((o) => o.id === explain.correctOptionId || o.id === selected).map((o) => (
          <Text key={o.id} variant="secondary" tone="text2">
            {text(o)}
          </Text>
        ))}
      </View>
    );
  } else if (exercise.type === "matching" && explain.pairs) {
    body = (
      <View style={{ gap: 4 }}>
        {explain.pairs.map((pair, i) => (
          <Text key={pair.leftEn} variant="secondary" tone={verdict.perPair?.[i] === false ? "error" : "text"}>
            <Text variant="secondary" accessibilityLanguage="en">
              {pair.leftEn}
            </Text>
            {" — "}
            {lang === "ky" ? pair.rightKy : pair.rightRu}
          </Text>
        ))}
        {explain.explainRu && explain.explainKy ? (
          <Text variant="secondary" tone="text2">
            {text({ explainRu: explain.explainRu, explainKy: explain.explainKy })}
          </Text>
        ) : null}
      </View>
    );
  } else if (exercise.type === "short_answer") {
    body = (
      <View style={{ gap: 6 }}>
        {explain.answer ? (
          <Text variant="secondary">
            {e.correctAnswerLabel}:{" "}
            <Text variant="secondary" bold accessibilityLanguage="en">
              {explain.answer}
            </Text>
          </Text>
        ) : null}
        {explain.explainRu && explain.explainKy ? (
          <Text variant="secondary" tone="text2">
            {text({ explainRu: explain.explainRu, explainKy: explain.explainKy })}
          </Text>
        ) : null}
      </View>
    );
  } else if (exercise.type === "reading" && explain.questions) {
    const selected = answer && typeof answer === "object" && "selected" in answer ? (answer as { selected: Record<string, unknown> }).selected : {};
    body = (
      <View style={{ gap: 10 }}>
        {explain.questions.map((question) => {
          const source = (exercise.questions ?? []).find((q) => q.id === question.id);
          const correct = source?.options.find((o) => o.id === question.correctOptionId);
          const chosen = typeof selected?.[question.id] === "string" ? String(selected[question.id]) : null;
          const ok = verdict.perQuestion?.[question.id] === true;
          return (
            <View key={question.id} style={{ gap: 4 }}>
              <Text variant="secondary" bold accessibilityLanguage="en">
                {source?.promptEn}
              </Text>
              <Text variant="secondary" tone={ok ? "ok" : "error"} bold>
                {ok ? e.verdictCorrect : e.verdictWrong}
                {!ok && correct ? ` · ${e.correctAnswerLabel}: ${optionLabel(correct, lang)}` : ""}
              </Text>
              {question.options.filter((o) => o.id === question.correctOptionId || o.id === chosen).map((o) => (
                <Text key={o.id} variant="secondary" tone="text2">
                  {text(o)}
                </Text>
              ))}
            </View>
          );
        })}
      </View>
    );
  }
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 8, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: verdict.correct ? tokens.surface : tokens.accentSoft, borderWidth: 1, borderColor: verdict.correct ? tokens.ok : tokens.error }} testID="explain-panel">
      <Chip tone={verdict.correct ? "ok" : "bad"} label={verdict.correct ? e.verdictCorrect : e.verdictWrong} testID="verdict" />
      {body}
    </View>
  );
}
