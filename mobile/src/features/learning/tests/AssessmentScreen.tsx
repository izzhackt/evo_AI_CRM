// Прохождение теста и результат: english36 (36 заданий, «не знаю» среди вариантов) и orvis92 (92
// утверждения, шкала). Вердикта по ходу нет; результат и разбор приходят в ответе завершения.
// Раннер как на сайте: страницы (english36 по одному заданию, orvis92 по четыре утверждения), цельная полоса прогресса,
// уход только после подтверждённого сохранения, конфликт без молчаливой замены ответов; начатый тест открывается сразу
// на первом пропущенном вопросе (веб: `AssessmentPage.tsx`).
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, View } from "react-native";

import { isAssessmentKey, type AssessmentAttempt, type StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { AssessmentRunner } from "@/features/learning/tests/AssessmentRunner";
import { AssessmentSession, defaultAssessmentEnv, type AssessmentUiState } from "@/features/learning/tests/assessment-session";
import { RunnerPage } from "@/features/learning/tests/RunnerPage";
import { useAssessmentAttempt, useAssessmentCatalog } from "@/features/learning/tests/queries";
import { leaveTests, testsOrigin, type TestsOrigin } from "@/features/learning/tests/exit";
import { useLeaveGuard } from "@/features/learning/tests/useLeaveGuard";
import { Chip, StackPage, SubHeader } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Тест недоступен (нет в каталоге или чужой ключ): заголовок, пояснение и «вернитесь позже», как на сайте. */
function Unavailable() {
  const { t } = useLang();
  const s = t("tests");
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header" testID="assessment-unavailable">
        {s.unavailableTitle}
      </Text>
      <Text variant="secondary" tone="text2">
        {s.unavailableLead}
      </Text>
      <Text variant="secondary">{s.unavailableBody}</Text>
    </Card>
  );
}

