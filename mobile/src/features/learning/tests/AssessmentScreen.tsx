// Прохождение теста и результат: english36 (36 заданий, «не знаю» среди вариантов) и orvis92 (92
// утверждения, шкала). Вердикта по ходу нет; результат и разбор приходят в ответе завершения.
// Раннер как на сайте: страницы (english36 по одному заданию, orvis92 по четыре утверждения), цельная полоса прогресса,
// уход только после подтверждённого сохранения, конфликт без молчаливой замены ответов; начатый тест открывается сразу
// на первом пропущенном вопросе (веб: `AssessmentPage.tsx`).
import { useQueryClient } from "@tanstack/react-query";
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
import { StackPage, SubHeader } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useAbandonOnSignOut } from "@/session/sign-out-signal";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { AssessmentResult } from "@/features/learning/tests/AssessmentResults";

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
  // Выход из аккаунта: токен отозван, ни повтор, ни закрытие экрана больше ничего не шлют (QA 23: запись с отозванным токеном, 401).
  useAbandonOnSignOut(session);
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
  // Страница одна и та же прокрутка, а содержимое под ней меняется: «Перед началом» длиннее страницы вопросов, и студент жмёт «Начать»,
  // долистав до кнопки. Без сброса тест открывался с той же прокруткой: первое задание выше экрана, наверху второе (QA 23, D3). Так же
  // итог открывается сверху, а не с низа последней страницы, и «Пройти заново» возвращает к началу. Переход «страница теста» делает
  // раннер сам (`onPageChange`). Сброс при смене стадии, а не фазы: `running` и `completing` одна стадия (иначе сбой завершения
  // бросал бы студента наверх).
  const stage = phase === "result" ? "result" : phase === "intro" || phase === "starting" ? "intro" : "runner";
  const shownStage = useRef(stage);
  useEffect(() => {
    if (shownStage.current === stage) return;
    shownStage.current = stage;
    toTop();
  }, [stage, toTop]);
  return (
    <RunnerPage header={<SubHeader title={title} onBack={saveAndExit} backLabel={s.backToCatalog} testID="assessment-title" />} scrollRef={scroller} testID="assessment-screen">
      {loading ? <CardSkeleton label={m("state.loading")} lines={4} /> : null}
      {!loading && (phase === "intro" || phase === "starting") ? <Intro instrument={instrument} state={state} onStart={() => void session.start()} resume={state.resumable} /> : null}
      {running && state.attempt ? <AssessmentRunner session={session} state={state} attempt={state.attempt} exitNotice={exitNotice} onSaveAndExit={saveAndExit} onLeaveAnyway={leaveAnyway} onPageChange={toTop} /> : null}
      {phase === "result" && state.attempt ? <AssessmentResult attempt={state.attempt} onRestart={() => session.restart()} /> : null}
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
