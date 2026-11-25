// Результат теста как на сайте (`components/portal/tests/AssessmentResults.tsx`): сводка, темы английского с разбором по заданиям
// (раскрываются по одному), восемь шкал интересов по убыванию с пояснениями, профессии для исследования со всеми деталями и
// источником, «Как читать результат и его ограничения». Содержание (метаданные, разборы, профессии, ограничения) приходит от
// сервера со своей локалью и не переводится, подписи интерфейса - словарь `tests` (RU и KY).
// Названия шкал для кыргызского остаются из словаря приложения (решение владельца 25.11, D12): содержание у сервера только русское.
import { router } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { Linking, View } from "react-native";

import type { AssessmentAttempt, AssessmentProfession, OrvisScale } from "@web/lib/student-assessment-contract";

import { Disclosure } from "@/features/learning/tests/Disclosure";
import { useLang } from "@/i18n/LangProvider";
import type { PortalStrings } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { InlineAlert } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

type TestsStrings = PortalStrings<"tests">;

/** Тема английского: известные темы словаря; чужое название темы остаётся как есть. */
function topicName(topic: string, s: TestsStrings): string | null {
  return topic === "grammar" || topic === "vocabulary" || topic === "reading" ? s[`topic.${topic}`] : null;
}

/** Полоса значения (`<meter>` сайта): высота 12, цвет акцента, читалка слышит только готовую подпись. */
function Meter({ fraction, label, color }: { fraction: number; label: string; color?: string }) {
  const { tokens } = useTheme();
  const share = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View accessible accessibilityLabel={label} style={{ height: 12, marginTop: 10, borderRadius: tokens.radiusChip, backgroundColor: tokens.line, overflow: "hidden" }}>
      <View style={{ height: 12, width: `${share * 100}%`, borderRadius: tokens.radiusChip, backgroundColor: color ?? tokens.accent }} />
    </View>
  );
}

/** Одна карточка со строками через линию (`.pt-res-list`). */
function RowList({ children }: { children: ReactNode[] }) {
  const { tokens, scheme } = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, backgroundColor: tokens.surface, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}>
      {children.map((child, i) => (
        <View key={i} style={{ paddingVertical: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.line }}>
          {child}
        </View>
      ))}
    </View>
  );
}

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Text variant="caption" tone="text2" accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => undefined)} style={{ textDecorationLine: "underline" }}>
      {label}
    </Text>
  );
}

