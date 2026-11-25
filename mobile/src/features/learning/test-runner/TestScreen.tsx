// Тест на время CSCA: вступление, прохождение, итог и разбор. Вся логика (часы по серверному
// времени, пачки сохранения, замороженные запросы, завершение) живёт в CscaTestSession.
import { router, useNavigation, usePreventRemove } from "expo-router";
import { Flag } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Alert, AppState, Modal, Pressable, View } from "react-native";

import { formatClock, type CscaTestAttempt } from "@web/lib/portal/csca";
import type { PortalStrings } from "@web/lib/portal/i18n";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { cscaDayLabelSafe } from "@/features/learning/csca/format";
import { ItemCard } from "@/features/learning/csca/ItemCard";
import { CSCA_TOPICS_FALLBACK, openCscaTopics } from "@/features/learning/csca/routes";
import { useWarmMath } from "@/features/learning/math/useWarmMath";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { useCscaHome, useCscaTestResult, useInvalidateCsca } from "@/features/learning/queries";
import { introRules, resultActions, resultFacts, resultTallies, type TallyRow } from "@/features/learning/test-runner/result-model";
import { CscaTestSession, defaultEnv, type TestUiState } from "@/features/learning/test-runner/session";
import { TestNavigator } from "@/features/learning/test-runner/TestNavigator";
import { Chip, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";
import { useAbandonOnSignOut } from "@/session/sign-out-signal";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Текст сбоя без слов веба «в другой вкладке» и «Обновите страницу»: в приложении ни вкладок, ни страниц нет. */
function errorText(code: string | null, c: PortalStrings<"csca">, m: (key: MobileStringKey) => string): string {
  return code === "denied" ? c.errorDenied : code === "unavailable" ? c.errorUnavailable : code === "conflict" ? m("learn.testConflict") : m("learn.testRejected");
}

export function TestScreen({ formId, attemptId }: { formId: string; attemptId: string | null }) {
  const { m, t } = useLang();
  const back = useBack(CSCA_TOPICS_FALLBACK);
  const c = t("csca");
  const home = useCscaHome(true);
  const shown = useCscaTestResult(attemptId);
  const form = home.data?.tests.find((x) => x.formId === formId) ?? null;
  const titleFor = (lang: "ru" | "ky") => (form ? (lang === "ky" ? form.metadata.title_ky : form.metadata.title_ru) : c.testTitle);
  const { lang } = useLang();

  if (attemptId !== null && shown.data === undefined) {
    return (
      <StackPage header={<SubHeader title={titleFor(lang)} onBack={back} backLabel={c.backToHome} testID="test-title" />} testID="test-screen">
        {shown.status === "error" ? <InlineAlert message={m(loadErrorKey(shown.error))} retryLabel={m("gate.retry")} onRetry={() => void shown.refetch()} testID="test-load-error" /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  if (attemptId === null && !form) {
    return (
      <StackPage header={<SubHeader title={c.testTitle} onBack={back} backLabel={c.backToHome} testID="test-title" />} testID="test-screen">
        {home.status === "error" ? <InlineAlert message={m(loadErrorKey(home.error))} retryLabel={m("gate.retry")} onRetry={() => void home.refetch()} testID="test-load-error" /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  return <TestFlow key={`${formId}:${attemptId ?? ""}`} formId={formId} knownDraft={form?.draft?.attemptId ?? null} initialResult={shown.data ?? null} form={form} />;
}

type Form = NonNullable<ReturnType<typeof useCscaHome>["data"]>["tests"][number];

function TestFlow({ formId, knownDraft, initialResult, form }: { formId: string; knownDraft: string | null; initialResult: CscaTestAttempt | null; form: Form | null }) {
  const { transport } = usePortalApi();
  const [session] = useState(() => new CscaTestSession(defaultEnv(transport), formId, knownDraft, initialResult));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const invalidate = useInvalidateCsca();
  const { lang, m, t, format } = useLang();
  const c = t("csca");
  const back = useBack(CSCA_TOPICS_FALLBACK);

  useWarmMath();
  useEffect(() => () => session.dispose(), [session]);
  // Выход из аккаунта: токен отозван, ни таймер, ни закрытие экрана больше ничего не шлют (QA 23: `save_learning_test_v1` с отозванным токеном, 401).
  useAbandonOnSignOut(session);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => (status === "active" ? session.onForeground() : session.onBackground()));
    return () => sub.remove();
  }, [session]);
  const phase = state.phase;
  useEffect(() => {
    if (phase === "result") invalidate();
  }, [phase, invalidate]);

  // Читалке: за минуту до конца (веб: `minuteNotice` ровно при 60 с), «Время вышло» или «Подводим итог» при завершении, счёт
  // после итога и номер задания после перехода (веб переводит фокус на заголовок). Открытие прошлого итога ничего не говорит.
  const total = state.attempt?.items.length ?? 0;
  const atMinute = phase === "running" && state.remaining === 60;
  useEffect(() => {
    if (atMinute) announce(format(c.remainingAria, { time: formatClock(60) }));
  }, [atMinute, c, format]);
  const finishingNow = phase === "finishing";
  const finishingText = state.remaining === 0 ? c.timeUp : c.finishing;
  useEffect(() => {
    if (finishingNow) announce(finishingText);
  }, [finishingNow, finishingText]);
  const previousPhase = useRef(phase);
  const score = state.attempt?.result ? format(c.resultScore, { correct: String(state.attempt.result.correctCount), total: String(state.attempt.result.itemsTotal) }) : null;
  useEffect(() => {
    const came = previousPhase.current === "running" || previousPhase.current === "finishing";
    previousPhase.current = phase;
    if (phase === "result" && came && score) announce(score);
  }, [phase, score]);
  const shownIndex = useRef(state.index);
  const counter = format(c.itemCounter, { n: String(state.index + 1), total: String(total) });
  useEffect(() => {
    if (shownIndex.current === state.index) return;
    shownIndex.current = state.index;
    if (phase === "running") announce(counter);
  }, [state.index, phase, counter]);

  const title = state.attempt ? (lang === "ky" ? state.attempt.metadata.title_ky : state.attempt.metadata.title_ru) : form ? (lang === "ky" ? form.metadata.title_ky : form.metadata.title_ru) : c.testTitle;
  const running = phase === "running" || phase === "finishing";
  // Свайп назад и системная «назад» не должны терять неотправленные ответы: пока идёт тест,
  // уход перехватывается и спрашивает подтверждение; жест закрыт, и экран закрывается через flush.
  const navigation = useNavigation();
  const scroller = useRef<ScrollTarget>(null);
  const [leaving, setLeaving] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  usePreventRemove(running && leaving === null, ({ data }) => confirmLeave(session, () => setLeaving(data.action), m));
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !running });
  }, [navigation, running]);
  useEffect(() => {
    if (leaving) navigation.dispatch(leaving);
  }, [leaving, navigation]);

  return (
    <StackPage
      header={<SubHeader title={title} onBack={back} backLabel={c.backToHome} testID="test-title" right={running && state.remaining !== null ? <Clock state={state} /> : undefined} />}
      testID="test-screen"
      scrollRef={scroller}
    >
      {phase === "intro" || phase === "starting" ? <Intro form={form} state={state} onStart={() => void session.start()} /> : null}
      {phase === "running" || phase === "finishing" ? <Runner session={session} state={state} scrollRef={scroller} /> : null}
      {phase === "result" && state.attempt ? <Result attempt={state.attempt} onRestart={() => session.restart()} /> : null}
    </StackPage>
  );
}

