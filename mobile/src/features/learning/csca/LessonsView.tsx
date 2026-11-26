// Вкладка «Занятия» CSCA как на вебе (src/components/portal/csca/LessonsView.tsx, разгрузка 03.11.2026): следующий шаг
// со значками, три плитки-ссылки, тесты на время и программа по модулям (модуль раскрывается, тема одна строка с
// кнопками урока и практики). Описаний, «Верно N из M последних» и легенды на экране нет, как и на вебе.
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { sessionLabels } from "@web/components/portal/csca/session-labels";
import type { CscaHome, CscaModule } from "@web/lib/portal/csca";

import { Disclosure } from "@/features/learning/csca/Disclosure";
import {
  nextStepModel,
  programSections,
  statTiles,
  testRowModel,
  type NextStepTarget,
  type ProgramSection,
  type StatTiles,
  type TestRowModel,
} from "@/features/learning/csca/home-model";
import { Meter } from "@/features/learning/csca/Meter";
import { MetaChip } from "@/features/learning/csca/MetaChip";
import { StateChip, TopicStrip } from "@/features/learning/csca/StateChip";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function openNextStep(target: NextStepTarget) {
  if (target.kind === "test") router.navigate({ pathname: "/csca/test/[formId]", params: { formId: target.formId } });
  else if (target.kind === "lesson") router.navigate({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: target.lessonId } });
  else router.navigate("/csca/review");
}

/** Поверхность без внутренних полей: модуль программы с заголовком и строками до края. */
function Panel({ children, testID }: { children: ReactNode; testID?: string }) {
  const { tokens, scheme } = useTheme();
  return (
    <View
      testID={testID}
      style={{ backgroundColor: tokens.surface, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
    >
      {children}
    </View>
  );
}

function NextStepCard({ home }: { home: CscaHome }) {
  const { lang, t } = useLang();
  const c = t("csca");
  const model = nextStepModel(home, lang, c);
  const action = model.action;
  // «Следующий шаг» входит в сам заголовок без ярлыка над ним: это шаг занятий, а не название раздела.
  return (
    <Card>
      <Text variant="title" accessibilityRole="header" testID="next-step-title">
        <Text variant="title" tone="text2" style={{ fontFamily: sansFont("medium") }}>
          {c.nextStepLabel}:{" "}
        </Text>
        {model.title}
      </Text>
      <Text variant="body">{model.why}</Text>
      {model.meta.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} testID="next-step-meta">
          {model.meta.map((entry) => (
            <MetaChip key={entry} label={entry} />
          ))}
        </View>
      ) : null}
      {action ? <Button label={action.label} onPress={() => openNextStep(action.target)} testID="next-step-action" /> : null}
    </Card>
  );
}

function Tile({ head, value, unit, note, label, hint, onPress, testID, children }: { head: string; value: string; unit?: string; note: string; label: string; hint: string; onPress: () => void; testID: string; children?: ReactNode }) {
  const { tokens, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      testID={testID}
      style={{ gap: 6, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text variant="secondary" bold>
          {head}
        </Text>
        <ArrowRight size={16} strokeWidth={1.5} color={tokens.text2} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <Text variant="display" style={{ fontSize: 40, lineHeight: 40, letterSpacing: -0.8 }}>
          {value}
        </Text>
        {unit ? (
          <Text variant="body" tone="text2" bold>
            {unit}
          </Text>
        ) : null}
      </View>
      <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: tokens.bg }}>
        <Text variant="caption" tone="text2" style={{ fontFamily: sansFont("medium") }}>
          {note}
        </Text>
      </View>
      {children}
    </Pressable>
  );
}

/**
 * Три плитки под следующим шагом, каждая ведёт в свой раздел: темы (прогресс), ошибки к повторению, ближайший экзамен
 * (календарь сессий во вкладке «Об экзамене»).
 */
function Tiles({ home, onOpenExam }: { home: CscaHome; onOpenExam: () => void }) {
  const { lang, t } = useLang();
  const c = t("csca");
  const labels = useMemo(() => sessionLabels(home.sessions, lang, c, { serverNow: home.serverNow, today: home.today }), [home.sessions, home.serverNow, home.today, lang, c]);
  const tiles: StatTiles = statTiles(home, labels, lang, c);
  const exam = tiles.exam;
  return (
    <View style={{ gap: 16 }} testID="csca-tiles">
      <Tile
        head={c["tile.topics"]}
        value={String(tiles.topics.done)}
        unit={`/ ${tiles.topics.total}`}
        note={c["tile.topicsNote"]}
        label={`${c["tile.topics"]}: ${tiles.topics.done} / ${tiles.topics.total}. ${c["tile.topicsNote"]}`}
        hint={c.progressTitle}
        onPress={() => router.navigate("/csca/progress")}
        testID="tile-topics"
      >
        <Meter ratio={tiles.topics.ratio} />
      </Tile>
      <Tile
        head={c.reviewHeading}
        value={String(tiles.review.due)}
        note={c["tile.reviewNote"]}
        label={`${c.reviewHeading}: ${tiles.review.due}. ${c["tile.reviewNote"]}`}
        hint={c.reviewTitle}
        onPress={() => router.navigate("/csca/review")}
        testID="tile-review"
      />
      <Tile
        head={c["tile.exam"]}
        value={exam.kind === "none" ? "·" : exam.value}
        unit={exam.kind === "days" ? exam.unit : undefined}
        note={exam.note}
        label={exam.kind === "none" ? `${c["tile.exam"]}. ${exam.note}` : `${c["tile.exam"]}: ${exam.value}${exam.kind === "days" ? ` ${exam.unit}` : ""}. ${exam.note}`}
        hint={c.sessionsHeading}
        onPress={onOpenExam}
        testID="tile-exam"
      />
    </View>
  );
}

