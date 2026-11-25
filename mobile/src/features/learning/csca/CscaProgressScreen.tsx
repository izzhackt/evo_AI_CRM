// Прогресс (контракт §9; веб: math/progress/page.tsx): охват программы с полосой, серия дней по Бишкеку, темп против
// ориентира экзамена, банк ошибок со ссылкой «Повторить ошибки», темы по модулям программы, история тестов и подпись о том,
// что итог это оценка EVO, а не балл CSCA. Прогресс видит только сам студент.
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { loadErrorKey } from "@/api/queries";
import { Meter, PaceMeter } from "@/features/learning/csca/Meter";
import { historyRows, paceFill, progressSections } from "@/features/learning/csca/progress-model";
import { CSCA_TOPICS_FALLBACK } from "@/features/learning/csca/routes";
import { StateChip, TopicStrip } from "@/features/learning/csca/StateChip";
import { useCscaHome, useCscaProgress } from "@/features/learning/queries";
import { StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { CardSkeleton, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function OverviewItem({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Text variant="caption" tone="text2" bold accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function CscaProgressScreen() {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const back = useBack(CSCA_TOPICS_FALLBACK);
  const c = t("csca");
  const progress = useCscaProgress();
  const home = useCscaHome(true);
  const data = progress.data;
  const header = <SubHeader title={c.progressTitle} onBack={back} backLabel={c.backToHome} testID="progress-title" />;
  const lead = (
    <Text variant="secondary" tone="text2">
      {c.progressLead}
    </Text>
  );
  if (!data) {
    return (
      <StackPage header={header} testID="progress-screen">
        {lead}
        {progress.status === "error" ? <InlineAlert message={m(loadErrorKey(progress.error))} retryLabel={m("gate.retry")} onRetry={() => void progress.refetch()} testID="progress-load-error" /> : <CardSkeleton label={m("state.loading")} lines={4} />}
      </StackPage>
    );
  }
  const sections = progressSections(data, home.data, lang, c);
  const history = historyRows(data, home.data, lang, c);
  const { coverage, streak, pace, review } = data;
  return (
    <StackPage header={header} testID="progress-screen">
      {lead}
      <Card>
        <View style={{ gap: 20 }}>
          <OverviewItem title={c.coverageHeading}>
            <Text variant="body" style={{ fontFamily: sansFont("medium") }} testID="progress-coverage">
              {format(c.coverageBody, { done: String(coverage.topicsWithCompletedLesson), total: String(coverage.topicsTotal) })}
            </Text>
            <Meter ratio={coverage.topicsTotal > 0 ? coverage.topicsWithCompletedLesson / coverage.topicsTotal : 0} testID="progress-coverage-meter" />
          </OverviewItem>
          <OverviewItem title={c.streakHeading}>
            <Text variant="body" style={{ fontFamily: sansFont("medium") }} testID="progress-streak">
              {format(c.streakCurrent, { count: String(streak.current) })}
            </Text>
            <Text variant="caption" tone="text2">
              {format(c.streakBest, { count: String(streak.best) })}. {c.streakNote}
            </Text>
          </OverviewItem>
          <OverviewItem title={c.paceHeading}>
            {pace.avgSeconds === null ? (
              <Text variant="body" style={{ fontFamily: sansFont("medium") }} testID="progress-pace">
                {c.paceNone}
              </Text>
            ) : (
              <>
                <Text variant="body" style={{ fontFamily: sansFont("medium") }} testID="progress-pace">
                  {format(c.paceBody, { avg: String(pace.avgSeconds), budget: String(pace.budgetSeconds) })}
                </Text>
                <PaceMeter ratio={paceFill(pace.avgSeconds, pace.budgetSeconds)} testID="progress-pace-meter" />
              </>
            )}
          </OverviewItem>
          <OverviewItem title={c.bankHeading}>
            <Text variant="body" style={{ fontFamily: sansFont("medium") }} testID="progress-bank">
              {format(c.bankBody, { due: String(review.dueCount), active: String(review.activeCount), retired: String(review.retiredCount) })}
            </Text>
            {review.dueCount > 0 ? <LinkButton label={c.openReview} onPress={() => router.navigate("/csca/review")} testID="progress-review-link" /> : null}
          </OverviewItem>
        </View>
      </Card>

      <View style={{ gap: 8 }} testID="progress-topics">
        <Text variant="title" accessibilityRole="header">
          {c.topicsHeading}
        </Text>
        <Text variant="secondary" tone="text2">
          {c.topicsLead}
        </Text>
        {sections.map((section) => (
          <View key={section.section} style={{ gap: 4, marginTop: 12 }} testID={`progress-section-${section.section}`}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 10, rowGap: 2 }}>
              <Text variant="caption" tone="text2" bold>
                {section.label}
              </Text>
              {section.title ? (
                <Text variant="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>
                  {section.title}
                </Text>
              ) : null}
            </View>
            <View style={{ marginBottom: 4 }}>
              <TopicStrip states={section.states} />
            </View>
            {section.rows.map((row, index) => (
              <View key={row.topicKey} testID={`progress-topic-${row.topicKey}`} style={{ gap: 4, paddingVertical: 11, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: tokens.line, marginTop: index === 0 ? 4 : 0 }}>
                <Text variant="secondary">{row.title}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 2 }}>
                  <StateChip state={row.state} />
                  {row.note ? (
                    <Text variant="caption" tone="text2">
                      {row.note}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>

      <View style={{ gap: 8 }} testID="progress-history">
        <Text variant="title" accessibilityRole="header">
          {c.testsHistoryHeading}
        </Text>
        <Card>
          {history.length === 0 ? (
            <Text variant="secondary" tone="text2">
              {c.testsHistoryEmpty}
            </Text>
          ) : (
            history.map((row, index) => (
              <Pressable
                key={row.attemptId}
                accessibilityRole="link"
                accessibilityHint={row.formId ? c.testOpenResult : undefined}
                disabled={!row.formId}
                onPress={() => row.formId && router.navigate({ pathname: "/csca/test/[formId]", params: { formId: row.formId, attempt: row.attemptId } })}
                testID={`history-${row.attemptId}`}
                style={{ gap: 2, paddingTop: index === 0 ? 0 : 12, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.line, minHeight: MIN_TARGET }}
              >
                <Text variant="secondary" bold>
                  {row.title} · {row.result}
                </Text>
                <Text variant="caption" tone="text2">
                  {row.date} · {row.how}
                </Text>
                {row.formId ? (
                  <Text variant="caption" bold style={{ textDecorationLine: "underline", textDecorationColor: tokens.controlEdge }}>
                    {c.testOpenResult}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </Card>
        <Text variant="caption" tone="text2" testID="progress-caption">
          {c.resultCaption}
        </Text>
      </View>
    </StackPage>
  );
}