/** Выход из прохода по стрелке: ответы сохраняются, таймер сервера продолжает идти. */
function confirmLeave(session: CscaTestSession, back: () => void, m: (key: MobileStringKey) => string) {
  Alert.alert(m("learn.testExitTitle"), m("learn.testExitBody"), [
    { text: m("learn.testExitStay"), style: "cancel" },
    {
      text: m("learn.testExitLeave"),
      style: "destructive",
      onPress: () => {
        void session.flush({ settle: true }).finally(back);
      },
    },
  ]);
}

/**
 * Часы в шапке (веб: `role="timer"`). Подпись для читалки меняется каждую секунду, но живой областью часы не объявлены: раньше
 * на последней минуте Android читал бы каждое число. Минуту до конца читалке говорит `announce` один раз (в `TestFlow`).
 * Последняя минута красится цветом предупреждения, как `data-low` у веба.
 */
function Clock({ state }: { state: TestUiState }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const left = state.remaining ?? 0;
  const low = left <= 60;
  return (
    <View style={{ paddingRight: 12 }} accessible accessibilityRole="timer" accessibilityLabel={format(c.remainingAria, { time: formatClock(left) })}>
      <Text variant="caption" tone="text2">
        {c.remaining}
      </Text>
      <Text variant="data" bold style={low ? { color: tokens.warn } : undefined} testID="test-clock">
        {formatClock(left)}
      </Text>
    </View>
  );
}

