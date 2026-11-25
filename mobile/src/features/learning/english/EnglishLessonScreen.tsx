// Урок английского как на сайте (`lesson/[lessonId]/page.tsx`, `LessonRunner.tsx`): ссылка «Все уроки», фото темы, заголовок «Урок N.
// Название», затем «Перед началом» (цель и объяснение, кнопка «Начать урок» или «Продолжить»), только после неё задания по одному
// (ответ финален, после него вместо формы формулировка и разбор) и итог. Пройденный урок открывается сразу на итоге.
// Запись через EnglishSession (замороженные запросы).
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";

import type { LearningLessonView } from "@web/lib/portal/learning";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { englishErrorText } from "@/features/learning/english/error-text";
import { EnglishSession, type EnglishRunState } from "@/features/learning/english/english-session";
import { ExerciseForm, ExplainPanel } from "@/features/learning/english/ExerciseForm";
import { emptyExerciseValue, exerciseValueComplete, exercisePrompt, exerciseValueToAnswer, type ExerciseValue } from "@/features/learning/english/exercise-value";
import { ExerciseMeter, type MeterState } from "@/features/learning/english/ExerciseMeter";
import { LessonHero } from "@/features/learning/english/LessonCover";
import { LessonCompletion } from "@/features/learning/english/LessonCompletion";
import { LessonPage } from "@/features/learning/english/LessonPage";
import { useEnglishLesson } from "@/features/learning/queries-english";
import { SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Плашка ошибки для действия, которое упало: «Повторить» после обрыва, «Загрузить сохранённую попытку» после конфликта. */
type RenderAlert = (retry: () => void, reload?: () => void) => ReactNode;

/** Ошибка записи словами сайта (четыре кода веба). */
function LessonAlert({ state, onReload, onRetry }: { state: EnglishRunState; onReload: () => void; onRetry: () => void }) {
  const { t } = useLang();
  const e = t("english");
  const text = state.error ? englishErrorText(e, state.error) : "";
  // На iPhone плашка с ролью alert сама не озвучивается: ошибку называет читалке `announce`.
  useEffect(() => announce(text), [text]);
  if (!state.error) return null;
  return (
    <View style={{ gap: 6 }}>
      <InlineAlert message={text} testID="english-run-error" />
      {state.error === "conflict" || state.error === "already_answered" ? <Button variant="ghost" label={e.reloadDraft} onPress={onReload} testID="english-reload" /> : null}
      {state.error === "unavailable" ? <Button variant="ghost" label={e.retry} onPress={onRetry} testID="english-retry" /> : null}
    </View>
  );
}

/** «Перед началом»: цель плашкой, объяснение с примерами, «Начать урок» (создаёт черновик) или «Продолжить» (черновик уже есть). */
function LessonIntro({ view, state, onStart, alert }: { view: LearningLessonView; state: EnglishRunState; onStart: () => void; alert: RenderAlert }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const e = t("english");
  const meta = view.lesson.metadata;
  const label = state.busy ? e.saving : state.attemptId !== null ? e.continueLesson : e.startLesson;
  return (
    <Card>
      <View style={{ gap: 4, paddingHorizontal: 18, paddingVertical: 14, borderRadius: tokens.radiusItem, backgroundColor: tokens.accentSoft }}>
        <Text variant="caption" tone="text2" bold accessibilityRole="header" style={{ textTransform: "uppercase", letterSpacing: 0.8 }} testID="english-goal-heading">
          {e.goalHeading}
        </Text>
        <Text variant="body" testID="english-goal">
          {lang === "ky" ? meta.goal_ky : meta.goal_ru}
        </Text>
      </View>
      {/* Заголовок объяснения на сайте есть всегда, и у урока без теории тоже. */}
      <View style={{ gap: 12 }}>
        <Text variant="heading" accessibilityRole="header" testID="english-theory-heading">
          {e.theoryHeading}
        </Text>
        {view.lesson.theory.map((block, i) => (
          <View key={i} style={{ gap: 8 }}>
            <Text variant="body">{lang === "ky" ? block.text_ky : block.text_ru}</Text>
            {block.examples.length > 0 ? (
              <View style={{ borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusItem, backgroundColor: tokens.surface, overflow: "hidden" }}>
                {block.examples.map((example, k) => (
                  <View key={k} style={{ gap: 2, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: k === 0 ? 0 : 1, borderTopColor: tokens.line }}>
                    <Text variant="body" bold accessibilityLanguage="en">
                      {example.en}
                    </Text>
                    <Text variant="secondary" tone="text2">
                      {lang === "ky" ? example.ky : example.ru}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {alert(onStart)}
      {/* `busy` у общей кнопки прячет подпись: читалке имя «Сохраняем…» отдаём явно. */}
      <Button label={label} accessibilityLabel={label} busy={state.busy} onPress={onStart} testID="english-start" />
    </Card>
  );
}

/** Задания по одному: счётчик, полоса, форма, после ответа формулировка с разбором; когда ответили на все, шаг «Завершить урок». */
function LessonExercises({ view, session, state, onScrollTop, onFinished, alert }: { view: LearningLessonView; session: EnglishSession; state: EnglishRunState; onScrollTop: () => void; onFinished: () => void; alert: RenderAlert }) {
  const { lang, t, format } = useLang();
  const e = t("english");
  const exercises = view.lesson.exercises;
  const [value, setValue] = useState<ExerciseValue | null>(null);
  const total = exercises.length;
  const current = state.index < total ? exercises[state.index] : null;
  const answered = current ? state.answers[current.exerciseId] : undefined;
  const form = current ? (value ?? emptyExerciseValue(current)) : null;
  const counter = format(e.exerciseCounter, { n: String(Math.min(state.index + 1, total)), total: String(total) });
  // Веб после «Далее» переводит фокус на заголовок задания: читалка называет «Задание 3 из 8».
  const firstCounter = useRef(true);
  useEffect(() => {
    if (firstCounter.current) {
      firstCounter.current = false;
      return;
    }
    announce(counter);
  }, [counter]);
  // Веб (`reloadDraft`): после «Загрузить сохранённую попытку» выбор на экране сбрасывается, иначе в форме остался бы выбор из прежней попытки.
  const reload = () => {
    setValue(null);
    void session.reload();
  };
  // Дальше (обновить список, прокрутить) только когда сервер завершил урок: после отказа экран остаётся как был.
  const finish = () =>
    void session.finish().then((done) => {
      if (done) onFinished();
    });

  if (!current) {
    const label = state.busy ? e.saving : e.finishButton;
    return (
      <Card>
        <Text variant="heading" accessibilityRole="header" testID="english-finish-heading">
          {e.finishButton}
        </Text>
        <Text variant="secondary" tone="text2">
          {e.finishHint}
        </Text>
        {alert(finish, reload)}
        <Button label={label} accessibilityLabel={label} busy={state.busy} disabled={state.attemptId === null} onPress={finish} testID="english-finish" />
      </Card>
    );
  }
  const segments: MeterState[] = exercises.map((x, i) => {
    const a = state.answers[x.exerciseId];
    return a ? (a.correct ? "ok" : "bad") : i === state.index ? "current" : "todo";
  });
  const prompt = exercisePrompt(current, lang);
  const submit = async () => {
    const answer = form ? exerciseValueToAnswer(form) : null;
    if (!answer) return;
    await session.answer(answer);
    // Вердикт без поиска глазами: на iPhone живые области не работают, поэтому его называет `announce` (веб: строка состояния под счётчиком).
    const entry = session.getState().answers[current.exerciseId];
    if (entry) announce(entry.verdict.correct ? e.verdictCorrect : e.verdictWrong);
  };
  const answerLabel = state.busy ? e.saving : e.answerButton;
  return (
    <View style={{ gap: 12 }}>
      {/* Как на сайте: сначала счётчик, под ним полоса (она скрыта от читалки и повторяет счётчик). */}
      <View style={{ gap: 8 }}>
        <Text variant="secondary" tone="text2" accessibilityRole="header" testID="english-counter">
          {counter}
        </Text>
        <ExerciseMeter states={segments} testID="english-segments" />
      </View>
      {answered ? (
        // Веб заменяет форму формулировкой и разбором: выбранные варианты второй раз не показываются.
        <View style={{ gap: 12 }}>
          {prompt ? (
            <Text variant="body" bold accessibilityLanguage={current.promptEn ? "en" : undefined} testID="english-answered-prompt">
              {prompt}
            </Text>
          ) : null}
          <ExplainPanel exercise={current} verdict={answered.verdict} explain={answered.explain} answer={answered.answer} />
        </View>
      ) : (
        <ExerciseForm key={current.exerciseId} exercise={current} value={form as ExerciseValue} disabled={state.busy} onChange={setValue} />
      )}
      {alert(() => void submit(), reload)}
      {answered ? (
        <Button
          label={state.index + 1 < total ? e.nextButton : e.toCompletion}
          onPress={() => {
            setValue(null);
            session.next();
            onScrollTop();
          }}
          testID="english-next"
        />
      ) : (
        <Button label={answerLabel} accessibilityLabel={answerLabel} busy={state.busy} disabled={!(form && exerciseValueComplete(current, form))} onPress={() => void submit()} testID="english-answer" />
      )}
    </View>
  );
}

function LessonBody({ view, lessonId, onScrollTop }: { view: LearningLessonView; lessonId: string; onScrollTop: () => void }) {
  const { transport, userKey } = usePortalApi();
  const { lang, t, format } = useLang();
  const e = t("english");
  const client = useQueryClient();
  const [session] = useState(() => new EnglishSession(transport, lessonId, view.lesson.exercises, view.draft, view.latestCompleted));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  // Выход из урока ничем не заперт; закрытие экрана досылает один раз то, что отправлено без подтверждения (см. `dispose`).
  useEffect(() => () => session.dispose(), [session]);
  // `busy` у общей кнопки прячет подпись, а у веба «Сохраняем…» читается в строке состояния: называем сохранение читалке сами.
  useEffect(() => {
    if (state.busy) announce(e.saving);
  }, [state.busy, e.saving]);
  // Веб: черновик с ответами открывается сразу на заданиях; без ответов (и новый урок) начинается с «Перед началом».
  const [phase, setPhase] = useState<"intro" | "exercises">(view.draft && Object.keys(view.draft.answers).length > 0 ? "exercises" : "intro");
  const refresh = useCallback(() => {
    for (const name of ["english-modules", "english-review"]) void client.invalidateQueries({ queryKey: ["portal", userKey, name] });
  }, [client, userKey]);
  const start = useCallback(async () => {
    if (await session.begin()) {
      setPhase("exercises");
      onScrollTop();
      // Веб после «Начать урок» переводит фокус на заголовок первого задания: читалка называет его.
      announce(format(e.exerciseCounter, { n: String(Math.min(session.getState().index + 1, view.lesson.exercises.length)), total: String(view.lesson.exercises.length) }));
    }
  }, [session, onScrollTop, format, e.exerciseCounter, view.lesson.exercises.length]);
  const repeat = useCallback(() => {
    session.restart();
    setPhase("intro");
    onScrollTop();
    void start();
  }, [session, start, onScrollTop]);
  const finished = useCallback(() => {
    refresh();
    onScrollTop();
  }, [refresh, onScrollTop]);
  const alert: RenderAlert = (retry, reload) => <LessonAlert state={state} onReload={reload ?? (() => void session.reload())} onRetry={retry} />;
  const title = lang === "ky" ? view.lesson.metadata.title_ky : view.lesson.metadata.title_ru;
  return (
    <>
      {/* Порядок сайта: ссылка «Все уроки» (стрелка шапки), фото, заголовок «Урок N. Название». */}
      <LessonHero lessonKey={view.lesson.lessonKey} />
      <Text variant="title" accessibilityRole="header" testID="english-lesson-title">
        {format(e.lessonLabel, { n: String(view.lesson.orderIndex) })}. {title}
      </Text>
      {state.completed ? (
        <LessonCompletion
          view={view}
          state={state}
          onReview={() => router.navigate({ pathname: "/english/review", params: { module: view.module.moduleId } })}
          onRepeat={repeat}
          onBack={() => {
            refresh();
            router.navigate("/english");
          }}
        />
      ) : phase === "intro" ? (
        <LessonIntro view={view} state={state} onStart={() => void start()} alert={alert} />
      ) : (
        <LessonExercises view={view} session={session} state={state} onScrollTop={onScrollTop} onFinished={finished} alert={alert} />
      )}
    </>
  );
}

export function EnglishLessonScreen({ lessonId }: { lessonId: string }) {
  const { m, t } = useLang();
  const back = useBack("/english");
  const e = t("english");
  const lesson = useEnglishLesson(lessonId);
  const view = lesson.data;
  const scroller = useRef<ScrollTarget>(null);
  const toTop = useCallback(() => scroller.current?.scrollTo({ y: 0, animated: false }), []);
  return (
    <LessonPage header={<SubHeader title={e.title} onBack={back} backLabel={e.backToModule} testID="english-lesson-header" />} scrollRef={scroller} testID="english-lesson-screen">
      {!view ? (
        lesson.status === "error" ? (
          <InlineAlert message={m(loadErrorKey(lesson.error))} retryLabel={m("gate.retry")} onRetry={() => void lesson.refetch()} testID="english-lesson-error" />
        ) : (
          <CardSkeleton label={m("state.loading")} lines={4} />
        )
      ) : (
        <LessonBody key={view.lesson.lessonId} view={view} lessonId={lessonId} onScrollTop={toTop} />
      )}
    </LessonPage>
  );
}
