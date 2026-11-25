// Урок или практика CSCA (веб: `math/lesson/[lessonId]/page.tsx`, `ItemRunner.tsx`): название, английское название, цель с формулами
// и строка «Урок · 18 мин · пункт программы 2.2»; у урока теория листом, затем «Проверка» по одному заданию. Итог ведёт
// к практике (из практики к уроку) той же темы, затем «К темам» и «Пройти ещё раз». Чтение `learning_lesson_v2`; запись
// через LessonSession (замороженные запросы). Вердикт после ответа озвучивается читалке.
// Оглавления «В уроке» нет: на вебе оно скрыто на экранах уже 1100 px (`.cs-toc { display: none }`), а приложение телефонное.
import { router } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import type { CscaLessonView } from "@web/lib/portal/csca";
import { formatPortalString } from "@web/lib/portal/i18n";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { ItemCard } from "@/features/learning/csca/ItemCard";
import { siblingLessonLink } from "@/features/learning/csca/lesson-links";
import { LessonSession } from "@/features/learning/csca/lesson-session";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { TheoryBlocks } from "@/features/learning/csca/TheoryBlocks";
import { MathText } from "@/features/learning/math/MathText";
import { useWarmMath } from "@/features/learning/math/useWarmMath";
import { useCscaHome, useCscaLesson, useInvalidateCsca } from "@/features/learning/queries";
import { SegmentBar, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Свободное место над и под полосой с зоной нажатия 44 pt: зона заходит на 19 pt за полосу (правило `largeTarget`). */
const BAR_CLEARANCE = 19;
/** Расстояние между блоками колонки задания (`gap` ниже): к нему добавляется поле, чтобы свободных стало 19 pt. */
const COLUMN_GAP = 12;

function openTopics() {
  router.dismissTo({ pathname: "/csca", params: { view: "lessons" } });
}

function LessonBody({ view, lessonId }: { view: CscaLessonView; lessonId: string }) {
  const { m, t, format } = useLang();
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
    ? ({ conflict: m("learn.lessonConflict"), already_answered: m("learn.lessonAlreadyAnswered"), denied: c.errorDenied, unavailable: c.errorUnavailable } as Record<string, string>)[state.error] ?? m("learn.lessonRejected")
    : null;
  const segStates = items.map((e, i) => {
    const a = state.answered[e.exerciseId];
    return a ? (a.correct ? "ok" : "bad") : !state.finished && i === state.index ? "current" : "todo";
  }) as ("ok" | "bad" | "current" | "todo")[];

  const meta = view.lesson.metadata;
  const sibling = siblingLessonLink(home.data?.lessons ?? [], { lessonId, topicKey: meta.topic_key, kind: meta.kind });

  /** «Проверить»: после ответа вердикт слышит и читалка, не только тот, кто видит экран. */
  async function check() {
    if (!current) return;
    const exerciseId = current.exerciseId;
    await session.submit();
    const answer = session.getState().answered[exerciseId];
    if (answer) announce(answer.correct ? c.verdictCorrect : c.verdictWrong);
  }

  const progress = (
    // Зона нажатия сегмента 44 pt заходит на 19 pt за полосу: сверху и снизу оставлено столько свободного места.
    <View style={{ marginVertical: BAR_CLEARANCE - COLUMN_GAP }}>
      <SegmentBar
        states={segStates}
        testID="lesson-progress"
        labels={items.map((_, i) => format(c.itemCounter, { n: String(i + 1), total: String(total) }))}
        stateWords={{ ok: c.verdictCorrect, bad: c.verdictWrong }}
        largeTarget
        onPress={(i) => {
          if (state.answered[items[i].exerciseId]) session.goTo(i);
        }}
      />
    </View>
  );

  const alert = errorText ? (
    <View accessibilityRole="alert" style={{ gap: 6 }}>
      <InlineAlert message={errorText} testID="lesson-error" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {state.error === "conflict" || state.error === "already_answered" ? <Button variant="ghost" label={c.reload} onPress={() => void session.reload()} /> : null}
        {state.error === "unavailable" ? <Button variant="ghost" label={c.retry} onPress={() => void check()} testID="lesson-retry" /> : null}
      </View>
    </View>
  ) : null;

  if (state.finished || !current) {
    const correct = items.filter((e) => state.answered[e.exerciseId]?.correct).length;
    const wrong = items.filter((e) => state.answered[e.exerciseId] && !state.answered[e.exerciseId].correct).length;
    return (
      <View style={{ gap: COLUMN_GAP }}>
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
            {sibling ? (
              <Button label={sibling.kind === "practice" ? c.toPractice : c.toLesson} onPress={() => router.replace({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: sibling.lessonId } })} testID="lesson-to-sibling" />
            ) : null}
            <Button variant={sibling ? "ghost" : "primary"} label={c.backToTopics} onPress={openTopics} testID="lesson-to-topics" />
            <Button variant="ghost" label={c.repeatCheck} onPress={() => session.restart()} testID="lesson-repeat" />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: COLUMN_GAP }}>
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
                <Button label={state.busy ? c.checking : c.checkAnswer} busy={state.busy} disabled={state.selected === null} onPress={() => void check()} testID="lesson-check" />
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
  const back = useBack("/csca?view=lessons");
  const c = t("csca");
  const lesson = useCscaLesson(lessonId);
  const view = lesson.data;
  const meta = view?.lesson.metadata;
  const ky = lang === "ky";
  return (
    <StackPage header={<SubHeader title={c.backToHome} onBack={back} backLabel={m("learn.back")} testID="lesson-bar" />} testID="lesson-screen">
      {!view || !meta ? (
        lesson.status === "error" ? (
          <InlineAlert message={m(loadErrorKey(lesson.error))} retryLabel={m("gate.retry")} onRetry={() => void lesson.refetch()} testID="lesson-load-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} />
        )
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text variant="title" accessibilityRole="header" testID="lesson-title">
              {ky ? meta.title_ky : meta.title_ru}
            </Text>
            <Text variant="body" tone="text2" accessibilityLanguage="en" testID="lesson-title-en">
              {meta.title_en}
            </Text>
            <View style={{ marginTop: 8 }}>
              <MathText source={ky ? meta.goal_ky : meta.goal_ru} testID="lesson-goal" />
            </View>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }} testID="lesson-meta">
              {format(c.lessonMeta, {
                kind: meta.kind === "lesson" ? c["kind.lesson"] : c["kind.practice"],
                minutes: format(c.minutes, { n: String(meta.est_minutes) }),
                point: meta.syllabus_point,
              })}
            </Text>
          </View>
          {meta.kind === "lesson" && view.lesson.theory.length > 0 ? (
            <Card>
              <TheoryBlocks blocks={view.lesson.theory} figures={view.figures} />
            </Card>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="title" accessibilityRole="header" testID="lesson-check-heading">
              {meta.kind === "lesson" ? c.checkHeading : c["kind.practice"]}
            </Text>
            <Text variant="secondary" tone="text2">
              {meta.kind === "lesson" ? c.checkLead : c.practiceLead}
            </Text>
          </View>
          <LessonBody key={view.lesson.lessonId} view={view} lessonId={lessonId} />
        </>
      )}
    </StackPage>
  );
}