function Intro({ form, state, onStart }: { form: Form | null; state: TestUiState; onStart: () => void }) {
  const { lang, m, t, format } = useLang();
  const c = t("csca");
  if (!form) return null;
  const minutes = Math.floor(form.durationSeconds / 60);
  const seconds = form.durationSeconds % 60;
  const time = seconds === 0 ? format(c.durationMinutes, { m: String(minutes) }) : format(c.durationMinutesSeconds, { m: String(minutes), s: String(seconds) });
  return (
    <View style={{ gap: 16 }}>
      <Text variant="heading" accessibilityRole="header" testID="test-intro-title">
        {c.testTitle}
      </Text>
      <Text variant="secondary" tone="text2">
        {lang === "ky" ? form.metadata.intro_ky : form.metadata.intro_ru}
      </Text>
      <Card>
        <Row label={c.testIntroItems} value={String(form.itemsTotal)} />
        <Row label={c.testIntroTime} value={time} />
        <Row label={c.testIntroEarly} value={form.allowEarlyFinish ? c.testIntroEarlyYes : c.testIntroEarlyNo} />
      </Card>
      <View style={{ gap: 4 }} testID="test-rules">
        {introRules(form.allowEarlyFinish, c, m("learn.ruleClock")).map((line) => (
          <Text key={line} variant="secondary" tone="text2">
            • {line}
          </Text>
        ))}
      </View>
      {state.error ? <InlineAlert message={errorText(state.error, c, m)} testID="test-start-error" /> : null}
      <Button label={state.phase === "starting" ? c.testStarting : form.draft ? c.testResume : c.testBegin} busy={state.phase === "starting"} onPress={onStart} testID="test-begin" />
      <LinkButton label={c.backToTopics} onPress={openCscaTopics} disabled={state.phase === "starting"} testID="test-intro-topics" />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Text variant="secondary" tone="text2">
        {label}
      </Text>
      <Text variant="secondary" bold>
        {value}
      </Text>
    </View>
  );
}

