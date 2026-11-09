// Урок или практика CSCA: цель, теория (у урока), затем «Проверка» по одному заданию.
// Чтение `learning_lesson_v2`; запись через LessonSession (замороженные запросы).
import { router } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import type { CscaLessonView } from "@web/lib/portal/csca";
import { formatPortalString } from "@web/lib/portal/i18n";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { ItemCard } from "@/features/learning/csca/ItemCard";
import { useWarmMath } from "@/features/learning/math/useWarmMath";
import { LessonSession } from "@/features/learning/csca/lesson-session";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { TheoryBlocks } from "@/features/learning/csca/TheoryBlocks";
import { useCscaHome, useCscaLesson, useInvalidateCsca } from "@/features/learning/queries";
import { SegmentBar, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

function LessonBody({ view, lessonId }: { view: CscaLessonView; lessonId: string }) {
  const { t, format } = useLang();
  const { transport } = usePortalApi();
  const invalidate = useInvalidateCsca();
  const home = useCscaHome(true);
  const c = t("csca");
  const items = view.lesson.exercises;
  const [session] = useState(() => new LessonSession(transport, lessonId, items, view.draft, view.latestCompleted));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [reporting, setReporting] = useState<string | null>(null);
  const answeredCount = Object.keys(state.answered).length;
  const seen = useRef(answeredCount);
  useEffect(() => {
    if (answeredCount !== seen.current) {
      seen.current = answeredCount;
      invalidate();
    }
  }, [answeredCount, invalidate]);

  const total = items.length;
  const current = !state.finished && state.index < total ? items[state.index] : null;
  const currentAnswer = current ? state.answered[current.exerciseId] : undefined;
  const nextIndex = state.index + 1 < total ? state.index + 1 : items.findIndex((e) => !(e.exerciseId in state.answered));
  const errorText = state.error
    ? ({ conflict: c.errorConflict, already_answered: c.errorAlreadyAnswered, denied: c.errorDenied, unavailable: c.errorUnavailable } as Record<string, string>)[state.error] ?? c.errorInvalid
    : null;
  const segStates = items.map((e, i) => {
    const a = state.answered[e.exerciseId];
    return a ? (a.correct ? "ok" : "bad") : !state.finished && i === state.index ? "current" : "todo";
  }) as ("ok" | "bad" | "current" | "todo")[];

  const topic = view.lesson.metadata.topic_key;
  const practice = home.data?.lessons.find((l) => l.metadata.topic_key === topic && l.metadata.kind === "practice");

  const progress = (
    <SegmentBar
      states={segStates}
      testID="lesson-progress"
      labels={items.map((_, i) => format(c.itemCounter, { n: String(i + 1), total: String(total) }))}
      onPress={(i) => {
        if (state.answered[items[i].exerciseId]) session.goTo(i);
      }}
    />
  );

  const alert = errorText ? (
    <View accessibilityRole="alert" style={{ gap: 6 }}>
      <InlineAlert message={errorText} testID="lesson-error" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {state.error === "conflict" || state.error === "already_answered" ? <Button variant="ghost" label={c.reload} onPress={() => void session.reload()} /> : null}
        {state.error === "unavailable" ? <Button variant="ghost" label={c.retry} onPress={() => void session.submit()} testID="lesson-retry" /> : null}
      </View>
    </View>
  ) : null;

  if (state.finished || !current) {
    const correct = items.filter((e) => state.answered[e.exerciseId]?.correct).length;
    const wrong = items.filter((e) => state.answered[e.exerciseId] && !state.answered[e.exerciseId].correct).length;
    return (
      <View style={{ gap: 12 }}>
        {progress}
        <Text variant="heading" accessibilityRole="header" testID="lesson-summary">
          {formatPortalString(c.summaryScore, { correct: String(correct), total: String(total) })}
        </Text>
        <Text variant="secondary" tone="text2">
          {wrong > 0 ? c.summaryMistakes : c.summaryNoMistakes}
        </Text>
        {state.attemptId !== null ? (
          <>
            {alert}
            <Button label={state.busy ? c.checking : c.finishLesson} busy={state.busy} onPress={() => void session.finishDraft()} testID="lesson-finish" />
          </>
        ) : (
          <View style={{ gap: 8 }}>
            {view.lesson.metadata.kind === "lesson" && practice ? (
              <Button label={c.toPractice} onPress={() => router.replace({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: practice.lessonId } })} testID="lesson-to-practice" />
            ) : null}
            <Button variant="ghost" label={c.backToTopics} onPress={() => router.navigate("/csca")} testID="lesson-to-topics" />
            <Button variant="ghost" label={c.repeatCheck} onPress={() => session.restart()} testID="lesson-repeat" />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {progress}
      <ItemCard
        key={current.exerciseId}
        item={current}
        figure={current.figureKey ? view.figures[current.figureKey] ?? null : null}
        counter={format(c.itemCounter, { n: String(state.index + 1), total: String(total) })}
        state={currentAnswer ? { kind: "answered", selected: currentAnswer.selected, correct: currentAnswer.correct, explain: currentAnswer.explain } : { kind: "open", selected: state.selected, busy: state.busy }}
        onSelect={(id) => session.select(id)}
        onReport={() => setReporting(current.itemKey)}
        footer={
          <View style={{ gap: 8 }}>
            {alert}
            {currentAnswer ? (
              <Button label={nextIndex < 0 || nextIndex >= total ? c.toSummary : c.nextItem} onPress={() => session.goTo(nextIndex < 0 ? total : nextIndex)} testID="lesson-next" />
            ) : (
              <>
                <Button label={state.busy ? c.checking : c.checkAnswer} busy={state.busy} disabled={state.selected === null} onPress={() => void session.submit()} testID="lesson-check" />
                {state.selected === null ? (
                  <Text variant="caption" tone="text2">
                    {c.chooseFirst}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        }
      />
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
    </View>
  );
}

export function LessonScreen({ lessonId }: { lessonId: string }) {
  useWarmMath();
  const { lang, m, t, format } = useLang();
  const back = useBack("/csca");
  const c = t("csca");
  const lesson = useCscaLesson(lessonId);
  const view = lesson.data;
  const title = view ? (lang === "ky" ? view.lesson.metadata.title_ky : view.lesson.metadata.title_ru) : c.title;
  return (
    <StackPage header={<SubHeader title={title} subtitle={view ? (lang === "ky" ? view.module.metadata.title_ky : view.module.metadata.title_ru) : null} onBack={back} backLabel={c.backToHome} testID="lesson-title" />} testID="lesson-screen">
      {!view ? (
        lesson.status === "error" ? (
          <InlineAlert message={m(loadErrorKey(lesson.error))} retryLabel={m("gate.retry")} onRetry={() => void lesson.refetch()} testID="lesson-load-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} />
        )
      ) : (
        <>
          <Text variant="secondary" tone="text2">
            {format(c.lessonMeta, {
              kind: view.lesson.metadata.kind === "lesson" ? c["kind.lesson"] : c["kind.practice"],
              minutes: format(c.minutes, { n: String(view.lesson.metadata.est_minutes) }),
              point: view.lesson.metadata.syllabus_point,
            })}
          </Text>
          {view.lesson.metadata.kind === "lesson" ? <TheoryBlocks blocks={view.lesson.theory} figures={view.figures} /> : null}
          <Text variant="heading" accessibilityRole="header">
            {view.lesson.metadata.kind === "lesson" ? c.checkHeading : c["kind.practice"]}
          </Text>
          <Text variant="secondary" tone="text2">
            {view.lesson.metadata.kind === "lesson" ? c.checkLead : c.practiceLead}
          </Text>
          <LessonBody key={view.lesson.lessonId} view={view} lessonId={lessonId} />
        </>
      )}
    </StackPage>
  );
}
