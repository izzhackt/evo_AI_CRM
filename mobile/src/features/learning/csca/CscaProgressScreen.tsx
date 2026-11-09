// Прогресс (контракт §9): охват программы, серия дней по Бишкеку, темп, история тестов, банк ошибок,
// состояние тем. Прогресс видит только сам студент.
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";

import { loadErrorKey } from "@/api/queries";
import { cscaDayLabelSafe, cscaOnLabelSafe } from "@/features/learning/csca/format";
import { useCscaHome, useCscaProgress } from "@/features/learning/queries";
import { Chip, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function CscaProgressScreen() {
  const { lang, m, t } = useLang();
  const { tokens } = useTheme();
  const back = useBack("/csca");
  const c = t("csca");
  const progress = useCscaProgress();
  const home = useCscaHome(true);
  const data = progress.data;
  const header = <SubHeader title={c.progressTitle} onBack={back} backLabel={c.backToHome} testID="progress-title" />;
  if (!data) {
    return (
      <StackPage header={header} testID="progress-screen">
        {progress.status === "error" ? <InlineAlert message={m(loadErrorKey(progress.error))} retryLabel={m("gate.retry")} onRetry={() => void progress.refetch()} testID="progress-load-error" /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  const titles = Object.fromEntries((home.data?.topics ?? []).map((tp) => [tp.topicKey, lang === "ky" ? tp.metadata.title_ky : tp.metadata.title_ru]));
  const formTitles = Object.fromEntries((home.data?.tests ?? []).map((x) => [x.formKey, { id: x.formId, title: lang === "ky" ? x.metadata.title_ky : x.metadata.title_ru }]));
  const fmt = formatPortalString;
  return (
    <StackPage header={header} testID="progress-screen">
      <Text variant="secondary" tone="text2">
        {c.progressLead}
      </Text>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.coverageHeading}
        </Text>
        <Text variant="secondary" testID="progress-coverage">
          {fmt(c.coverageBody, { done: String(data.coverage.topicsWithCompletedLesson), total: String(data.coverage.topicsTotal) })}
        </Text>
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.streakHeading}
        </Text>
        <Text variant="secondary" testID="progress-streak">
          {fmt(c.streakCurrent, { count: String(data.streak.current) })} · {fmt(c.streakBest, { count: String(data.streak.best) })}
        </Text>
        <Text variant="caption" tone="text2">
          {c.streakNote}
        </Text>
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.paceHeading}
        </Text>
        <Text variant="secondary" testID="progress-pace">
          {data.pace.avgSeconds === null ? c.paceNone : fmt(c.paceBody, { avg: String(data.pace.avgSeconds), budget: String(data.pace.budgetSeconds) })}
        </Text>
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.testsHistoryHeading}
        </Text>
        {data.tests.length === 0 ? (
          <Text variant="secondary" tone="text2">
            {c.testsHistoryEmpty}
          </Text>
        ) : (
          data.tests.map((row) => {
            const form = formTitles[row.formKey];
            return (
              <Pressable
                key={row.attemptId}
                accessibilityRole="button"
                disabled={!form}
                onPress={() => form && router.navigate({ pathname: "/csca/test/[formId]", params: { formId: form.id, attempt: row.attemptId } })}
                testID={`history-${row.attemptId}`}
                style={{ gap: 2, paddingVertical: 8, borderTopWidth: 1, borderTopColor: tokens.line, minHeight: 44 }}
              >
                <Text variant="secondary" bold>
                  {form?.title ?? row.formKey} · {fmt(c.tallyLabel, { correct: String(row.correctCount), total: String(row.itemsTotal) })}
                </Text>
                <Text variant="caption" tone="text2">
                  {cscaDayLabelSafe(row.completedAt, lang)} · {c[`completion.${row.completion}`]}
                </Text>
              </Pressable>
            );
          })
        )}
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.bankHeading}
        </Text>
        <Text variant="secondary" testID="progress-bank">
          {fmt(c.bankBody, { due: String(data.review.dueCount), active: String(data.review.activeCount), retired: String(data.review.retiredCount) })}
        </Text>
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {c.byTopicHeading}
        </Text>
        {data.topics.map((tp) => (
          <View key={tp.topicKey} style={{ gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: tokens.line }}>
            <Text variant="secondary" bold>
              {titles[tp.topicKey] ?? tp.topicKey}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Chip tone={tp.state === "gap" ? "bad" : tp.state === "shaky" ? "warn" : tp.state === "confident" ? "ok" : "neutral"} label={c[`state.${tp.state}`]} />
              <Text variant="caption" tone="text2">
                {fmt(c.topicAnswers, { total: String(tp.answersTotal), correct: String(tp.correctTotal) })}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      <Text variant="caption" tone="text2">
        {cscaOnLabelSafe(data.today, lang, true)}
      </Text>
    </StackPage>
  );
}
