// «Английский»: модуль и плитки уроков с обложками (как веб /portal/english): прогресс «N из M»,
// «Повторить ошибки» (если есть ошибки), «Тест по английскому». Без XP и серий.
import { router } from "expo-router";
import { Image, Pressable, View } from "react-native";

import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { LESSON_COVERS } from "@/features/learning/english/covers";
import { useEnglishModules } from "@/features/learning/queries-english";
import { Chip, SegmentBar } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function EnglishScreen() {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const e = t("english");
  useRefetchOnFocus();
  const modules = useEnglishModules();
  const module = modules.data?.[0] ?? null;
  const hasMistakes = module?.lessons.some((l) => l.lastResult !== null && l.lastResult.correctCount < l.lastResult.exercisesTotal) ?? false;
  return (
    <Screen topInset={false} tabBar onRefresh={() => void modules.refetch()} refreshing={modules.isRefetching}>
      <View style={{ gap: 16 }} testID="english-screen">
        <Text variant="display" accessibilityRole="header" testID="title-english">
          {e.title}
        </Text>
        {!module ? (
          modules.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(modules.error))} retryLabel={m("gate.retry")} onRetry={() => void modules.refetch()} testID="english-error" />
          ) : modules.status === "success" ? (
            <Card>
              <Text variant="heading">{e.emptyTitle}</Text>
              <Text variant="secondary" tone="text2">
                {e.emptyBody}
              </Text>
            </Card>
          ) : (
            <CardSkeleton label={m("state.loading")} lines={4} />
          )
        ) : (
          <>
            <Card>
              <Text variant="heading" accessibilityRole="header">
                {lang === "ky" ? module.metadata.title_ky : module.metadata.title_ru}
              </Text>
              <Text variant="secondary" tone="text2">
                {lang === "ky" ? module.metadata.level_note_ky : module.metadata.level_note_ru}
              </Text>
              <Text variant="secondary" bold testID="english-progress">
                {format(e.progress, { done: String(module.lessonsCompleted), total: String(module.lessonsTotal) })}
              </Text>
              <SegmentBar states={module.lessons.map((l) => (l.completed ? "done" : "todo"))} />
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {hasMistakes ? <Button variant="ghost" label={e.reviewEntry} onPress={() => router.navigate("/english/review")} testID="english-review-open" /> : null}
                <Button variant="ghost" label={e.testEntry} onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "english36" } })} testID="english-test-open" />
              </View>
              <Text variant="caption" tone="text2">
                {e.testEntryHint}
              </Text>
            </Card>
            {module.lessons.map((lesson) => {
              const cover = LESSON_COVERS[lesson.lessonKey];
              const status = lesson.completed ? e.statusCompleted : lesson.draftAttemptId ? e.statusDraft : e.statusNew;
              return (
                <Pressable
                  key={lesson.lessonId}
                  accessibilityRole="button"
                  accessibilityLabel={`${format(e.lessonLabel, { n: String(lesson.orderIndex) })}. ${lang === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru}. ${status}`}
                  onPress={() => router.navigate({ pathname: "/english/lesson/[lessonId]", params: { lessonId: lesson.lessonId } })}
                  testID={`english-lesson-${lesson.lessonKey}`}
                  style={{ borderRadius: tokens.radiusCard, overflow: "hidden", borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
                >
                  {cover ? (
                    <View>
                      <Image source={cover.photo} accessibilityIgnoresInvertColors style={{ width: "100%", height: 120 }} resizeMode="cover" />
                      <View style={{ position: "absolute", left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: tokens.radiusChip, backgroundColor: "rgba(0,0,0,0.6)" }}>
                        <Text variant="caption" tone="onAccent" bold accessibilityLanguage="en">
                          {cover.label}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={{ padding: 12, gap: 4 }}>
                    <Text variant="caption" tone="text2" bold>
                      {format(e.lessonLabel, { n: String(lesson.orderIndex) })}
                    </Text>
                    <Text variant="body" bold>
                      {lang === "ky" ? lesson.metadata.title_ky : lesson.metadata.title_ru}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Chip tone={lesson.completed ? "ok" : lesson.draftAttemptId ? "accent" : "neutral"} label={status} />
                      <Text variant="caption" tone="text2">
                        {format(e.exercisesCount, { count: String(lesson.exercisesTotal) })}
                        {lesson.lastResult ? ` · ${format(e.lastResult, { correct: String(lesson.lastResult.correctCount), total: String(lesson.lastResult.exercisesTotal) })}` : ""}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
      </View>
    </Screen>
  );
}