function Runner({ session, state, scrollRef }: { session: CscaTestSession; state: TestUiState; scrollRef: RefObject<ScrollTarget | null> }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const attempt = state.attempt as CscaTestAttempt;
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const item = attempt.items[state.index];
  const answeredCount = Object.keys(state.answers).length;
  const flagged = state.flags.includes(item.itemKey);
  const finishing = state.phase === "finishing";
  const status = state.saveStatus === "pending" || state.saveStatus === "saving" ? c.saveSaving : state.saveStatus === "retrying" ? c.saveRetrying : state.saveStatus === "saved" ? c.saveSaved : c.saveIdle;
  const last = state.index === attempt.items.length - 1;
  // Устойчивая функция: навигатор обёрнут в `memo`, а часы перерисовывают экран каждые полсекунды.
  const goTo = useCallback((next: number) => session.goTo(next), [session]);
  // Новое задание читается с начала: после «Далее» внизу страницы прокрутка вернулась бы к его концу (веб переводит фокус на заголовок).
  const shownIndex = useRef(state.index);
  useEffect(() => {
    if (shownIndex.current === state.index) return;
    shownIndex.current = state.index;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [state.index, scrollRef]);
  // Верхняя строка как на вебе: «Отвечено X из Y» и состояние сохранения; при завершении слова «Время вышло» или «Подводим итог».
  const barStatus = finishing ? (state.remaining === 0 ? c.timeUp : c.finishing) : status;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text variant="body" bold testID="test-answered">
          {format(c.answeredCount, { answered: String(answeredCount), total: String(attempt.items.length) })}
        </Text>
        {/* Состояние сохранения читается живой областью; слова завершения читает `announce` (в `TestFlow`), иначе Android скажет их дважды. */}
        <Text variant="caption" tone="text2" accessibilityLiveRegion={finishing ? "none" : "polite"} testID="test-save-status">
          {barStatus}
        </Text>
      </View>
      <TestNavigator attempt={attempt} answers={state.answers} flags={state.flags} index={state.index} disabled={finishing} onPick={goTo} />
      {state.notice === "finishUnsent" ? <InlineAlert message={c.finishUnsent} testID="test-unsent" /> : null}
      {state.notice === "conflict" ? <InlineAlert message={m("learn.testConflict")} testID="test-conflict" /> : null}
      {state.error ? <InlineAlert message={errorText(state.error, c, m)} testID="test-error" /> : null}
      <ItemCard
        key={item.itemKey}
        item={item}
        figure={item.figureKey ? attempt.figures[item.figureKey] ?? null : null}
        counter={format(c.itemCounter, { n: String(state.index + 1), total: String(attempt.items.length) })}
        state={{ kind: "test", selected: state.answers[item.itemKey] ?? null }}
        onSelect={(id) => session.select(item.itemKey, id)}
        onReport={() => setReporting(item.itemKey)}
        footer={
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: flagged, disabled: finishing }}
              disabled={finishing}
              onPress={() => session.toggleFlag(item.itemKey)}
              testID="test-flag"
              style={{ minHeight: MIN_TARGET, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: flagged ? tokens.warn : tokens.line, backgroundColor: flagged ? `${tokens.warn}1a` : tokens.surface }}
            >
              <Flag size={20} strokeWidth={1.75} color={flagged ? tokens.warn : tokens.text2} fill={flagged ? tokens.warn : "none"} />
              <Text variant="secondary" bold={flagged}>
                {c.flag}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button variant="ghost" label={c.prev} disabled={state.index === 0 || finishing} onPress={() => goTo(state.index - 1)} style={{ flex: 1 }} testID="test-prev" />
              <Button variant="ghost" label={c.next} disabled={last || finishing} onPress={() => goTo(state.index + 1)} style={{ flex: 1 }} testID="test-next" />
            </View>
          </View>
        }
      />
      {attempt.allowEarlyFinish ? (
        <Button label={c.finish} onPress={() => setConfirming(true)} disabled={finishing} testID="test-finish" />
      ) : (
        <Text variant="caption" tone="text2" testID="test-mock-note">
          {c.mockNoFinish}
        </Text>
      )}
      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: tokens.surface, borderRadius: tokens.radiusCard, padding: 16, gap: 12 }} testID="test-confirm">
            <Text variant="heading">{c.finish}</Text>
            <Text variant="secondary">{format(c.finishConfirm, { answered: String(answeredCount), total: String(attempt.items.length) })}</Text>
            <Button label={c.finishYes} onPress={() => { setConfirming(false); void session.finalize(); }} testID="test-confirm-yes" />
            <Button variant="ghost" label={c.finishNo} onPress={() => setConfirming(false)} testID="test-confirm-no" />
          </View>
        </View>
      </Modal>
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
    </View>
  );
}

// ---- итог и разбор ---------------------------------------------------------------------------

