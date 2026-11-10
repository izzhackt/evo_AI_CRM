// Урок английского: цель и объяснение, затем задания по одному (ответ финален, разбор после ответа),
// итог и «Завершить урок». Запись через EnglishSession (замороженные запросы).
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import type { LearningLessonView } from "@web/lib/portal/learning";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { EnglishSession } from "@/features/learning/english/english-session";
import { ExerciseForm, ExplainPanel } from "@/features/learning/english/ExerciseForm";
import { emptyExerciseValue, exerciseValueComplete, exerciseValueToAnswer, type ExerciseValue } from "@/features/learning/english/exercise-value";
import { useEnglishLesson } from "@/features/learning/queries-english";
import { SegmentBar, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function Runner({ view, lessonId }: { view: LearningLessonView; lessonId: string }) {
  const { t, format } = useLang();
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const e = t("english");
  const exercises = view.lesson.exercises;
  const [session] = useState(() => new EnglishSession(transport, lessonId, exercises, view.draft, view.latestCompleted));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [value, setValue] = useState<ExerciseValue | null>(null);
  const total = exercises.length;
  const current = state.index < total ? exercises[state.index] : null;
  const answered = current ? state.answers[current.exerciseId] : undefined;
  const form = current ? value ?? emptyExerciseValue(current) : null;
  const errorText = state.error ? ({ conflict: e.errorConflict, denied: e.errorDenied, unavailable: e.errorUnavailable, already_answered: e.errorConflict } as Record<string, string>)[state.error] ?? e.errorInvalid : null;
  const refresh = () => {
    for (const name of ["english-modules"]) void client.invalidateQueries({ queryKey: ["portal", userKey, name] });
  };

  const segStates = exercises.map((x, i) => {
    const a = state.answers[x.exerciseId];
    return a ? (a.correct ? "ok" : "bad") : i === state.index && !state.completed ? "current" : "todo";
  }) as ("ok" | "bad" | "current" | "todo")[];
  const alert = errorText ? (
    <View style={{ gap: 6 }}>
      <InlineAlert message={errorText} testID="english-run-error" />
      {state.error === "conflict" ? <Button variant="ghost" label={e.reloadDraft} onPress={() => void session.reload()} /> : null}
    </View>
  ) : null;

  if (state.completed || (!current && state.attemptId === null && Object.keys(state.answers).length === total)) {
    const correct = exercises.filter((x) => state.answers[x.exerciseId]?.correct).length;
    return (
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="english-complete">
          {e.completionHeading}
        </Text>
        <Text variant="body">{format(e.completionShare, { correct: String(correct), total: String(total) })}</Text>
        <Text variant="secondary" tone="text2">
          {correct === total ? e.completionNoMistakes : format(e.completionMistakes, { count: String(total - correct) })}
        </Text>
        <Button label={e.backToModule} onPress={() => { refresh(); router.navigate("/english"); }} testID="english-back-module" />
        <Button variant="ghost" label={e.repeatLesson} onPress={() => { setValue(null); session.restart(); }} testID="english-repeat" />
      </Card>
    );
  }
  if (!current) {
    return (
      <Card>
        <Text variant="heading">{e.completionHeading}</Text>
        <Text variant="secondary" tone="text2">
          {e.finishHint}
        </Text>
        {alert}
        <Button label={state.busy ? e.saving : e.finishButton} busy={state.busy} onPress={() => void session.finish().then(refresh)} testID="english-finish" />
      </Card>
    );
  }
  const complete = form ? exerciseValueComplete(current, form) : false;
  return (
    <View style={{ gap: 12 }}>
      <SegmentBar states={segStates} />
      <Text variant="caption" tone="text2" bold accessibilityRole="header">
        {format(e.exerciseCounter, { n: String(state.index + 1), total: String(total) })}
      </Text>
      <ExerciseForm key={current.exerciseId} exercise={current} value={form as ExerciseValue} disabled={answered !== undefined || state.busy} onChange={setValue} />
      {answered ? <ExplainPanel exercise={current} verdict={answered.verdict} explain={answered.explain} answer={answered.answer} /> : null}
      {alert}
      {answered ? (
        <Button label={state.index + 1 < total ? e.nextButton : e.toCompletion} onPress={() => { setValue(null); session.next(); }} testID="english-next" />
      ) : (
        <Button
          label={state.busy ? e.saving : e.answerButton}
          busy={state.busy}
          disabled={!complete}
          onPress={() => {
            const answer = form ? exerciseValueToAnswer(form) : null;
            if (answer) void session.answer(answer);
          }}
          testID="english-answer"
        />
      )}
    </View>
  );
}

export function EnglishLessonScreen({ lessonId }: { lessonId: string }) {
  const { lang, m, t, format } = useLang();
  const back = useBack("/english");
  const e = t("english");
  const lesson = useEnglishLesson(lessonId);
  const view = lesson.data;
  const [exercisesOpen, setExercisesOpen] = useState(false);
  const title = view ? (lang === "ky" ? view.lesson.metadata.title_ky : view.lesson.metadata.title_ru) : e.lessonTitle;
  const resumed = view ? view.draft !== null : false;
  return (
    <StackPage header={<SubHeader title={title} subtitle={view ? format(e.lessonLabel, { n: String(view.lesson.orderIndex) }) : null} onBack={back} backLabel={e.backToModule} testID="english-lesson-title" />} testID="english-lesson-screen">
      {!view ? (
        lesson.status === "error" ? (
          <InlineAlert message={m(loadErrorKey(lesson.error))} retryLabel={m("gate.retry")} onRetry={() => void lesson.refetch()} testID="english-lesson-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} />
        )
      ) : (
        <>
          <Card>
            <Text variant="caption" tone="accent" bold>
              {e.goalHeading}
            </Text>
            <Text variant="body">{lang === "ky" ? view.lesson.metadata.goal_ky : view.lesson.metadata.goal_ru}</Text>
          </Card>
          {view.lesson.theory.length > 0 ? (
            <View style={{ gap: 12 }}>
              <Text variant="heading" accessibilityRole="header">
                {e.theoryHeading}
              </Text>
              {view.lesson.theory.map((block, i) => (
                <View key={i} style={{ gap: 6 }}>
                  <Text variant="body">{lang === "ky" ? block.text_ky : block.text_ru}</Text>
                  {block.examples.map((ex, k) => (
                    <View key={k} style={{ paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: "#d70217" }}>
                      <Text variant="body" bold accessibilityLanguage="en">
                        {ex.en}
                      </Text>
                      <Text variant="secondary" tone="text2">
                        {lang === "ky" ? ex.ky : ex.ru}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
          {exercisesOpen || resumed ? (
            <Runner key={view.lesson.lessonId} view={view} lessonId={lessonId} />
          ) : (
            <Button label={view.latestCompleted ? e.repeatLesson : e.toExercises} onPress={() => setExercisesOpen(true)} testID="english-to-exercises" />
          )}
        </>
      )}
    </StackPage>
  );
}
