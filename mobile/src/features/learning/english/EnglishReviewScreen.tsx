// «Повторение ошибок» как на сайте (`review/page.tsx`, `ReviewRunner.tsx`): новая попытка заданий, где были ошибки; ответ проверяется
// сразу сервером (`learning_review_check_v1`), ничего не записывает; после проверки вместо формы формулировка и разбор. Модуль приходит
// из ссылки (`module`), без неё первый, как на сайте. Пустой банк - значок, «Повторять пока нечего» и «К урокам»; разобрали всё -
// «Разобрано: N из M» и «Все уроки».
import { router } from "expo-router";
import { Languages } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { checkEnglishReview } from "@/features/learning/english/api";
import { englishErrorText } from "@/features/learning/english/error-text";
import { ExerciseForm, ExplainPanel } from "@/features/learning/english/ExerciseForm";
import { emptyExerciseValue, exerciseValueComplete, exercisePrompt, exerciseValueToAnswer, type ExerciseValue } from "@/features/learning/english/exercise-value";
import { LessonPage } from "@/features/learning/english/LessonPage";
import { cscaFailure, type CscaFailure } from "@/features/learning/csca/api";
import { useEnglishModules, useEnglishReview } from "@/features/learning/queries-english";
import { SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardSkeleton, EmptyBlock, InlineAlert } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import type { LearningReviewCheck } from "@web/lib/portal/learning";

export function EnglishReviewScreen({ moduleId: requested = null }: { moduleId?: string | null }) {
  const { lang, m, t, format } = useLang();
  const { transport } = usePortalApi();
  const back = useBack("/english");
  const e = t("english");
  // Список модулей нужен, только когда ссылка не назвала модуль.
  const modules = useEnglishModules(requested === null);
  const moduleId = requested ?? modules.data?.[0]?.moduleId ?? null;
  const review = useEnglishReview(moduleId);
  const scroller = useRef<ScrollTarget>(null);
  const toTop = useCallback(() => scroller.current?.scrollTo({ y: 0, animated: false }), []);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<ExerciseValue | null>(null);
  const [result, setResult] = useState<{ check: LearningReviewCheck; answer: unknown } | null>(null);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CscaFailure | null>(null);
  const items = review.data ?? [];
  const counter = format(e.exerciseCounter, { n: String(Math.min(index + 1, Math.max(items.length, 1))), total: String(items.length) });
  // Веб после «Далее» переводит фокус на заголовок задания: читалка называет «Задание 2 из 5». Только при смене задания: когда банк
  // только пришёл (счётчик из «1 из 0» стал «1 из 5»), первое задание не объявляется.
  const announcedIndex = useRef(0);
  useEffect(() => {
    if (index === announcedIndex.current) return;
    announcedIndex.current = index;
    announce(counter);
  }, [index, counter]);
  // `busy` у общей кнопки прячет подпись «Сохраняем…»: читалке называем проверку сами.
  useEffect(() => {
    if (busy) announce(e.saving);
  }, [busy, e.saving]);
  const header = <SubHeader title={e.reviewTitle} onBack={back} backLabel={e.backToModule} testID="english-review-title" />;
  // Сбой чтения списка модулей важен, только когда модуль не пришёл в ссылке; модулей нет вовсе - повторять нечего, как на сайте.
  const failedToLoad = review.status === "error" || (requested === null && modules.status === "error");
  const noModules = requested === null && modules.isSuccess && modules.data.length === 0;
  if (!review.data && !noModules) {
    return (
      <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
        {failedToLoad ? <InlineAlert message={m(loadErrorKey(review.error ?? modules.error))} retryLabel={m("gate.retry")} onRetry={() => void review.refetch()} /> : <CardSkeleton label={m("state.loading")} lines={3} />}
      </LessonPage>
    );
  }
  if (items.length === 0) {
    return (
      <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
        <Card>
          <View testID="english-review-empty">
            <EmptyBlock icon={Languages} title={e.reviewEmptyTitle} body={e.reviewEmptyBody} action={<Button variant="ghost" label={e.reviewEmptyAction} onPress={() => router.navigate("/english")} testID="english-review-empty-action" />} />
          </View>
        </Card>
      </LessonPage>
    );
  }
  if (index >= items.length) {
    return (
      <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
        <Card>
          <Text variant="heading" accessibilityRole="header" testID="english-review-done">
            {format(e.reviewDone, { done: String(done), total: String(items.length) })}
          </Text>
          <Button label={e.backToModule} onPress={() => router.navigate("/english")} testID="english-review-back" />
        </Card>
      </LessonPage>
    );
  }
  const item = items[index];
  const form = value ?? emptyExerciseValue(item);
  const prompt = exercisePrompt(item, lang);
  async function check() {
    const answer = exerciseValueToAnswer(form);
    if (!answer || busy) return;
    setBusy(true);
    setError(null);
    try {
      const checked = await checkEnglishReview(transport, item.exerciseId, answer);
      setResult({ check: checked, answer });
      setDone((d) => d + 1);
      // Вердикт без поиска глазами: на iPhone живые области не работают (на сайте он идёт в строку состояния).
      announce(checked.verdict.correct ? e.verdictCorrect : e.verdictWrong);
    } catch (failure) {
      // Четыре кода сайта: конфликт, не принято, доступ закрыт, нет подтверждения (раньше любой сбой читался как «нет подтверждения»).
      setError(cscaFailure(failure));
    } finally {
      setBusy(false);
    }
  }
  const checkLabel = busy ? e.saving : e.answerButton;
  return (
    <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
      <Text variant="secondary" tone="text2">
        {e.reviewLead}
      </Text>
      <Text variant="secondary" tone="text2" bold accessibilityRole="header" testID="english-review-counter">
        {counter} · {format(e.reviewItemFrom, { n: String(item.lessonOrderIndex) })}
      </Text>
      {result ? (
        <View style={{ gap: 12 }}>
          {prompt ? (
            <Text variant="body" bold accessibilityLanguage={item.promptEn ? "en" : undefined} testID="english-review-prompt">
              {prompt}
            </Text>
          ) : null}
          <ExplainPanel exercise={item} verdict={result.check.verdict} explain={result.check.explain} answer={result.answer} />
        </View>
      ) : (
        <ExerciseForm key={item.exerciseId} exercise={item} value={form} disabled={busy} onChange={setValue} />
      )}
      {error ? <InlineAlert message={englishErrorText(e, error)} testID="english-review-error" /> : null}
      <View>
        {result ? (
          <Button
            label={e.nextButton}
            onPress={() => {
              setValue(null);
              setResult(null);
              setIndex((i) => i + 1);
              toTop();
            }}
            testID="english-review-next"
          />
        ) : (
          <Button label={checkLabel} accessibilityLabel={checkLabel} busy={busy} disabled={!exerciseValueComplete(item, form)} onPress={() => void check()} testID="english-review-check" />
        )}
      </View>
    </LessonPage>
  );
}
