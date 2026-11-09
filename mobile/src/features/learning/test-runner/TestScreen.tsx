// Тест на время CSCA: вступление, прохождение, итог и разбор. Вся логика (часы по серверному
// времени, пачки сохранения, замороженные запросы, завершение) живёт в CscaTestSession.
import { router } from "expo-router";
import { Flag } from "lucide-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, Modal, Pressable, View } from "react-native";

import { formatClock, cscaTopicNextLessons, cscaWeakTopicLesson, type CscaTestAttempt } from "@web/lib/portal/csca";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { cscaDayLabelSafe } from "@/features/learning/csca/format";
import { ItemCard } from "@/features/learning/csca/ItemCard";
import { ReportSheet } from "@/features/learning/csca/ReportSheet";
import { useCscaHome, useCscaTestResult, useInvalidateCsca } from "@/features/learning/queries";
import { CscaTestSession, defaultEnv, type TestUiState } from "@/features/learning/test-runner/session";
import { Chip, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const errorKey = (code: string | null): "errorUnavailable" | "errorDenied" | "errorInvalid" | "errorConflict" =>
  code === "denied" ? "errorDenied" : code === "unavailable" ? "errorUnavailable" : code === "conflict" ? "errorConflict" : "errorInvalid";

export function TestScreen({ formId, attemptId }: { formId: string; attemptId: string | null }) {
  const { m, t } = useLang();
  const back = useBack("/csca");
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
  const { lang, m, t } = useLang();
  const c = t("csca");
  const back = useBack("/csca");

  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => (status === "active" ? session.onForeground() : session.onBackground()));
    return () => sub.remove();
  }, [session]);
  const phase = state.phase;
  useEffect(() => {
    if (phase === "result") invalidate();
  }, [phase, invalidate]);

  const title = state.attempt ? (lang === "ky" ? state.attempt.metadata.title_ky : state.attempt.metadata.title_ru) : form ? (lang === "ky" ? form.metadata.title_ky : form.metadata.title_ru) : c.testTitle;
  const running = phase === "running" || phase === "finishing";

  return (
    <StackPage
      header={<SubHeader title={title} onBack={running ? () => confirmLeave(session, back, m) : back} backLabel={c.backToHome} testID="test-title" right={running && state.remaining !== null ? <Clock state={state} /> : undefined} />}
      testID="test-screen"
      bottomPad={32}
    >
      {phase === "intro" || phase === "starting" ? <Intro form={form} state={state} onStart={() => void session.start()} /> : null}
      {phase === "running" || phase === "finishing" ? <Runner session={session} state={state} /> : null}
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

function Clock({ state }: { state: TestUiState }) {
  const { t, format } = useLang();
  const c = t("csca");
  const left = state.remaining ?? 0;
  const urgent = left <= 60;
  return (
    <View style={{ paddingRight: 12 }} accessible accessibilityRole="timer" accessibilityLabel={format(c.remainingAria, { time: formatClock(left) })} accessibilityLiveRegion={state.lastMinute ? "polite" : "none"}>
      <Text variant="caption" tone="text2">
        {c.remaining}
      </Text>
      <Text variant="data" bold tone={urgent ? "error" : "text"} testID="test-clock">
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
      <Text variant="secondary" tone="text2">
        {lang === "ky" ? form.metadata.intro_ky : form.metadata.intro_ru}
      </Text>
      <Card>
        <Row label={c.testIntroItems} value={String(form.itemsTotal)} />
        <Row label={c.testIntroTime} value={time} />
        <Row label={c.testIntroEarly} value={form.allowEarlyFinish ? c.testIntroEarlyYes : c.testIntroEarlyNo} />
      </Card>
      <View style={{ gap: 4 }}>
        {[c.testRuleChange, c.testRuleSave, m("learn.ruleClock"), c.testRuleReview, ...(form.allowEarlyFinish ? [] : [c.testRuleMock])].map((line) => (
          <Text key={line} variant="secondary" tone="text2">
            • {line}
          </Text>
        ))}
      </View>
      {state.error ? <InlineAlert message={c[errorKey(state.error)]} testID="test-start-error" /> : null}
      <Button label={state.phase === "starting" ? c.testStarting : form.draft ? c.testResume : c.testBegin} busy={state.phase === "starting"} onPress={onStart} testID="test-begin" />
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

function Runner({ session, state }: { session: CscaTestSession; state: TestUiState }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const attempt = state.attempt as CscaTestAttempt;
  const [navOpen, setNavOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const item = attempt.items[state.index];
  const answeredCount = Object.keys(state.answers).length;
  const flagged = state.flags.includes(item.itemKey);
  const finishing = state.phase === "finishing";
  const status = state.saveStatus === "pending" || state.saveStatus === "saving" ? c.saveSaving : state.saveStatus === "retrying" ? c.saveRetrying : state.saveStatus === "saved" ? c.saveSaved : c.saveIdle;
  const timeUp = state.remaining === 0;
  const last = state.index === attempt.items.length - 1;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite" testID="test-save-status">
          {status}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={c.navigatorLabel} onPress={() => setNavOpen(true)} testID="test-nav-open" style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
          <Text variant="secondary" tone="accent" bold>
            {format(c.answeredCount, { answered: String(answeredCount), total: String(attempt.items.length) })}
          </Text>
        </Pressable>
      </View>
      {timeUp || finishing ? (
        <Text variant="secondary" tone="text2" accessibilityRole="alert" testID="test-timeup">
          {timeUp ? c.timeUp : c.finishing}
        </Text>
      ) : null}
      {state.notice === "finishUnsent" ? <InlineAlert message={c.finishUnsent} testID="test-unsent" /> : null}
      {state.notice === "conflict" ? <InlineAlert message={c.errorConflict} /> : null}
      {state.error ? <InlineAlert message={c[errorKey(state.error)]} testID="test-error" /> : null}
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
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: flagged }} onPress={() => session.toggleFlag(item.itemKey)} testID="test-flag" style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flag size={20} strokeWidth={1.75} color={flagged ? tokens.accent : tokens.text2} fill={flagged ? tokens.accent : "none"} />
              <Text variant="secondary" tone={flagged ? "accent" : "text2"} bold={flagged}>
                {c.flag}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button variant="ghost" label={c.prev} disabled={state.index === 0 || finishing} onPress={() => session.goTo(state.index - 1)} style={{ flex: 1 }} testID="test-prev" />
              <Button variant="ghost" label={c.next} disabled={last || finishing} onPress={() => session.goTo(state.index + 1)} style={{ flex: 1 }} testID="test-next" />
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
      <Navigator visible={navOpen} onClose={() => setNavOpen(false)} attempt={attempt} state={state} onPick={(i) => { setNavOpen(false); session.goTo(i); }} />
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

function Navigator({ visible, onClose, attempt, state, onPick }: { visible: boolean; onClose: () => void; attempt: CscaTestAttempt; state: TestUiState; onPick: (i: number) => void }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View style={{ backgroundColor: tokens.surface, padding: 16, gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 }} testID="test-navigator">
          <Text variant="heading" accessibilityRole="header">
            {c.navigatorLabel}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {attempt.items.map((it, i) => {
              const answered = it.itemKey in state.answers;
              const flaggedHere = state.flags.includes(it.itemKey);
              return (
                <Pressable
                  key={it.itemKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${format(c.navItem, { n: String(i + 1) })}, ${answered ? c.navAnswered : c.navUnanswered}${flaggedHere ? `, ${c.navFlagged}` : ""}`}
                  onPress={() => onPick(i)}
                  testID={`nav-${i + 1}`}
                  style={{ width: 48, height: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: i === state.index ? 2 : 1, borderColor: i === state.index ? tokens.accent : flaggedHere ? tokens.warn : tokens.line, backgroundColor: answered ? tokens.accentSoft : tokens.surface }}
                >
                  <Text variant="secondary" bold>
                    {i + 1}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
            <Text variant="caption" tone="text2">
              ■ {c.legendAnswered}
            </Text>
            <Text variant="caption" tone="text2">
              ⚑ {c.legendFlagged}
            </Text>
          </View>
          <Button variant="ghost" label={m("learn.navClose")} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

// ---- итог и разбор ---------------------------------------------------------------------------

function Result({ attempt, onRestart }: { attempt: CscaTestAttempt; onRestart: () => void }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const home = useCscaHome(true);
  const [reporting, setReporting] = useState<string | null>(null);
  const result = attempt.result;
  const review = attempt.review;
  if (!result || !review) return <InlineAlert message={c.errorInvalid} />;
  const pick = (ru: string, ky: string) => (lang === "ky" ? ky : ru);
  const topicTitles = Object.fromEntries((home.data?.topics ?? []).map((tp) => [tp.topicKey, pick(tp.metadata.title_ru, tp.metadata.title_ky)]));
  const sectionTitles = Object.fromEntries((home.data?.modules[0]?.metadata.sections ?? []).map((s) => [s.section, pick(s.title_ru, s.title_ky)]));
  const nextLessons = home.data ? cscaTopicNextLessons(home.data.topics, home.data.lessons) : {};
  const weak = cscaWeakTopicLesson(result.byTopic, nextLessons);
  const byItem = Object.fromEntries(attempt.items.map((it) => [it.itemKey, it]));
  const avg = result.pace.avgSeconds;
  return (
    <View style={{ gap: 16 }} testID="test-result">
      <Card>
        <Text variant="display" accessibilityRole="header" testID="result-score">
          {format(c.resultScore, { correct: String(result.correctCount), total: String(result.itemsTotal) })}
        </Text>
        <Text variant="secondary" tone="text2">
          {c.resultCaption}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label={c[`completion.${result.completion}`]} />
          {result.unansweredCount > 0 ? <Chip tone="warn" label={format(c.resultUnanswered, { count: String(result.unansweredCount) })} /> : null}
        </View>
        <Text variant="caption" tone="text2">
          {avg === null ? c.resultPaceNone : format(c.resultPace, { avg: String(avg), budget: String(result.pace.budgetSeconds) })}
        </Text>
      </Card>
      {weak ? (
        <Button label={format(weak.kind === "lesson" ? c.resultNextLesson : c.resultNextPractice, { title: pick(weak.titleRu, weak.titleKy) })} onPress={() => router.navigate({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: weak.lessonId } })} testID="result-next" />
      ) : (
        <Button label={c.backToTopics} onPress={() => router.navigate("/csca")} testID="result-topics" />
      )}
      <Tally title={c.bySectionHeading} rows={result.bySection.map((s) => ({ key: String(s.section), label: `${format(c.sectionLabel, { n: String(s.section) })}${sectionTitles[s.section] ? `: ${sectionTitles[s.section]}` : ""}`, correct: s.correct, total: s.total }))} tallyFormat={c.tallyLabel} />
      <Tally title={c.byTopicHeading} rows={result.byTopic.map((tp) => ({ key: tp.topicKey, label: topicTitles[tp.topicKey] ?? tp.topicKey, correct: tp.correct, total: tp.total }))} tallyFormat={c.tallyLabel} />
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
              {entry.selected === null ? <Chip tone="warn" label={c.notAnswered} /> : null}
              {entry.seconds !== null ? <Text variant="caption" tone="text2">{format(c.secondsSpent, { n: String(entry.seconds) })}</Text> : null}
              {entry.flagged ? <Text variant="caption" tone="text2">{c.flaggedMark}</Text> : null}
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
      <Button variant="ghost" label={c.repeat} onPress={onRestart} testID="result-restart" />
      {reporting ? <ReportSheet itemKey={reporting} visible onClose={() => setReporting(null)} /> : null}
      <Text variant="caption" tone="text2">
        {cscaDayLabelSafe(result.completedAt, lang)}
      </Text>
    </View>
  );
}

function Tally({ title, rows, tallyFormat }: { title: string; rows: { key: string; label: string; correct: number; total: number }[]; tallyFormat: string }) {
  const { tokens } = useTheme();
  const { format } = useLang();
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {rows.map((row) => (
        <View key={row.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: tokens.line }}>
          <Text variant="secondary" style={{ flex: 1 }}>
            {row.label}
          </Text>
          <Text variant="secondary" bold>
            {format(tallyFormat, { correct: String(row.correct), total: String(row.total) })}
          </Text>
        </View>
      ))}
    </View>
  );
}
