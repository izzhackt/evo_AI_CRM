// «Тесты»: каталог (английский 36 заданий, интересы ORVIS 92 утверждения) и история попыток
// (как веб /portal/tests). Новая попытка не заменяет прошлый результат.
import { router } from "expo-router";
import { View } from "react-native";

import type { StudentAssessmentKey } from "@web/lib/student-assessment-contract";

import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { useAssessmentCatalog } from "@/features/learning/tests/queries";
import { cscaDayLabelSafe } from "@/features/learning/csca/format";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { TAB_BAR_CLEARANCE } from "@/shell/TabBar";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function openAssessment(key: StudentAssessmentKey, attempt?: string) {
  router.navigate({ pathname: "/tests/[key]", params: attempt ? { key, attempt } : { key } });
}

export function TestsScreen() {
  const { lang, m, t, format } = useLang();
  const s = t("tests");
  useRefetchOnFocus();
  const catalog = useAssessmentCatalog();
  const data = catalog.data;
  return (
    <Screen topInset={false} bottomInset={TAB_BAR_CLEARANCE} onRefresh={() => void catalog.refetch()} refreshing={catalog.isRefetching}>
      <View style={{ gap: 16 }} testID="tests-screen">
        <Text variant="display" accessibilityRole="header" testID="title-tests">
          {s.title}
        </Text>
        {!data ? (
          catalog.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(catalog.error))} retryLabel={m("gate.retry")} onRetry={() => void catalog.refetch()} testID="tests-error" />
          ) : (
            <CardSkeleton label={m("state.loading")} lines={3} />
          )
        ) : data.instruments.length === 0 ? (
          <Card>
            <Text variant="heading">{s.emptyTitle}</Text>
            <Text variant="secondary" tone="text2">
              {s.emptyBody}
            </Text>
          </Card>
        ) : (
          <>
            {data.instruments.map((i) => {
              const attempts = data.attempts.filter((a) => a.instrumentKey === i.instrumentKey);
              const draft = i.draftAttemptId ? attempts.find((a) => a.attemptId === i.draftAttemptId) : null;
              const status = draft ? format(s.cardDraft, { answered: String(draft.answeredCount), total: String(draft.questionCount) }) : i.latestCompletedAttemptId ? s.cardCompleted : s.cardNew;
              return (
                <Card key={i.instrumentKey}>
                  <Text variant="heading" accessibilityRole="header">
                    {i.metadata.title}
                  </Text>
                  <Text variant="secondary" tone="text2">
                    {i.metadata.description}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Chip tone={i.latestCompletedAttemptId && !draft ? "ok" : draft ? "accent" : "neutral"} label={status} />
                    <Text variant="caption" tone="text2">
                      {format(t("csca").testItems, { count: String(i.questionCount) })}
                    </Text>
                  </View>
                  <Text variant="caption" tone="text2">
                    {s.cardMeta}
                  </Text>
                  <View style={{ gap: 8 }}>
                    {draft ? <Button label={s.cardContinue} onPress={() => openAssessment(i.instrumentKey)} testID={`assessment-continue-${i.instrumentKey}`} /> : null}
                    {i.latestCompletedAttemptId ? <Button variant={draft ? "ghost" : "primary"} label={s.cardOpenResult} onPress={() => openAssessment(i.instrumentKey, i.latestCompletedAttemptId as string)} testID={`assessment-result-${i.instrumentKey}`} /> : null}
                    {!draft ? <Button variant={i.latestCompletedAttemptId ? "ghost" : "primary"} label={i.latestCompletedAttemptId ? s.cardRetake : s.cardStart} onPress={() => openAssessment(i.instrumentKey)} testID={`assessment-start-${i.instrumentKey}`} /> : null}
                  </View>
                </Card>
              );
            })}
            <Card>
              <Text variant="heading" accessibilityRole="header">
                {s.historyHeading}
              </Text>
              <Text variant="caption" tone="text2">
                {s.historyNote}
              </Text>
              {data.attempts.filter((a) => a.status === "completed").length === 0 ? (
                <Text variant="secondary" tone="text2" testID="tests-history-empty">
                  {s.historyEmpty}
                </Text>
              ) : (
                data.attempts.filter((a) => a.status === "completed").map((a) => (
                  <View key={a.attemptId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="secondary" bold>
                        {a.instrumentKey === "english36" ? s.historyEnglish : s.historyCareer}
                      </Text>
                      <Text variant="caption" tone="text2">
                        {a.completedAt ? cscaDayLabelSafe(a.completedAt, lang) : ""}
                      </Text>
                    </View>
                    <Button variant="ghost" label={s.cardOpenResult} onPress={() => openAssessment(a.instrumentKey, a.attemptId)} testID={`history-${a.attemptId}`} />
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}