function TestRow({ row, first }: { row: TestRowModel; first: boolean }) {
  const { tokens } = useTheme();
  const last = row.last;
  return (
    <View style={{ gap: 8, paddingTop: first ? 0 : 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }} testID={`test-row-${row.formKey}`}>
      <View style={{ gap: 2 }}>
        <Text variant="body" bold>
          {row.title}
        </Text>
        <Text variant="secondary" tone="text2">
          {row.meta}
        </Text>
        {last ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.navigate({ pathname: "/csca/test/[formId]", params: { formId: row.formId, attempt: last.attemptId } })}
            testID={`test-last-${row.formKey}`}
            style={{ minHeight: MIN_TARGET, justifyContent: "center" }}
          >
            <Text variant="secondary" bold style={{ textDecorationLine: "underline", textDecorationColor: tokens.controlEdge }}>
              {last.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Button
        variant="ghost"
        label={row.actionLabel}
        onPress={() => router.navigate({ pathname: "/csca/test/[formId]", params: { formId: row.formId } })}
        testID={`test-open-${row.formKey}`}
      />
    </View>
  );
}

function TestsPanel({ home }: { home: CscaHome }) {
  const { lang, t } = useLang();
  const c = t("csca");
  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {c.testsHeading}
      </Text>
      {home.tests.map((test, index) => (
        <TestRow key={test.formId} row={testRowModel(test, lang, c)} first={index === 0} />
      ))}
    </Card>
  );
}

/** Тема одна строка: название, слово состояния, по кнопке на урок и практику. */
function TopicRow({ entry, first }: { entry: ProgramSection["rich"][number]; first: boolean }) {
  const { tokens } = useTheme();
  return (
    <View testID={`topic-${entry.topic.topicKey}`} style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }}>
      <View style={{ gap: 4 }}>
        <Text variant="secondary" bold>
          {entry.title}
        </Text>
        <StateChip state={entry.topic.state} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {entry.lessons.map((lesson) => (
          <Pressable
            key={lesson.lessonId}
            accessibilityRole="button"
            onPress={() => router.navigate({ pathname: "/csca/lesson/[lessonId]", params: { lessonId: lesson.lessonId } })}
            testID={`lesson-${lesson.lessonKey}`}
            style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.controlEdge, backgroundColor: tokens.surface }}
          >
            <Text variant="caption" bold>
              {lesson.kindLabel}
            </Text>
            <Text variant="caption" tone={lesson.done ? "ok" : "text2"} style={{ fontFamily: sansFont("medium") }}>
              {lesson.meta}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function QuietTopics({ section }: { section: ProgramSection }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  if (section.quiet.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: tokens.line }}>
      <Disclosure
        testID={`quiet-${section.section}`}
        headerTestID={`quiet-toggle-${section.section}`}
        header={
          <Text variant="secondary" tone="text2" style={{ fontFamily: sansFont("medium") }}>
            {format(c.quietTopics, { count: String(section.quiet.length) })}
          </Text>
        }
      >
        <View style={{ paddingBottom: 8 }}>
          {section.quiet.map(({ topic, title }) => (
            <View key={topic.topicKey} testID={`topic-${topic.topicKey}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4, paddingVertical: 8 }}>
              <Text variant="secondary" style={{ flexShrink: 1 }}>
                {title}
              </Text>
              {topic.state !== "not_started" ? <StateChip state={topic.state} /> : null}
            </View>
          ))}
        </View>
      </Disclosure>
    </View>
  );
}

function ModulePanel({ section }: { section: ProgramSection }) {
  const { tokens } = useTheme();
  return (
    <Panel testID={`module-${section.section}`}>
      <Disclosure
        defaultOpen={section.initiallyOpen}
        minHeight={64}
        headerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        headerTestID={`module-toggle-${section.section}`}
        header={
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
              <Text variant="caption" tone="text2" bold>
                {section.label}
              </Text>
              <Text variant="body" bold style={{ flex: 1, flexShrink: 1 }}>
                {section.title}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <Text variant="caption" tone="text2">
                {section.doneLabel}
              </Text>
              <TopicStrip states={section.states} />
            </View>
          </View>
        }
      >
        <View style={{ borderTopWidth: 1, borderTopColor: tokens.line }}>
          {section.rich.map((entry, index) => (
            <TopicRow key={entry.topic.topicKey} entry={entry} first={index === 0} />
          ))}
          <QuietTopics section={section} />
        </View>
      </Disclosure>
    </Panel>
  );
}

/** Программа по модулям: открыт тот, где следующий шаг; темы без уроков одной строкой внутри модуля. */
function Program({ home, track }: { home: CscaHome; track: CscaModule }) {
  const { lang, t } = useLang();
  const c = t("csca");
  const sections = programSections(home, track, lang, c);
  return (
    <View style={{ gap: 12 }} testID="csca-program">
      <Text variant="title" accessibilityRole="header">
        {c.topicsHeading}
      </Text>
      {sections.map((section) => (
        <ModulePanel key={section.section} section={section} />
      ))}
    </View>
  );
}

export function LessonsView({ home, track, onOpenExam }: { home: CscaHome; track: CscaModule; onOpenExam: () => void }) {
  return (
    <View style={{ gap: 20 }} testID="csca-lessons">
      <NextStepCard home={home} />
      <Tiles home={home} onOpenExam={onOpenExam} />
      {home.tests.length > 0 ? <TestsPanel home={home} /> : null}
      <Program home={home} track={track} />
    </View>
  );
}
