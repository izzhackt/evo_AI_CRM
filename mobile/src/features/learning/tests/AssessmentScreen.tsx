// Прохождение теста и результат: english36 (36 заданий, «не знаю» среди вариантов) и orvis92 (92
// утверждения, шкала). Вердикта по ходу нет; результат и разбор приходят в ответе завершения.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, View } from "react-native";

import { isAssessmentKey, type AssessmentAttempt, type AssessmentQuestion, type StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { AssessmentSession, defaultAssessmentEnv, type AssessmentUiState } from "@/features/learning/tests/assessment-session";
import { useAssessmentAttempt, useAssessmentCatalog } from "@/features/learning/tests/queries";
import { Chip, SegmentBar, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function AssessmentScreen({ instrumentKey, attemptId }: { instrumentKey: string; attemptId: string | null }) {
  const { m, t } = useLang();
  const back = useBack("/tests");
  const s = t("tests");
  const catalog = useAssessmentCatalog();
  const shown = useAssessmentAttempt(attemptId);
  const header = (title: string) => <SubHeader title={title} onBack={back} backLabel={s.backToCatalog} testID="assessment-title" />;
  if (!isAssessmentKey(instrumentKey)) {
    return (
      <StackPage header={header(s.title)} testID="assessment-screen">
        <InlineAlert message={s.unavailableTitle} />
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
        {catalog.status === "error" ? <InlineAlert message={m(loadErrorKey(catalog.error))} retryLabel={m("gate.retry")} onRetry={() => void catalog.refetch()} /> : catalog.status === "success" ? <InlineAlert message={s.unavailableTitle} /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  return <AssessmentFlow key={`${instrumentKey}:${attemptId ?? ""}`} instrumentKey={instrumentKey} knownDraft={instrument?.draftAttemptId ?? null} initial={shown.data ?? null} instrument={instrument} />;
}

type Instrument = NonNullable<ReturnType<typeof useAssessmentCatalog>["data"]>["instruments"][number];

function AssessmentFlow({ instrumentKey, knownDraft, initial, instrument }: { instrumentKey: StudentAssessmentKey; knownDraft: string | null; initial: AssessmentAttempt | null; instrument: Instrument | null }) {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const { t } = useLang();
  const s = t("tests");
  const back = useBack("/tests");
  const [session] = useState(() => new AssessmentSession(defaultAssessmentEnv(transport), instrumentKey, knownDraft, initial));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status !== "active") void session.flush();
    });
    return () => sub.remove();
  }, [session]);
  const phase = state.phase;
  useEffect(() => {
    if (phase === "result") void client.invalidateQueries({ queryKey: ["portal", userKey, "assessments"] });
  }, [phase, client, userKey]);
  const title = state.attempt?.metadata.title ?? instrument?.metadata.title ?? s.title;
  const running = phase === "running" || phase === "completing";
  const exit = () => {
    if (!running) return back();
    // Сохраняем и выходим: черновик остаётся на сервере («Можно прерваться и вернуться позже»).
    void session.flush().then(() => back());
  };
  return (
    <StackPage header={<SubHeader title={title} onBack={exit} backLabel={s.backToCatalog} testID="assessment-title" />} testID="assessment-screen">
      {phase === "intro" || phase === "starting" ? <Intro instrument={instrument} state={state} onStart={() => void session.start()} resume={knownDraft !== null} /> : null}
      {running && state.attempt ? <Runner session={session} state={state} attempt={state.attempt} onExit={exit} /> : null}
      {phase === "result" && state.attempt ? <AssessmentResult attempt={state.attempt} onRestart={() => session.restart()} /> : null}
    </StackPage>
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

function Runner({ session, state, attempt, onExit }: { session: AssessmentSession; state: AssessmentUiState; attempt: AssessmentAttempt; onExit: () => void }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const s = t("tests");
  const questions = attempt.questions;
  const total = questions.length;
  const answeredCount = Object.keys(state.answers).length;
  const reviewing = state.index >= total;
  const question: AssessmentQuestion | null = reviewing ? null : questions[state.index];
  const status = state.saveStatus === "saving" ? s.statusSaving : state.saveStatus === "unconfirmed" ? s.statusUnconfirmed : state.saveStatus === "dirty" ? s.statusDirty : s.statusSaved;
  const completing = state.phase === "completing";
  const errorKey = state.error === "conflict" ? "error.conflict" : state.error === "denied" ? "error.denied" : state.error === "invalid" ? "error.invalid" : "error.unavailable";
  return (
    <View style={{ gap: 12 }}>
      <SegmentBar states={questions.map((q, i) => (q.id in state.answers ? "done" : i === state.index ? "current" : "todo"))} onPress={(i) => session.goTo(i)} labels={questions.map((_, i) => format(s.taskOf, { n: String(i + 1), total: String(total) }))} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite" testID="assessment-save-status">
          {status}
        </Text>
        <Text variant="caption" tone="text2">
          {format(s.answeredOf, { count: String(answeredCount), total: String(total) })}
        </Text>
      </View>
      {state.error ? <InlineAlert message={s[errorKey]} testID="assessment-error" /> : null}
      {question ? (
        <View style={{ gap: 10 }}>
          <Text variant="caption" tone="text2" bold accessibilityRole="header">
            {format(s.taskOf, { n: String(state.index + 1), total: String(total) })}
          </Text>
          {question.passage ? (
            <View style={{ borderLeftWidth: 3, borderLeftColor: tokens.line, paddingLeft: 12 }}>
              <Text variant="secondary" accessibilityLanguage="en">
                {question.passage}
              </Text>
            </View>
          ) : null}
          <Text variant="body" bold accessibilityLanguage={attempt.instrumentKey === "english36" ? "en" : undefined} testID="assessment-prompt">
            {question.prompt}
          </Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {question.options.map((option) => {
              const on = state.answers[question.id] === option.id;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => session.select(question.id, option.id)}
                  testID={`assessment-option-${option.id}`}
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
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button variant="ghost" label={s.back} disabled={state.index === 0} onPress={() => session.goTo(state.index - 1)} style={{ flex: 1 }} testID="assessment-prev" />
            <Button label={state.index === total - 1 ? s.checkAndFinish : s.next} onPress={() => session.goTo(state.index + 1)} style={{ flex: 1 }} testID="assessment-next" />
          </View>
          <Button variant="ghost" label={s.saveAndExit} onPress={onExit} testID="assessment-exit" />
        </View>
      ) : (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {s.reviewHeading}
          </Text>
          <Text variant="secondary" tone="text2">
            {answeredCount === total ? s.reviewAllAnswered : format(s.reviewRemaining, { count: String(total - answeredCount) })}
          </Text>
          {answeredCount < total ? (
            <Button variant="ghost" label={s.toFirstUnanswered} onPress={() => session.goTo(Math.max(0, questions.findIndex((q) => !(q.id in state.answers))))} testID="assessment-first-open" />
          ) : null}
          <Button label={completing ? s.statusSaving : s.completeButton} busy={completing} disabled={answeredCount < total} onPress={() => void session.complete()} testID="assessment-complete" />
          <Button variant="ghost" label={s.back} onPress={() => session.goTo(total - 1)} />
        </Card>
      )}
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
      <Button variant="ghost" label={s.backToTests} onPress={() => router.navigate("/tests")} />
    </View>
  );
}
