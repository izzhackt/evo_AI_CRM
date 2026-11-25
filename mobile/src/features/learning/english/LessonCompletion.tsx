// Итог урока как на сайте (`LessonRunner.tsx`, `CompletionView`): «Урок пройден», «Верно: N из M», строка про ошибки, затем
// [Повторить ошибки] (если они есть), [Пройти ещё раз], [Все уроки] и список всех заданий с формулировкой и разбором.
// Урок, который студент уже прошёл, открывается сразу на этом экране (без второго нажатия).
import { View } from "react-native";

import type { LearningLessonView, LearningResult } from "@web/lib/portal/learning";

import { ExplainPanel } from "@/features/learning/english/ExerciseForm";
import { exercisePrompt } from "@/features/learning/english/exercise-value";
import type { EnglishRunState } from "@/features/learning/english/english-session";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Счёт урока: из итога сервера, а если его нет - из ответов (то же число: верность проверяет сервер при каждом ответе). */
function scoreOf(view: LearningLessonView, state: EnglishRunState): { correct: number; total: number; wrong: number } {
  const result: LearningResult | null = state.result;
  const exercises = view.lesson.exercises;
  if (result) return { correct: result.correctCount, total: result.exercisesTotal, wrong: result.wrongExerciseIds.length };
  const correct = exercises.filter((x) => state.answers[x.exerciseId]?.correct).length;
  return { correct, total: exercises.length, wrong: exercises.length - correct };
}

export function LessonCompletion({ view, state, onReview, onRepeat, onBack }: { view: LearningLessonView; state: EnglishRunState; onReview: () => void; onRepeat: () => void; onBack: () => void }) {
  const { lang, t, format } = useLang();
  const e = t("english");
  const { correct, total, wrong } = scoreOf(view, state);
  const exercises = view.lesson.exercises;
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="english-complete">
          {e.completionHeading}
        </Text>
        <Text variant="display" style={{ fontVariant: ["tabular-nums"] }} testID="english-complete-share">
          {format(e.completionShare, { correct: String(correct), total: String(total) })}
        </Text>
        <Text variant="body">{wrong === 0 ? e.completionNoMistakes : format(e.completionMistakes, { count: String(wrong) })}</Text>
        <View style={{ gap: 8 }}>
          {wrong > 0 ? <Button label={e.reviewEntry} onPress={onReview} testID="english-review-open" /> : null}
          <Button variant="ghost" label={e.repeatLesson} busy={state.busy} onPress={onRepeat} testID="english-repeat" />
          <Button variant="ghost" label={e.backToModule} onPress={onBack} testID="english-back-module" />
        </View>
      </Card>
      {exercises.map((exercise, i) => {
        const entry = state.answers[exercise.exerciseId];
        if (!entry) return null;
        const prompt = exercisePrompt(exercise, lang);
        return (
          <Card key={exercise.exerciseId}>
            <Text variant="caption" tone="text2" bold testID={`completion-counter-${i + 1}`}>
              {format(e.exerciseCounter, { n: String(i + 1), total: String(exercises.length) })}
            </Text>
            {prompt ? (
              <Text variant="heading" accessibilityLanguage={exercise.promptEn ? "en" : undefined}>
                {prompt}
              </Text>
            ) : null}
            <ExplainPanel exercise={exercise} verdict={entry.verdict} explain={entry.explain} answer={entry.answer} />
          </Card>
        );
      })}
    </View>
  );
}
