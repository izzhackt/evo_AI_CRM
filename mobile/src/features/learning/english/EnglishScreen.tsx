// «Английский» как на сайте (`portal/english/page.tsx`): у каждого модуля название, «Пройдено уроков: N из M» с цельной полосой,
// «Повторить ошибки» (если в банке ошибок что-то есть) и «Тест по английскому»; под ними плитки уроков по две в ряд (4:3, номер,
// английская плашка темы), состояние только у начатого и пройденного урока. Описаний и пояснений в блоке модуля нет (веб убрал 03.11).
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Languages } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { LearningLessonSummary, LearningModule } from "@web/lib/portal/learning";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { LessonTileCover } from "@/features/learning/english/LessonCover";
import { useEnglishModules, useEnglishReview } from "@/features/learning/queries-english";
import { SegmentBar } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const TILE_GAP = 12;

/** Подпись состояния плитки: нейтральный чип сайта (`.pt-chip`: фон страницы, линия, 12 pt на телефоне); цвета состояния у веба нет. */
function StateChip({ label, testID }: { label: string; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} style={{ alignSelf: "flex-start", minHeight: 26, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 2, borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusChip, backgroundColor: tokens.bg }}>
      <Text variant="tab" tone="text2">
        {label}
      </Text>
    </View>
  );
}

/**
 * Плитка: один растянутый по ряду блок несёт рамку, фон и тень, нажимаемая область заполняет его целиком. Раньше рамку нёс только
 * внутренний блок без растяжения, и у плитки ниже соседа под рамкой оставалась полоса фона и тени. Углы фото режет внутренний блок
 * (`overflow: hidden`), тень снаружи: на одном блоке iOS обрезал бы тень.
 */
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
  return (
    <View
      testID={`english-tile-${lesson.lessonKey}`}
      style={{ width, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${format(e.lessonLabel, { n: String(lesson.orderIndex) })}. ${title}. ${count}${stateText ? `. ${stateText}` : ""}`}
        onPress={() => router.navigate({ pathname: "/english/lesson/[lessonId]", params: { lessonId: lesson.lessonId } })}
        testID={`english-lesson-${lesson.lessonKey}`}
        style={{ flexGrow: 1, borderRadius: tokens.radiusCard - 1, overflow: "hidden" }}
      >
        <LessonTileCover lessonKey={lesson.lessonKey} orderIndex={lesson.orderIndex} done={lesson.completed} width={width} />
        <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 4 }}>
          <Text variant="secondary" bold>
            {title}
          </Text>
          <Text variant="caption" tone="text2">
            {count}
          </Text>
          {stateText ? <StateChip label={stateText} testID={`english-state-${lesson.lessonKey}`} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

/** Две плитки в ряд: ширина берётся у самого блока (поля экрана не зашиты числом), до первого замера плиток нет. */
function LessonGrid({ lessons }: { lessons: readonly LearningLessonSummary[] }) {
  const [width, setWidth] = useState(0);
  const tile = Math.floor((width - TILE_GAP) / 2);
  return (
    <View testID="english-grid" onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP }}>
      {tile > 0 ? lessons.map((lesson) => <LessonTile key={lesson.lessonId} lesson={lesson} width={tile} />) : null}
    </View>
  );
}

function ModuleBlock({ module }: { module: LearningModule }) {
  const { lang, t, format } = useLang();
  const e = t("english");
  // Веб: «Повторить ошибки» только когда банк ошибок не пуст; сбой чтения банка не роняет карту уроков.
  const review = useEnglishReview(module.moduleId);
  const hasReview = (review.data?.length ?? 0) > 0;
  const progress = format(e.progress, { done: String(module.lessonsCompleted), total: String(module.lessonsTotal) });
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
        {/* Кнопки в одной строке поровну: когда банк ошибок прочитан и появляется вторая, строка не переносится и плитки не сдвигаются вниз. */}
        <View testID="english-module-actions" style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
          {hasReview ? <Button label={e.reviewEntry} onPress={() => router.navigate({ pathname: "/english/review", params: { module: module.moduleId } })} style={{ flex: 1 }} testID="english-review-open" /> : null}
          <Button variant="ghost" label={e.testEntry} onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "english36" } })} style={{ flex: 1 }} testID="english-test-open" />
        </View>
      </View>
      <LessonGrid lessons={module.lessons} />
    </View>
  );
}

export function EnglishScreen() {
  const { m, t } = useLang();
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  const e = t("english");
  useRefetchOnFocus();
  const modules = useEnglishModules();
  const [pulling, setPulling] = useState(false);
  // Потянуть вниз обновляет и список, и банки ошибок модулей (у каждого свой запрос), иначе кнопка «Повторить ошибки» отстала бы.
  const refresh = () => {
    setPulling(true);
    void Promise.all([modules.refetch(), client.refetchQueries({ queryKey: ["portal", userKey, "english-review"] })])
      .catch(() => undefined)
      .finally(() => setPulling(false));
  };
  const list = modules.data;
  return (
    <Screen topInset={false} tabBar onRefresh={refresh} refreshing={pulling}>
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
            <EmptyBlock icon={Languages} title={e.emptyTitle} body={e.emptyBody} />
          </Card>
        ) : (
          list.map((module) => <ModuleBlock key={module.moduleId} module={module} />)
        )}
      </View>
    </Screen>
  );
}
