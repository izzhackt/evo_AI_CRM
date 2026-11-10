// CSCA: главная раздела «Учёба». Две вкладки как на вебе: «Занятия» (следующий шаг, тесты на
// время, ошибки, темы с уроками, сессии) и «Об экзамене» (статичный обзор, виден и без сети).
// Один чтение-запрос `learning_track_home_v1` на экран (общий с карточкой на «Главной»).
import { cscaOverviewKey } from "@/features/learning/csca/ui-state";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";

import {
  cscaOverviewOpen,
  parseCscaOverviewChoice,
  type CscaOverviewChoice,
} from "@web/lib/portal/csca-overview-choice";
import type { CscaHome, CscaLessonSummary, CscaNextStep, CscaTopic, CscaTopicState } from "@web/lib/portal/csca";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { cscaOnLabelSafe } from "@/features/learning/csca/format";
import { OverviewSection } from "@/features/learning/csca/OverviewSection";
import { SessionsPanel } from "@/features/learning/csca/SessionsPanel";
import { useCscaHome } from "@/features/learning/queries";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";

/** Выбор вкладки хранится на устройстве отдельно для каждого студента (общий ключ показал бы выбор прошлого). */
const storageKey = cscaOverviewKey;
const STATE_TONE: Record<CscaTopicState, "neutral" | "warn" | "bad" | "ok"> = { not_started: "neutral", few_data: "neutral", gap: "bad", shaky: "warn", confident: "ok" };

/** Занимался ли студент: решает, какая вкладка открыта сразу (правило §19, общее с iPhone). */
export function hasStarted(home: CscaHome): boolean {
  return (
    home.lessons.some((l) => l.completed || l.draftAttemptId !== null)
    || home.tests.some((x) => x.draft !== null || x.lastResult !== null)
    || home.review.activeCount > 0
    || home.topics.some((tp) => tp.windowAnswers > 0)
  );
}

function openLesson(lessonId: string) {
  router.navigate({ pathname: "/csca/lesson/[lessonId]", params: { lessonId } });
}

function NextStep({ home }: { home: CscaHome }) {
  const { lang, t, format } = useLang();
  const c = t("csca");
  const step: CscaNextStep | null = home.nextStep;
  const pick = (ru: string, ky: string) => (lang === "ky" ? ky : ru);
  let title: string = c["nextStep.noneTitle"];
  let why: string = c["nextStep.noneWhy"];
  let action: { label: string; run: () => void } | null = null;
  if (step?.kind === "test") {
    const form = home.tests.find((x) => x.formId === step.formId);
    title = form ? pick(form.metadata.title_ru, form.metadata.title_ky) : c.testTitle;
    why = c["nextStep.testWhy"];
    action = { label: c.testBegin, run: () => router.navigate({ pathname: "/csca/test/[formId]", params: { formId: step.formId } }) };
  } else if (step?.kind === "lesson") {
    const lesson = home.lessons.find((l) => l.lessonId === step.lessonId);
    const topic = home.topics.find((tp) => tp.topicKey === step.topicKey);
    title = lesson ? pick(lesson.metadata.title_ru, lesson.metadata.title_ky) : topic ? pick(topic.metadata.title_ru, topic.metadata.title_ky) : c.title;
    why = c[`nextStep.why.${step.topicState}`];
    action = { label: step.lessonKind === "lesson" ? c.startLesson : c.startPractice, run: () => openLesson(step.lessonId) };
  } else if (step?.kind === "review") {
    title = c["nextStep.reviewTitle"];
    why = c["nextStep.reviewWhy"];
    action = { label: c.openReview, run: () => router.navigate("/csca/review") };
  }
  return (
    <Card>
      <Text variant="caption" tone="accent" bold>
        {c.nextStepLabel}
      </Text>
      <Text variant="heading" accessibilityRole="header" testID="next-step-title">
        {title}
      </Text>
      <Text variant="secondary" tone="text2">
        {why}
      </Text>
      {action ? <Button label={action.label} onPress={action.run} testID="next-step-action" /> : null}
      <Text variant="caption" tone="text2">
        {format(c.moduleStatus, { count: String(home.topics.filter((tp) => tp.hasLessons).length) })}
      </Text>
    </Card>
  );
}

function Tiles({ home }: { home: CscaHome }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const done = home.topics.filter((tp) => tp.lessonCompleted).length;
  const nearest = [...home.sessions].sort((a, b) => a.examFrom.localeCompare(b.examFrom))[0];
  const days = nearest ? Math.round((Date.parse(`${nearest.examFrom}T00:00:00Z`) - Date.parse(`${home.today}T00:00:00Z`)) / 86_400_000) : null;
  const plural = days === null ? null : new Intl.PluralRules(lang === "ky" ? "ky" : "ru").select(days);
  const dayWord = plural === "one" ? c["tile.days.one"] : plural === "few" ? c["tile.days.few"] : c["tile.days.many"];
  const tile = (value: string, label: string, note: string, id: string) => (
    <View key={id} style={{ flex: 1, minWidth: 140, gap: 2, padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }} accessible accessibilityLabel={`${label}: ${value}. ${note}`} testID={`tile-${id}`}>
      <Text variant="caption" tone="text2" bold>
        {label}
      </Text>
      <Text variant="title" bold>
        {value}
      </Text>
      <Text variant="caption" tone="text2">
        {note}
      </Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tile(`${done}/${home.topics.length}`, c["tile.topics"], c["tile.topicsNote"], "topics")}
      {tile(String(home.review.dueCount), c.reviewHeading, c["tile.reviewNote"], "review")}
      {tile(days === null ? "—" : days === 0 ? c["tile.examToday"] : `${days} ${dayWord}`, c["tile.exam"], days === null ? c["tile.examNone"] : cscaOnLabelSafe(nearest.examFrom, lang), "exam")}
    </View>
  );
}