function Result({ attempt, onRestart }: { attempt: CscaTestAttempt; onRestart: () => void }) {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const home = useCscaHome(true);
  const [reporting, setReporting] = useState<string | null>(null);
  const result = attempt.result;
  const review = attempt.review;
  if (!result || !review) return <InlineAlert message={m("learn.testNoResult")} testID="test-result-missing" />;
  const tallies = resultTallies(result, home.data, lang, c);
  const actions = resultActions(attempt, home.data, lang, c);
  const byItem = Object.fromEntries(attempt.items.map((it) => [it.itemKey, it]));
  const run = (action: (typeof actions)[number]) => {
    if (action.kind === "lesson") router.navigate({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: action.lessonId } });
    else if (action.kind === "topics") openCscaTopics();
    else onRestart();
  };
  return (
    <View style={{ gap: 16 }} testID="test-result">
      <Card>
        <Text variant="display" accessibilityRole="header" testID="result-score">
          {format(c.resultScore, { correct: String(result.correctCount), total: String(result.itemsTotal) })}
        </Text>
        <Text variant="secondary" tone="text2">
          {c.resultCaption}
        </Text>
        <View style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: tokens.line }} testID="result-facts">
          {resultFacts(result, c).map((fact) => (
            <View key={fact.key} style={{ gap: 2 }} testID={`result-fact-${fact.key}`}>
              <Text variant="caption" tone="text2">
                {fact.label}
              </Text>
              <Text variant="secondary" bold>
                {fact.value}
              </Text>
            </View>
          ))}
        </View>
        {/* Кнопки сразу под итогом, до длинного списка разбора: урок слабой темы, «К темам», «Пройти ещё раз». */}
        <View style={{ gap: 8 }} testID="result-actions">
          {actions.map((action) => (
            <Button key={action.kind} variant={action.primary ? "primary" : "ghost"} label={action.label} onPress={() => run(action)} testID={action.kind === "lesson" ? "result-next" : action.kind === "topics" ? "result-topics" : "result-restart"} />
          ))}
        </View>
      </Card>
      <Tally title={c.bySectionHeading} rows={tallies.sections} tallyFormat={c.tallyLabel} testID="tally-sections" />
      {tallies.titlesKnown || home.status === "error" ? (
        <Tally title={c.byTopicHeading} rows={tallies.topics} tallyFormat={c.tallyLabel} testID="tally-topics" />
      ) : (
        <View style={{ gap: 6 }}>
          <Text variant="heading" accessibilityRole="header">
            {c.byTopicHeading}
          </Text>
          <CardSkeleton label={m("state.loading")} lines={3} testID="tally-topics-skeleton" />
        </View>
      )}
      <View style={{ gap: 4 }}>
        <Text variant="heading" accessibilityRole="header">
          {c.reviewListHeading}
        </Text>
        <Text variant="secondary" tone="text2">
          {c.reviewListLead}
        </Text>
      </View>
      {review.map((entry, i) => {
        const item = byItem[entry.itemKey];
        if (!item) return null;
        return (
          <View key={entry.itemKey} style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: tokens.line }} testID={`review-${i + 1}`}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {entry.seconds !== null ? <Text variant="caption" tone="text2">{format(c.secondsSpent, { n: String(entry.seconds) })}</Text> : null}
              {entry.flagged ? <Chip label={c.legendFlagged} testID="review-flagged" /> : null}
            </View>
            <ItemCard
              item={item}
              figure={item.figureKey ? attempt.figures[item.figureKey] ?? null : null}
              counter={format(c.itemCounter, { n: String(i + 1), total: String(review.length) })}
              state={{ kind: "answered", selected: entry.selected, correct: entry.correct, explain: entry.explain }}
              onReport={() => setReporting(entry.itemKey)}
            />
          </View>
        );
      })}
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
      <Text variant="caption" tone="text2">
        {cscaDayLabelSafe(result.completedAt, lang)}
      </Text>
    </View>
  );
}

/** Строка итога по модулю или теме: название (у темы с английским под ним), «N из M» и полоса доли верных (веб `.cs-tally`). */
function Tally({ title, rows, tallyFormat, testID }: { title: string; rows: readonly TallyRow[]; tallyFormat: string; testID?: string }) {
  const { tokens } = useTheme();
  const { format } = useLang();
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 10 }} testID={testID}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {rows.map((row) => (
        <View key={row.key} style={{ gap: 6 }} testID={`tally-${row.key}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text variant="secondary">{row.label}</Text>
              {row.labelEn ? (
                <Text variant="caption" tone="text2" accessibilityLanguage="en">
                  {row.labelEn}
                </Text>
              ) : null}
            </View>
            <Text variant="secondary" bold>
              {format(tallyFormat, { correct: String(row.correct), total: String(row.total) })}
            </Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 6, borderRadius: tokens.radiusChip, backgroundColor: tokens.line, overflow: "hidden" }}>
            <View testID={`tally-bar-${row.key}`} style={{ width: `${Math.round(row.ratio * 100)}%`, height: 6, backgroundColor: tokens.ok }} />
          </View>
        </View>
      ))}
    </View>
  );
}
