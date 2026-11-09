// Карточка профессии: день в работе, среда, навыки, что интересно и сложно, куда учиться, пробное
// задание, программы из справочника, источник O*NET (CC BY 4.0).
import { useQuery } from "@tanstack/react-query";
import { Linking, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey } from "@/api/queries";
import { readProfessionCard } from "@/features/learning/professions/api";
import { Chip, StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton, InlineAlert, LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function ProfessionCardScreen({ cardId }: { cardId: string }) {
  const { lang, m, t, format } = useLang();
  const { transport, userKey } = usePortalApi();
  const back = useBack("/professions");
  const p = t("professions");
  const card = useQuery({ queryKey: ["portal", userKey, "profession-card", cardId], queryFn: () => readProfessionCard(transport, cardId), staleTime: 0 });
  const body = card.data?.body;
  const ky = lang === "ky";
  const lists = body
    ? [
        { heading: p.skillsHeading, items: ky ? body.skills_ky : body.skills_ru },
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
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {p.dayHeading}
            </Text>
            <Text variant="body">{ky ? body.day_in_work_ky : body.day_in_work_ru}</Text>
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {p.environmentHeading}
            </Text>
            <Text variant="body">{ky ? body.environment_ky : body.environment_ru}</Text>
          </Card>
          {lists.map((l) =>
            l.items.length > 0 ? (
              <Card key={l.heading}>
                <Text variant="heading" accessibilityRole="header">
                  {l.heading}
                </Text>
                {l.items.map((item, i) => (
                  <Text key={i} variant="body">
                    • {item}
                  </Text>
                ))}
              </Card>
            ) : null,
          )}
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {p.trialHeading}
            </Text>
            <Text variant="body">{ky ? body.trial_task_ky : body.trial_task_ru}</Text>
          </Card>
          {body.linked_program_refs.length > 0 ? (
            <Card>
              <Text variant="heading" accessibilityRole="header">
                {p.programsHeading}
              </Text>
              {body.linked_program_refs.map((ref, i) => (
                <Text key={i} variant="body" testID={`program-ref-${i}`}>
                  {format(p.programLabel, { title: ref.program_hint })}
                </Text>
              ))}
            </Card>
          ) : null}
          <Text variant="caption" tone="text2">
            {p.attribution}
          </Text>
          <LinkButton label={p.attributionLink} onPress={() => void Linking.openURL("https://creativecommons.org/licenses/by/4.0/").catch(() => undefined)} />
        </>
      )}
    </StackPage>
  );
}