function TestsBlock({ home }: { home: CscaHome }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  if (home.tests.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="heading" accessibilityRole="header">
        {c.testsHeading}
      </Text>
      {home.tests.map((test) => {
        const minutes = Math.floor(test.durationSeconds / 60);
        const seconds = test.durationSeconds % 60;
        const dur = seconds === 0 ? format(c.durationMinutes, { m: String(minutes) }) : format(c.durationMinutesSeconds, { m: String(minutes), s: String(seconds) });
        return (
          <Card key={test.formId}>
            <Text variant="body" bold>
              {lang === "ky" ? test.metadata.title_ky : test.metadata.title_ru}
            </Text>
            <Text variant="secondary" tone="text2">
              {format(c.testItems, { count: String(test.itemsTotal) })} · {dur} · {test.allowEarlyFinish ? c.testEarly : c.testNoEarly}
            </Text>
            {test.lastResult ? (
              <Text variant="secondary" testID={`test-last-${test.formKey}`}>
                {format(c.testLast, { date: cscaOnLabelSafe(test.lastResult.completedAt.slice(0, 10), lang), correct: String(test.lastResult.correctCount), total: String(test.lastResult.itemsTotal) })}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button label={test.draft ? c.testContinue : c.testStart} onPress={() => router.navigate({ pathname: "/csca/test/[formId]", params: { formId: test.formId } })} testID={`test-open-${test.formKey}`} style={{ flexGrow: 1 }} />
              {test.lastResult ? (
                <Button variant="ghost" label={c.testOpenResult} onPress={() => router.navigate({ pathname: "/csca/test/[formId]", params: { formId: test.formId, attempt: test.lastResult?.attemptId as string } })} testID={`test-result-${test.formKey}`} style={{ flexGrow: 1, borderColor: tokens.line }} />
              ) : null}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function LessonRow({ lesson }: { lesson: CscaLessonSummary }) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const status = lesson.completed ? c.lessonDone : lesson.draftAttemptId ? c.lessonStarted : null;
  return (
    <Pressable accessibilityRole="button" onPress={() => openLesson(lesson.lessonId)} testID={`lesson-${lesson.lessonKey}`} style={{ minHeight: MIN_TARGET, paddingVertical: 8, gap: 2, borderTopWidth: 1, borderTopColor: tokens.line }}>
      <Text variant="secondary" bold>
        {lang === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru}
      </Text>
      <Text variant="caption" tone="text2">
        {lesson.metadata.kind === "lesson" ? c["kind.lesson"] : c["kind.practice"]} · {format(c.minutes, { n: String(lesson.metadata.est_minutes) })} · {format(c.itemsCount, { count: String(lesson.exercisesTotal) })}
        {status ? ` · ${status}` : ""}
        {lesson.lastResult ? ` · ${format(c.lessonLast, { correct: String(lesson.lastResult.correctCount), total: String(lesson.lastResult.exercisesTotal) })}` : ""}
      </Text>
    </Pressable>
  );
}

function TopicRow({ topic, lessons }: { topic: CscaTopic; lessons: CscaLessonSummary[] }) {
  const { lang, t, format } = useLang();
  const c = t("csca");
  const [open, setOpen] = useState(false);
  return (
    <View testID={`topic-${topic.topicKey}`}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} disabled={!topic.hasLessons} style={{ minHeight: MIN_TARGET, paddingVertical: 8, gap: 4 }}>
        <Text variant="body" bold>
          {lang === "ky" ? topic.metadata.title_ky : topic.metadata.title_ru}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone={STATE_TONE[topic.state]} label={c[`state.${topic.state}`]} />
          {topic.windowAnswers > 0 ? (
            <Text variant="caption" tone="text2">
              {format(c.topicWindow, { correct: String(topic.windowCorrect), total: String(topic.windowAnswers) })}
            </Text>
          ) : null}
          {topic.lessonCompleted ? (
            <Text variant="caption" tone="text2">
              {c.topicLessonDone}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open ? lessons.map((l) => <LessonRow key={l.lessonId} lesson={l} />) : null}
    </View>
  );
}

function Topics({ home }: { home: CscaHome }) {
  const { lang, t, format } = useLang();
  const c = t("csca");
  const sections = home.modules[0]?.metadata.sections ?? [];
  const withLessons = home.topics.filter((tp) => tp.hasLessons);
  const quiet = home.topics.length - withLessons.length;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="heading" accessibilityRole="header">
        {c.topicsHeading}
      </Text>
      <Text variant="caption" tone="text2">
        {c.topicsLead}
      </Text>
      {sections.map((section) => {
        const topics = withLessons.filter((tp) => tp.metadata.section === section.section).sort((a, b) => a.orderIndex - b.orderIndex);
        if (topics.length === 0) return null;
        return (
          <Card key={section.section}>
            <Text variant="secondary" bold accessibilityRole="header">
              {format(c.sectionLabel, { n: String(section.section) })}: {lang === "ky" ? section.title_ky : section.title_ru}
            </Text>
            <Text variant="caption" tone="text2">
              {format(c.sectionWeight, { count: String(section.mock_items_estimate) })}
            </Text>
            {topics.map((tp) => (
              <TopicRow key={tp.topicKey} topic={tp} lessons={home.lessons.filter((l) => l.metadata.topic_key === tp.topicKey).sort((a, b) => a.orderIndex - b.orderIndex)} />
            ))}
          </Card>
        );
      })}
      {quiet > 0 ? (
        <Text variant="caption" tone="text2">
          {format(c.quietTopics, { count: String(quiet) })}
        </Text>
      ) : null}
    </View>
  );
}

export function CscaHomeScreen() {
  const { m, t } = useLang();
  const c = t("csca");
  useRefetchOnFocus();
  const home = useCscaHome(true);
  const { userKey } = usePortalApi();
  const [tab, setTab] = useState<"lessons" | "about" | null>(null);
  const [choice, setChoice] = useState<CscaOverviewChoice | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(storageKey(userKey))
      .then((v) => setChoice(parseCscaOverviewChoice(v)))
      .catch(() => setChoice(null));
  }, [userKey]);
  const data = home.data;
  // Вкладка: свой выбор, иначе новичок видит обзор, занимающийся занятия.
  const effective = tab ?? (choice === undefined ? null : data || home.status === "error" ? (cscaOverviewOpen(choice, data ? hasStarted(data) : true) ? "about" : "lessons") : null);
  const pick = (next: "lessons" | "about") => {
    setTab(next);
    AsyncStorage.setItem(storageKey(userKey), next === "about" ? "open" : "closed").catch(() => undefined);
  };
  return (
    <Screen topInset={false} tabBar onRefresh={() => void home.refetch()} refreshing={home.isRefetching}>
      <View style={{ gap: 16 }} testID="csca-screen">
        <View style={{ gap: 4 }}>
          <Text variant="display" accessibilityRole="header" testID="title-csca">
            {c.title}
          </Text>
          <Text variant="secondary" tone="text2">
            {c.lead}
          </Text>
          <Text variant="caption" tone="text2">
            {c.ownWork}
          </Text>
        </View>
        <Segmented
          value={effective ?? "lessons"}
          onChange={pick}
          options={[
            { value: "lessons", label: c["tab.lessons"] },
            { value: "about", label: c["tab.about"] },
          ]}
          testIDPrefix="csca-tab"
        />
        {effective === "about" ? (
          <OverviewSection hasSessions={(data?.sessions.length ?? 0) > 0} />
        ) : !data ? (
          home.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(home.error))} retryLabel={m("gate.retry")} onRetry={() => void home.refetch()} testID="csca-error" />
          ) : (
            <CardSkeleton label={m("state.loading")} lines={4} testID="csca-skeleton" />
          )
        ) : data.lessons.length === 0 && data.tests.length === 0 ? (
          <Card>
            <Text variant="heading">{c.emptyTitle}</Text>
            <Text variant="secondary" tone="text2">
              {c.emptyBody}
            </Text>
          </Card>
        ) : (
          <View style={{ gap: 16 }}>
            <NextStep home={data} />
            <Tiles home={data} />
            <TestsBlock home={data} />
            <Card>
              <Text variant="heading" accessibilityRole="header">
                {c.reviewHeading}
              </Text>
              <Text variant="secondary" tone="text2" testID="review-summary">
                {data.review.activeCount === 0 ? c.reviewEmptyBank : data.review.dueCount > 0 ? t("csca").reviewDue.replace("{count}", String(data.review.dueCount)) : c.reviewNone}
              </Text>
              <Button variant="ghost" label={c.openReview} onPress={() => router.navigate("/csca/review")} testID="review-open" />
              <Button variant="ghost" label={c.progressOpen} onPress={() => router.navigate("/csca/progress")} testID="progress-open" />
            </Card>
            <Topics home={data} />
            <SessionsPanel home={data} testID="sessions-block" />
            <View style={{ gap: 4 }}>
              {data.modules[0]?.metadata.syllabus_url ? <LinkButton label={c.syllabusLink} onPress={() => void Linking.openURL(data.modules[0].metadata.syllabus_url).catch(() => undefined)} /> : null}
              <LinkButton label={m("learn.licensesOpen")} onPress={() => router.navigate("/csca/licenses")} testID="licenses-open" />
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}