export function AssessmentScreen({ instrumentKey, attemptId, from = null }: { instrumentKey: string; attemptId: string | null; from?: string | string[] | null }) {
  const { m, t } = useLang();
  const origin = testsOrigin(from);
  const s = t("tests");
  const catalog = useAssessmentCatalog();
  const shown = useAssessmentAttempt(attemptId);
  const header = (title: string) => <SubHeader title={title} onBack={() => leaveTests(origin)} backLabel={s.backToCatalog} testID="assessment-title" />;
  if (!isAssessmentKey(instrumentKey)) {
    return (
      <StackPage header={header(s.title)} testID="assessment-screen">
        <Unavailable />
      </StackPage>
    );
  }
  const instrument = catalog.data?.instruments.find((i) => i.instrumentKey === instrumentKey) ?? null;
  if (attemptId !== null && shown.data === undefined) {
    return (
      <StackPage header={header(s.title)} testID="assessment-screen">
        {shown.status === "error" ? <InlineAlert message={m(loadErrorKey(shown.error))} retryLabel={m("gate.retry")} onRetry={() => void shown.refetch()} /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  if (attemptId === null && !instrument) {
    return (
      <StackPage header={header(s.title)} testID="assessment-screen">
        {catalog.status === "error" ? <InlineAlert message={m(loadErrorKey(catalog.error))} retryLabel={m("gate.retry")} onRetry={() => void catalog.refetch()} /> : catalog.status === "success" ? <Unavailable /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  return <AssessmentFlow key={`${instrumentKey}:${attemptId ?? ""}`} instrumentKey={instrumentKey} knownDraft={instrument?.draftAttemptId ?? null} initial={shown.data ?? null} instrument={instrument} origin={origin} />;
}

type Instrument = NonNullable<ReturnType<typeof useAssessmentCatalog>["data"]>["instruments"][number];

function AssessmentFlow({ instrumentKey, knownDraft, initial, instrument, origin }: { instrumentKey: StudentAssessmentKey; knownDraft: string | null; initial: AssessmentAttempt | null; instrument: Instrument | null; origin: TestsOrigin | null }) {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const { m, t } = useLang();
  const s = t("tests");
  const exit = useCallback(() => leaveTests(origin), [origin]);
  const [session] = useState(() => new AssessmentSession(defaultAssessmentEnv(transport), instrumentKey, knownDraft, initial));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const scroller = useRef<ScrollTarget>(null);
  const toTop = useCallback(() => scroller.current?.scrollTo({ y: 0, animated: false }), []);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") void session.flush();
    });
    return () => sub.remove();
  }, [session]);
  // Начатый тест открывается сразу на первом пропущенном вопросе, как на сайте: «Продолжить» с каталога не просит второго нажатия.
  // Пока читается черновик, показывается загрузка, а не «Перед началом».
  const [resuming, setResuming] = useState(knownDraft !== null && initial === null);
  useEffect(() => {
    if (!resuming) return;
    void session.start().finally(() => setResuming(false));
  }, [resuming, session]);
  const phase = state.phase;
  useEffect(() => {
    if (phase === "result") void client.invalidateQueries({ queryKey: ["portal", userKey, "assessments"] });
  }, [phase, client, userKey]);
  const title = state.attempt?.metadata.title ?? instrument?.metadata.title ?? s.title;
  const running = phase === "running" || phase === "completing";
  const { exitNotice, saveAndExit, leaveAnyway } = useLeaveGuard({ session, active: running, back: exit });
  const loading = resuming && (phase === "intro" || phase === "starting");
  const restart = () => {
    session.restart();
    toTop(); // «Перед началом» короче результата: без прокрутки открылся бы пустой низ экрана
  };
  return (
    <RunnerPage header={<SubHeader title={title} onBack={saveAndExit} backLabel={s.backToCatalog} testID="assessment-title" />} scrollRef={scroller} testID="assessment-screen">
      {loading ? <CardSkeleton label={m("state.loading")} lines={4} /> : null}
      {!loading && (phase === "intro" || phase === "starting") ? <Intro instrument={instrument} state={state} onStart={() => void session.start()} resume={state.resumable} /> : null}
      {running && state.attempt ? <AssessmentRunner session={session} state={state} attempt={state.attempt} exitNotice={exitNotice} onSaveAndExit={saveAndExit} onLeaveAnyway={leaveAnyway} onPageChange={toTop} /> : null}
      {phase === "result" && state.attempt ? <AssessmentResult attempt={state.attempt} onRestart={restart} /> : null}
    </RunnerPage>
  );
}

function Intro({ instrument, state, onStart, resume }: { instrument: Instrument | null; state: AssessmentUiState; onStart: () => void; resume: boolean }) {
  const { t, format } = useLang();
  const s = t("tests");
  if (!instrument) return null;
  return (
    <View style={{ gap: 16 }}>
      <Text variant="secondary" tone="text2">
        {instrument.metadata.description}
      </Text>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {s.introHeading}
        </Text>
        {instrument.metadata.instructions.map((line, i) => (
          <Text key={i} variant="secondary">
            • {line}
          </Text>
        ))}
        <Text variant="caption" tone="text2">
          {format(s.introMeta, { count: String(instrument.questionCount) })}
        </Text>
      </Card>
      <Card>
        <Text variant="secondary" bold>
          {s.introLimits}
        </Text>
        {instrument.metadata.limitations.map((line, i) => (
          <Text key={i} variant="caption" tone="text2">
            • {line}
          </Text>
        ))}
      </Card>
      {state.error ? <InlineAlert message={s[`error.${state.error === "denied" ? "denied" : "unavailable"}`]} testID="assessment-start-error" /> : null}
      <Button label={state.phase === "starting" ? s.startBusy : resume ? s.cardContinue : s.startButton} busy={state.phase === "starting"} onPress={onStart} testID="assessment-begin" />
    </View>
  );
}

function AssessmentResult({ attempt, onRestart }: { attempt: AssessmentAttempt; onRestart: () => void }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const s = t("tests");
  const result = attempt.result;
  if (!result) return <InlineAlert message={s["error.invalid"]} />;
  const meta = result.metadata;
  const questionsById = Object.fromEntries(attempt.questions.map((q) => [q.id, q]));
  return (
    <View style={{ gap: 16 }} testID="assessment-result">
      {result.english ? (
        <>
          <Card>
            <Text variant="display" accessibilityRole="header" testID="result-score">
              {format(s.resultScore, { correct: String(result.english.correctCount), total: String(result.english.totalCount) })}
            </Text>
            <Text variant="body" bold>
              {meta.bands?.find((b) => b.id === result.english?.band)?.label ?? s.resultBandFallback}
            </Text>
            <Text variant="secondary" tone="text2">
              {s.resultEnglishLead}
            </Text>
          </Card>
          <Text variant="heading" accessibilityRole="header">
            {s.topicsHeading}
          </Text>
          {result.english.topics.map((topic) => (
            <Card key={topic.topic}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="body" bold>
                  {s[`topic.${topic.topic}` as "topic.grammar"] ?? topic.topic}
                </Text>
                <Text variant="body" bold>
                  {format(s.topicShare, { correct: String(topic.correctCount), total: String(topic.totalCount) })}
                </Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: tokens.line }} accessible accessibilityLabel={format(s.topicMeterAria, { topic: topic.topic, correct: String(topic.correctCount), total: String(topic.totalCount) })}>
                <View style={{ height: 8, borderRadius: 4, width: `${topic.totalCount ? (topic.correctCount / topic.totalCount) * 100 : 0}%`, backgroundColor: tokens.ok }} />
              </View>
              {meta.recommendations?.[topic.topic as "grammar"] ? (
                <Text variant="secondary" tone="text2">
                  {meta.recommendations[topic.topic as "grammar"]}
                </Text>
              ) : null}
            </Card>
          ))}
          <Text variant="heading" accessibilityRole="header">
            {s.reviewSectionHeading}
          </Text>
          <Text variant="caption" tone="text2">
            {s.reviewSectionNote}
          </Text>
          {result.english.feedback.map((f, i) => {
            const q = questionsById[f.questionId];
            const label = (id: string) => q?.options.find((o) => o.id === id)?.label ?? id;
            return (
              <View key={f.questionId} style={{ gap: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }} testID={`feedback-${i + 1}`}>
                <Chip tone={f.correct ? "ok" : "bad"} label={f.correct ? s.feedbackCorrect : s.feedbackNeedsReview} />
                {q?.passage ? (
                  <Text variant="caption" tone="text2" accessibilityLanguage="en">
                    {q.passage}
                  </Text>
                ) : null}
                <Text variant="body" bold accessibilityLanguage="en">
                  {q?.prompt}
                </Text>
                <Text variant="secondary">
                  {s.yourAnswer} {label(f.selectedOptionId)}
                </Text>
                {!f.correct ? (
                  <Text variant="secondary">
                    {s.correctAnswer} {label(f.correctOptionId)}
                  </Text>
                ) : null}
                <Text variant="secondary" tone="text2">
                  {f.explanation}
                </Text>
              </View>
            );
          })}
        </>
      ) : null}
      {result.orvis ? (
        <>
          <Card>
            <Text variant="display" accessibilityRole="header">
              {s.resultCareerTitle}
            </Text>
            <Text variant="secondary" tone="text2">
              {s.resultCareerLead}
            </Text>
            <Text variant="caption" tone="text2">
              {s.scalesNote}
            </Text>
          </Card>
          <Text variant="heading" accessibilityRole="header">
            {s.scalesHeading}
          </Text>
          {result.orvis.scales.map((sc) => (
            <Card key={sc.scale}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="body" bold>
                  {s[`scale.${sc.scale}`]}
                </Text>
                <Text variant="body" bold>
                  {format(s.scaleShare, { mean: sc.mean.toFixed(1) })}
                </Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: tokens.line }} accessible accessibilityLabel={format(s.scaleMeterAria, { scale: s[`scale.${sc.scale}`], mean: sc.mean.toFixed(1) })}>
                <View style={{ height: 8, borderRadius: 4, width: `${((sc.mean - 1) / 4) * 100}%`, backgroundColor: result.orvis?.topScales.includes(sc.scale) ? tokens.accent : tokens.text2 }} />
              </View>
            </Card>
          ))}
          {meta.professions && meta.professions.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text variant="heading" accessibilityRole="header">
                {s.professionsHeading}
              </Text>
              <Text variant="caption" tone="text2">
                {s.professionsNote}
              </Text>
              {meta.professions.filter((p) => p.scaleIds.some((id) => result.orvis?.topScales.includes(id))).map((p) => (
                <Card key={p.id}>
                  <Text variant="body" bold>
                    {p.title}
                  </Text>
                  <Text variant="secondary">{p.summary}</Text>
                  <Text variant="secondary" tone="text2">
                    {s.professionSkills}
                    {p.skills.join(", ")}
                  </Text>
                  <Text variant="secondary" tone="text2">
                    {s.professionStudy}
                    {p.studyDirections.join(", ")}
                  </Text>
                  <Text variant="secondary" tone="text2">
                    {s.professionTry}
                    {p.tryActivity}
                  </Text>
                </Card>
              ))}
              {meta.professionAttribution ? (
                <Text variant="caption" tone="text2">
                  {meta.professionAttribution}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      <Text variant="caption" tone="text2">
        {s.resultSavedNote}
      </Text>
      <Button variant="ghost" label={s.cardRetake} onPress={onRestart} testID="assessment-restart" />
      {/* К каталогу, а не новый каталог поверх теста: из другого раздела тест в стеке «Тестов» единственный (см. `exit.ts`). */}
      <Button variant="ghost" label={s.backToTests} onPress={() => router.dismissTo("/tests")} testID="assessment-back-to-tests" />
    </View>
  );
}
