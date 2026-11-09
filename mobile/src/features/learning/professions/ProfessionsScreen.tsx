// «Профессии»: карточки с фильтром по шкалам интересов и отметкой «созвучно вашим интересам»,
// которую клиент считает по топ-шкалам СОБСТВЕННОГО завершённого теста интересов (серверной связки нет).
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ORVIS_SCALE_IDS, professionResonates, type OrvisScaleId } from "@web/lib/portal/professions";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { readProfessionCards } from "@/features/learning/professions/api";
import { useOwnTopScales } from "@/features/learning/tests/queries";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardSkeleton, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export function ProfessionsScreen() {
  const { lang, m, t } = useLang();
  const { tokens } = useTheme();
  const { transport, userKey } = usePortalApi();
  const p = t("professions");
  useRefetchOnFocus();
  const cards = useQuery({ queryKey: ["portal", userKey, "profession-cards"], queryFn: () => readProfessionCards(transport) });
  const { topScales } = useOwnTopScales();
  const [scale, setScale] = useState<OrvisScaleId | null>(null);
  const list = (cards.data ?? []).filter((c) => scale === null || c.orvisScales.includes(scale));
  return (
    <Screen topInset={false} tabBar onRefresh={() => void cards.refetch()} refreshing={cards.isRefetching}>
      <View style={{ gap: 16 }} testID="professions-screen">
        <Text variant="display" accessibilityRole="header" testID="title-professions">
          {p.title}
        </Text>
        <Card>
          <Text variant="body" bold>
            {p.testEntry}
          </Text>
          <Text variant="secondary" tone="text2">
            {p.testEntryHint}
          </Text>
          <Button variant="ghost" label={p.testEntry} onPress={() => router.navigate({ pathname: "/tests/[key]", params: { key: "orvis92" } })} testID="professions-test-open" />
        </Card>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={p.filterAria} contentContainerStyle={{ gap: 8 }}>
          {[null, ...ORVIS_SCALE_IDS].map((id) => {
            const on = scale === id;
            return (
              <Pressable key={id ?? "all"} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setScale(id)} testID={`filter-${id ?? "all"}`} style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: on ? tokens.accent : tokens.line, backgroundColor: on ? tokens.accentSoft : tokens.surface }}>
                <Text variant="secondary" bold={on}>
                  {id === null ? p.allScales : p[`scale.${id}`]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {!cards.data ? (
          cards.status === "error" ? (
            <InlineAlert message={m(loadErrorKey(cards.error))} retryLabel={m("gate.retry")} onRetry={() => void cards.refetch()} testID="professions-error" />
          ) : (
            <CardSkeleton label={m("state.loading")} lines={4} />
          )
        ) : list.length === 0 ? (
          <Card>
            <Text variant="heading">{p.emptyTitle}</Text>
            <Text variant="secondary" tone="text2">
              {p.emptyBody}
            </Text>
          </Card>
        ) : (
          list.map((card) => {
            const resonates = professionResonates(card.orvisScales, topScales);
            return (
              <Pressable
                key={card.cardId}
                accessibilityRole="button"
                accessibilityLabel={`${lang === "ky" ? card.titleKy : card.titleRu}${resonates ? `. ${p.resonance}` : ""}`}
                onPress={() => router.navigate({ pathname: "/professions/[cardId]", params: { cardId: card.cardId } })}
                testID={`profession-${card.cardKey}`}
                style={{ minHeight: MIN_TARGET + 16, gap: 8, padding: 14, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
              >
                <Text variant="body" bold>
                  {lang === "ky" ? card.titleKy : card.titleRu}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {card.orvisScales.map((sc) => (
                    <Chip key={sc} label={p[`scale.${sc}`]} />
                  ))}
                </View>
                {resonates ? <Chip tone="accent" label={p.resonance} testID="resonance" /> : null}
              </Pressable>
            );
          })
        )}
        {topScales ? (
          <Text variant="caption" tone="text2">
            {p.resonanceHint}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
