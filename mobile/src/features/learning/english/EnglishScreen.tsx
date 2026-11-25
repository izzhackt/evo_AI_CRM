// «Английский» как на сайте (`portal/english/page.tsx`): у каждого модуля название, «Пройдено уроков: N из M» с цельной полосой,
// «Повторить ошибки» (если в банке ошибок что-то есть) и «Тест по английскому»; под ними плитки уроков по две в ряд (4:3, номер,
// английская плашка темы), состояние только у начатого и пройденного урока. Описаний и пояснений в блоке модуля нет (веб убрал 03.11).
import { router } from "expo-router";
import { Pressable, View, useWindowDimensions } from "react-native";

import type { LearningLessonSummary, LearningModule } from "@web/lib/portal/learning";

import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { LessonTileCover } from "@/features/learning/english/LessonCover";
import { useEnglishModules, useEnglishReview } from "@/features/learning/queries-english";
import { Chip, SegmentBar } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const PAGE_PADDING = 16;
const TILE_GAP = 12;

function LessonTile({ lesson, width }: { lesson: LearningLessonSummary; width: number }) {
  const { lang, t, format } = useLang();
  const { tokens, scheme } = useTheme();
  const e = t("english");
  const title = lang === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru;
  // Веб: подпись состояния только у начатого и пройденного урока; «Верно: N из M» рядом с ней.
  const state = lesson.completed ? e.statusCompleted : lesson.draftAttemptId ? e.statusDraft : null;
  const last = lesson.lastResult ? format(e.lastResult, { correct: String(lesson.lastResult.correctCount), total: String(lesson.lastResult.exercisesTotal) }) : null;
  const stateText = state ? (last ? `${state} · ${last}` : state) : null;
  const count = format(e.exercisesCount, { count: String(lesson.exercisesTotal) });
  // Тень на внешнем блоке: на нажимаемом с `overflow: hidden` (углы фото) iOS обрезал бы её.
  return (
    <View testID={`english-tile-${lesson.lessonKey}`} style={{ width, borderRadius: tokens.radiusCard, backgroundColor: tokens.surface, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${format(e.lessonLabel, { n: String(lesson.orderIndex) })}. ${title}. ${count}${stateText ? `. ${stateText}` : ""}`}
        onPress={() => router.navigate({ pathname: "/english/lesson/[lessonId]", params: { lessonId: lesson.lessonId } })}
        testID={`english-lesson-${lesson.lessonKey}`}
        style={{ borderRadius: tokens.radiusCard, overflow: "hidden", borderWidth: 1, borderColor: tokens.line }}
      >
        <LessonTileCover lessonKey={lesson.lessonKey} orderIndex={lesson.orderIndex} done={lesson.completed} width={width} />
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 }}>
          <Text variant="secondary" bold>
            {title}
          </Text>
          <Text variant="tab" tone="text2">
            {count}
          </Text>
          {stateText ? <Chip tone={lesson.completed ? "ok" : "accent"} label={stateText} testID={`english-state-${lesson.lessonKey}`} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function ModuleBlock({ module }: { module: LearningModule }) {
  const { lang, t, format } = useLang();
  const e = t("english");
  const { width } = useWindowDimensions();
  // Веб: «Повторить ошибки» только когда банк ошибок не пуст; сбой чтения банка не роняет карту уроков.
  const review = useEnglishReview(module.moduleId);
  const hasReview = (review.data?.length ?? 0) > 0;
  const progress = format(e.progress, { done: String(module.lessonsCompleted), total: String(module.lessonsTotal) });
  const tile = Math.floor((width - 2 * PAGE_PADDING - TILE_GAP) / 2);
  const slots = Math.max(module.lessonsTotal, 1);
  return (
    <View style={{ gap: 16 }} testID={`english-module-${module.moduleKey}`}>
      <View style={{ gap: 8 }}>
        <Text variant="heading" accessibilityRole="header">
          {lang === "ky" ? module.metadata.title_ky : module.metadata.title_ru}
        </Text>
        <Text variant="secondary" tone="text2" testID="english-progress">
          {progress}
        </Text>
        <SegmentBar
          variant="continuous"
          testID="english-progress-bar"
          states={Array.from({ length: slots }, (_, i) => (i < module.lessonsCompleted ? "done" : "todo"))}
          summaryLabel={progress}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
          {hasReview ? <Button label={e.reviewEntry} onPress={() => router.navigate({ pathname: "/english/review", params: { module: module.moduleId } })} testID="english-review-open" /> : null}
          <Button variant="ghost" label={e.testEntry} onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "english36" } })} testID="english-test-open" />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP }}>
        {module.lessons.map((lesson) => (
          <LessonTile key={lesson.lessonId} lesson={lesson} width={tile} />
        ))}
      </View>
    </View>
  );
}

export function EnglishScreen() {
  const { m, t } = useLang();
  const e = t("english");
  useRefetchOnFocus();
  const modules = useEnglishModules();
  const list = modules.data;
  return (
    <Screen topInset={false} tabBar onRefresh={() => void modules.refetch()} refreshing={modules.isRefetching}>
      <View style={{ gap: 16 }} testID="english-screen">
        <Text variant="display" accessibilityRole="header" testID="title-english">
          {e.title}
        </Text>
        {!list ? (
          modules.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(modules.error))} retryLabel={m("gate.retry")} onRetry={() => void modules.refetch()} testID="english-error" />
          ) : (
            <CardSkeleton label={m("state.loading")} lines={4} />
          )
        ) : list.length === 0 ? (
          <Card>
            <Text variant="heading">{e.emptyTitle}</Text>
            <Text variant="secondary" tone="text2">
              {e.emptyBody}
            </Text>
          </Card>
        ) : (
          list.map((module) => <ModuleBlock key={module.moduleId} module={module} />)
        )}
      </View>
    </Screen>
  );
}