/** Профессия: что делают за день, навыки, учебные направления, путь, пробное задание, редакционная пометка и источник с лицензией. */
function ProfessionCard({ profession, s }: { profession: AssessmentProfession; s: TestsStrings }) {
  const { tokens } = useTheme();
  const { format } = useLang();
  const source = profession.source;
  return (
    <Disclosure title={profession.title} testID={`profession-${profession.id}`}>
      <Text variant="secondary" tone="text2">
        {profession.summary}
      </Text>
      <View style={{ gap: 6 }}>
        <Text variant="secondary" bold>
          {s.professionDay}
        </Text>
        {profession.tasks.map((task, i) => (
          <Text key={i} variant="secondary" tone="text2">
            • {task}
          </Text>
        ))}
      </View>
      <Text variant="secondary" tone="text2">
        <Text variant="secondary" bold>
          {s.professionSkills}
        </Text>
        {profession.skills.join(" · ")}
      </Text>
      <Text variant="secondary" tone="text2">
        <Text variant="secondary" bold>
          {s.professionStudy}
        </Text>
        {profession.studyDirections.join(" · ")}
      </Text>
      {profession.careerPath?.length ? (
        <Text variant="secondary" tone="text2">
          <Text variant="secondary" bold>
            {s.professionPath}
          </Text>
          {profession.careerPath.join(" → ")}
        </Text>
      ) : null}
      <View style={{ padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
        <Text variant="secondary" tone="text2">
          <Text variant="secondary" bold>
            {s.professionTry}
          </Text>
          {profession.tryActivity}
        </Text>
      </View>
      <Text variant="caption" tone="text2">
        {profession.editorialNote}
      </Text>
      <Text variant="caption" tone="text2">
        {s.professionSourceLead} <Link label={format(s.professionSourceProfile, { id: source.occupationId })} url={source.url} />, {source.version};{" "}
        <Link label={source.license} url={source.licenseUrl} />. {format(s.professionSourceChecked, { date: source.retrievedOn })}
      </Text>
    </Disclosure>
  );
}

export function AssessmentResult({ attempt, onRestart }: { attempt: AssessmentAttempt; onRestart: () => void }) {
  const { lang, t, format } = useLang();
  const s = t("tests");
  const result = attempt.result;
  const english = result?.english;
  const orvis = result?.orvis;
  const title = english ? format(s.resultScore, { correct: String(english.correctCount), total: String(english.totalCount) }) : s.resultCareerTitle;
  // Веб переводит фокус на заголовок результата: читалка называет его без поиска по экрану.
  useEffect(() => announce(result ? title : ""), [result, title]);
  if (!result) return <InlineAlert message={s["error.invalid"]} />;
  const meta = result.metadata;
  const questionsById = Object.fromEntries(attempt.questions.map((q) => [q.id, q]));
  const scales = orvis ? [...orvis.scales].sort((a, b) => b.mean - a.mean) : [];
  const preferred = meta.professions?.filter((p) => p.scaleIds.some((id) => orvis?.topScales.includes(id))) ?? [];
  const other = meta.professions?.filter((p) => !preferred.includes(p)) ?? [];
  // Решение D12: у кыргызского ученика остаются названия шкал приложения, у русского - названия из содержания, как на сайте.
  const scaleName = (id: OrvisScale) => s[`scale.${id}`];
  const scaleLabel = (id: OrvisScale) => (lang === "ky" ? scaleName(id) : (meta.scales?.find((m) => m.id === id)?.label ?? scaleName(id)));
  return (
    <View style={{ gap: 24 }} testID="assessment-result">
      <Card>
        <Text variant="caption" tone="text2" bold>
          {s.resultCompleted}
        </Text>
        <Text variant="title" accessibilityRole="header" testID="result-score">
          {title}
        </Text>
        {english?.band ? (
          <Text variant="body" bold testID="result-band">
            {meta.bands?.find((b) => b.id === english.band)?.label ?? s.resultBandFallback}
          </Text>
        ) : null}
        <Text variant="body">{english ? s.resultEnglishLead : s.resultCareerLead}</Text>
        <Text variant="caption" tone="text2">
          {s.resultSavedNote}
        </Text>
      </Card>

      {english ? (
        <>
          <View style={{ gap: 12 }}>
            <Text variant="heading" accessibilityRole="header">
              {s.topicsHeading}
            </Text>
            <RowList>
              {english.topics.map((topic) => {
                const name = topicName(topic.topic, s) ?? topic.topic;
                const ratio = topic.totalCount ? topic.correctCount / topic.totalCount : 0;
                const recommendation = meta.recommendations?.[topic.topic as "grammar" | "vocabulary" | "reading"];
                return (
                  <View key={topic.topic} testID={`topic-${topic.topic}`}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 16 }}>
                      <Text variant="secondary" bold>
                        {name}
                      </Text>
                      <Text variant="data" tone="text2">
                        {format(s.topicShare, { correct: String(topic.correctCount), total: String(topic.totalCount) })}
                      </Text>
                    </View>
                    <Meter fraction={ratio} label={format(s.topicMeterAria, { topic: name, correct: String(topic.correctCount), total: String(topic.totalCount) })} />
                    <Text variant="caption" tone="text2" style={{ marginTop: 8 }}>
                      {topic.totalCount < 4 ? s.topicFewTasks : ratio >= 0.75 ? s.topicStrong : s.topicPractice}
                    </Text>
                    {recommendation ? (
                      <Text variant="body" style={{ marginTop: 8 }}>
                        {recommendation}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </RowList>
          </View>
          <View style={{ gap: 12 }}>
            <Text variant="heading" accessibilityRole="header">
              {s.reviewSectionHeading}
            </Text>
            <Text variant="caption" tone="text2">
              {s.reviewSectionNote}
            </Text>
            {english.feedback.map((f, i) => {
              const question = questionsById[f.questionId];
              const skill = meta.blueprint?.find((b) => b.questionId === f.questionId)?.skill;
              const label = (skill && meta.skillLabels?.[skill]) || topicName(f.topic, s) || s.feedbackFallbackTopic;
              const optionLabel = (id: string) => question?.options.find((o) => o.id === id)?.label;
              return (
                <Disclosure key={f.questionId} title={`${i + 1}. ${f.correct ? s.feedbackCorrect : s.feedbackNeedsReview} — ${label}`} testID={`feedback-${i + 1}`}>
                  {question?.passage ? (
                    <Text variant="secondary" tone="text2" accessibilityLanguage="en">
                      {question.passage}
                    </Text>
                  ) : null}
                  <Text variant="secondary" bold accessibilityLanguage="en">
                    {question?.prompt}
                  </Text>
                  <Text variant="secondary">
                    {s.yourAnswer}{" "}
                    <Text variant="secondary" accessibilityLanguage="en">
                      {optionLabel(f.selectedOptionId)}
                    </Text>
                  </Text>
                  <Text variant="secondary">
                    {s.correctAnswer}{" "}
                    <Text variant="secondary" accessibilityLanguage="en">
                      {optionLabel(f.correctOptionId)}
                    </Text>
                  </Text>
                  <Text variant="secondary" tone="text2">
                    {f.explanation}
                  </Text>
                </Disclosure>
              );
            })}
          </View>
        </>
      ) : null}

      {orvis ? (
        <>
          <View style={{ gap: 12 }}>
            <Text variant="heading" accessibilityRole="header">
              {s.scalesHeading}
            </Text>
            <Text variant="caption" tone="text2">
              {s.scalesNote}
            </Text>
            <RowList>
              {scales.map((sc) => {
                const mean = sc.mean.toFixed(2);
                const description = meta.scales?.find((m) => m.id === sc.scale)?.description;
                return (
                  <View key={sc.scale} testID={`scale-${sc.scale}`}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 16 }}>
                      <Text variant="secondary" bold style={{ flexShrink: 1 }}>
                        {scaleLabel(sc.scale)}
                      </Text>
                      <Text variant="data" tone="text2">
                        {format(s.scaleShare, { mean })}
                      </Text>
                    </View>
                    <Meter fraction={(sc.mean - 1) / 4} label={format(s.scaleMeterAria, { scale: scaleName(sc.scale), mean })} />
                    {description ? (
                      <Text variant="caption" tone="text2" style={{ marginTop: 8 }}>
                        {description}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </RowList>
          </View>
          {meta.professions && meta.professions.length > 0 ? (
            <View style={{ gap: 12 }}>
              <Text variant="heading" accessibilityRole="header">
                {s.professionsHeading}
              </Text>
              <Text variant="caption" tone="text2">
                {s.professionsNote}
              </Text>
              {meta.professionAttribution ? (
                <Text variant="caption" tone="text2">
                  {meta.professionAttribution}
                </Text>
              ) : null}
              {preferred.map((p) => (
                <ProfessionCard key={p.id} profession={p} s={s} />
              ))}
              {other.length > 0 ? (
                <Disclosure title={s.showOtherProfessions} variant="link" testID="other-professions">
                  {other.map((p) => (
                    <ProfessionCard key={p.id} profession={p} s={s} />
                  ))}
                </Disclosure>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <Disclosure title={s.limitationsSummary} testID="limitations">
        {meta.limitations.map((line, i) => (
          <Text key={i} variant="secondary" tone="text2">
            • {line}
          </Text>
        ))}
      </Disclosure>
      <View style={{ gap: 8 }}>
        <Button variant="ghost" label={s.cardRetake} onPress={onRestart} testID="assessment-restart" />
        <Button variant="ghost" label={s.backToTests} onPress={() => router.navigate("/tests")} testID="assessment-back-to-tests" />
      </View>
    </View>
  );
}
