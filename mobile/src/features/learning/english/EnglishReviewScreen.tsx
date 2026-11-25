// «Повторение ошибок»: новая попытка заданий, где были ошибки; ответ проверяется сразу сервером
// (`learning_review_check_v1`), ничего не записывает. Модуль приходит из ссылки (`module`), без неё первый, как на сайте.
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { checkEnglishReview } from "@/features/learning/english/api";
import { ExerciseForm, ExplainPanel } from "@/features/learning/english/ExerciseForm";
import { emptyExerciseValue, exerciseValueComplete, exerciseValueToAnswer, type ExerciseValue } from "@/features/learning/english/exercise-value";
import { LessonPage } from "@/features/learning/english/LessonPage";
import { useEnglishModules, useEnglishReview } from "@/features/learning/queries-english";
import { SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, type ScrollTarget } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import type { LearningReviewCheck } from "@web/lib/portal/learning";

export function EnglishReviewScreen({ moduleId: requested = null }: { moduleId?: string | null }) {
  const { m, t, format } = useLang();
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
  const [failed, setFailed] = useState(false);
  const items = review.data ?? [];
  const counter = format(e.exerciseCounter, { n: String(Math.min(index + 1, Math.max(items.length, 1))), total: String(items.length) });
  // Веб после «Далее» переводит фокус на заголовок задания: читалка называет «Задание 2 из 5».
  const firstCounter = useRef(true);
  useEffect(() => {
    if (firstCounter.current) {
      firstCounter.current = false;
      return;
    }
    announce(counter);
  }, [counter]);
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
  if (items.length === 0 || index >= items.length) {
    return (
      <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
        <Card>
          <Text variant="heading" testID="english-review-empty">
            {items.length === 0 ? e.reviewEmptyTitle : format(e.reviewDone, { done: String(done), total: String(items.length) })}
          </Text>
          {items.length === 0 ? (
            <Text variant="secondary" tone="text2">
              {e.reviewEmptyBody}
            </Text>
          ) : null}
          <Button label={e.reviewEmptyAction} onPress={() => router.navigate("/english")} />
        </Card>
      </LessonPage>
    );
  }
  const item = items[index];
  const form = value ?? emptyExerciseValue(item);
  async function check() {
    const answer = exerciseValueToAnswer(form);
    if (!answer || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const checked = await checkEnglishReview(transport, item.exerciseId, answer);
      setResult({ check: checked, answer });
      setDone((d) => d + 1);
      // Вердикт без поиска глазами: на iPhone живые области не работают (на сайте он идёт в строку состояния).
      announce(checked.verdict.correct ? e.verdictCorrect : e.verdictWrong);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <LessonPage header={header} scrollRef={scroller} testID="english-review-screen">
      <Text variant="secondary" tone="text2">
        {e.reviewLead}
      </Text>
      <Text variant="caption" tone="text2" bold>
        {format(e.reviewItemFrom, { n: String(item.lessonOrderIndex) })} · {counter}
      </Text>
      <ExerciseForm key={item.exerciseId} exercise={item} value={form} disabled={result !== null || busy} onChange={setValue} />
      {result ? <ExplainPanel exercise={item} verdict={result.check.verdict} explain={result.check.explain} answer={result.answer} /> : null}
      {failed ? <InlineAlert message={e.errorUnavailable} testID="english-review-error" /> : null}
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
          <Button label={busy ? e.saving : e.answerButton} busy={busy} disabled={!exerciseValueComplete(item, form)} onPress={() => void check()} testID="english-review-check" />
        )}
      </View>
    </LessonPage>
  );
}
