// Карточка профессии: что это за работа, предметы и навыки, «Где учиться в EVO» (программы каталога с ценой,
// набором и избранным), «Подробнее о работе» свёрнуто, источник O*NET (CC BY 4.0). Веб: professions/[cardId]/page.tsx.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { readProfessionCard } from "@/features/learning/professions/api";
import { ProfessionPrograms } from "@/features/learning/professions/ProfessionPrograms";
import { Chip, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton, InlineAlert, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function ProfessionCardScreen({ cardId }: { cardId: string }) {
  const { lang, m, t } = useLang();
  const { transport, userKey } = usePortalApi();
  const back = useBack("/professions");
  const p = t("professions");
  const [moreOpen, setMoreOpen] = useState(false);
  const card = useQuery({ queryKey: ["portal", userKey, "profession-card", cardId], queryFn: () => readProfessionCard(transport, cardId), staleTime: 0 });
  const body = card.data?.body;
  const ky = lang === "ky";
  const summary = body ? (ky ? body.summary_ky : body.summary_ru) : null;
  const subjects = body ? (ky ? body.school_subjects_ky : body.school_subjects_ru) : null;
  const panels = body
    ? [
        ...(subjects ? [{ heading: p.subjectsHeading, items: subjects }] : []),
        { heading: p.skillsHeading, items: ky ? body.skills_ky : body.skills_ru },
      ]
    : [];
  const more = body
    ? [
        { heading: p.interestingHeading, items: ky ? body.interesting_ky : body.interesting_ru },
        { heading: p.hardHeading, items: ky ? body.hard_ky : body.hard_ru },
        { heading: p.studyHeading, items: ky ? body.study_directions_ky : body.study_directions_ru },
      ]
    : [];
  return (
    <StackPage header={<SubHeader title={body ? (ky ? body.title_ky : body.title_ru) : p.cardTitle} onBack={back} backLabel={p.backToGrid} testID="profession-title" />} testID="profession-screen">
      {!body ? (
        card.status === "error" ? <InlineAlert message={m(loadErrorKey(card.error))} retryLabel={m("gate.retry")} onRetry={() => void card.refetch()} testID="profession-error" /> : <CardSkeleton label={m("state.loading")} lines={5} />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {body.orvis_scales.map((sc) => (
              <Chip key={sc} label={p[`scale.${sc}`]} />
            ))}
          </View>
          {summary ? (
            <Text variant="body" bold testID="profession-summary">
              {summary}
            </Text>
          ) : null}
          <Text variant="body">{ky ? body.day_in_work_ky : body.day_in_work_ru}</Text>
          {panels.map((panel) =>
            panel.items.length > 0 ? (
              <Card key={panel.heading}>
                <Text variant="heading" accessibilityRole="header">
                  {panel.heading}
                </Text>
                {panel.items.map((item, i) => (
                  <Text key={i} variant="body">
                    • {item}
                  </Text>
                ))}
              </Card>
            ) : null,
          )}
          <View style={{ gap: 10 }}>
            <Text variant="heading" accessibilityRole="header" testID="study-in-evo">
              {p.studyInEvoHeading}
            </Text>
            <ProfessionPrograms refs={body.linked_program_refs} directions={ky ? body.study_directions_ky : body.study_directions_ru} />
          </View>
          <Card>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen((v) => !v)} testID="profession-more-toggle" style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
              <Text variant="heading">{p.moreHeading}</Text>
            </Pressable>
            {moreOpen ? (
              <View style={{ gap: 12 }} testID="profession-more">
                <View style={{ gap: 4 }}>
                  <Text variant="body" bold>
                    {p.environmentHeading}
                  </Text>
                  <Text variant="body">{ky ? body.environment_ky : body.environment_ru}</Text>
                </View>
                {more.map((l) =>
                  l.items.length > 0 ? (
                    <View key={l.heading} style={{ gap: 4 }}>
                      <Text variant="body" bold>
                        {l.heading}
                      </Text>
                      {l.items.map((item, i) => (
                        <Text key={i} variant="body">
                          • {item}
                        </Text>
                      ))}
                    </View>
                  ) : null,
                )}
                <View style={{ gap: 4 }}>
                  <Text variant="body" bold>
                    {p.trialHeading}
                  </Text>
                  <Text variant="body">{ky ? body.trial_task_ky : body.trial_task_ru}</Text>
                </View>
              </View>
            ) : null}
          </Card>
          <Text variant="caption" tone="text2">
            {p.attribution}
          </Text>
          {body.sources.map((source, i) => (
            <LinkButton key={source} label={body.sources.length > 1 ? `${p.sourcesHeading} ${i + 1}` : p.sourcesHeading} onPress={() => void Linking.openURL(source).catch(() => undefined)} />
          ))}
          <LinkButton label={p.attributionLink} onPress={() => void Linking.openURL("https://creativecommons.org/licenses/by/4.0/").catch(() => undefined)} />
        </>
      )}
    </StackPage>
  );
}
