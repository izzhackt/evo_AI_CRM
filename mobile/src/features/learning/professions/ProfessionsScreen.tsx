// «Профессии»: вход в подбор с Эви или карточка теста интересов, «Подходят вам» (три лучших совпадения с собственным тестом),
// поиск, фильтр по интересам и группы, у карточек фото профессии. Веб: src/app/(portal)/portal/professions/page.tsx,
// ProfessionMatches, ProfessionsBrowser (правки владельца 10–11.11.2026, 17.11.2026). Отметки «созвучно вашим интересам» нет:
// веб убрал её в #1446, приложение - вместе с подсказкой под списком.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { groupProfessionsByScale, searchProfessions, topProfessionMatches } from "@web/lib/portal/profession-guide";
import { ORVIS_SCALE_IDS, type OrvisScaleId, type ProfessionCardSummary } from "@web/lib/portal/professions";

import { usePortalApi } from "@/api/PortalApi";
import { loadErrorKey, useRefetchOnFocus } from "@/api/queries";
import { useEviEntry } from "@/features/learning/evi/hooks";
import { useOpenEvi } from "@/features/learning/evi/navigation";
import { readProfessionCards } from "@/features/learning/professions/api";
import { interestTestFromCatalog } from "@/features/learning/professions/model";
import { EviHero, TestHero } from "@/features/learning/professions/ProfessionsHero";
import { ProfessionPhoto } from "@/features/learning/professions/ProfessionPhoto";
import { useAssessmentCatalog, useOwnOrvisProfile } from "@/features/learning/tests/queries";
import { Chip } from "@/features/learning/ui";
import { usePullRefresh } from "@/features/universities/use-pull-refresh";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { CardSkeleton, InlineAlert, MIN_TARGET } from "@/ui/CardParts";
import { Card, Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export function ProfessionsScreen() {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const { transport, userKey } = usePortalApi();
  const p = t("professions");
  useRefetchOnFocus();
  const cards = useQuery({ queryKey: ["portal", userKey, "profession-cards"], queryFn: () => readProfessionCards(transport) });
  const { refreshing, pull } = usePullRefresh(cards.refetch);
  const profile = useOwnOrvisProfile();
  // Как на вебе: сверху вход в Эви, а карточка теста - когда Эви скрыта: у студента, отозвавшего согласие на ИИ-помощников, или когда
  // на сервере нет ключа Эви. Не прочиталось ни то ни другое - Эви показана, сервер проверит сам (`useEviEntry`).
  const entry = useEviEntry();
  const openEvi = useOpenEvi();
  const testState = interestTestFromCatalog(useAssessmentCatalog().data);
  const [scale, setScale] = useState<OrvisScaleId | null>(null);
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const all = cards.data ?? [];
  // Как на сайте: «Подходят вам» только без фильтра по интересу и только при завершённом тесте.
  const matches = useMemo(() => (cards.data && profile && scale === null ? topProfessionMatches(cards.data, profile) : []), [cards.data, profile, scale]);
  const inScale = all.filter((card) => scale === null || card.orvisScales.includes(scale));
  const found = searchProfessions(inScale, query, lang === "ky" ? "ky" : "ru");
  const groups = scale === null ? groupProfessionsByScale(found) : found.length > 0 ? [{ scale, cards: found }] : [];
  const plural = new Intl.PluralRules(lang === "ky" ? "ky" : "ru");
  const countLabel = (count: number) => {
    const rule = plural.select(count);
    return format(p[rule === "one" ? "groupCount.one" : rule === "few" ? "groupCount.few" : "groupCount.many"], { count: String(count) });
  };
  const title = (card: ProfessionCardSummary) => (lang === "ky" ? card.titleKy : card.titleRu);
  const open = (card: ProfessionCardSummary) => router.navigate({ pathname: "/professions/[cardId]", params: { cardId: card.cardId } });
  // `from`: после выхода из теста вернуться на «Профессии», а не остаться в каталоге «Тестов» (ревью QA 22).
  const openTest = () => router.navigate({ pathname: "/tests/[key]", params: { key: "orvis92", from: "professions" } });
  return (
    <Screen topInset={false} tabBar onRefresh={() => void pull()} refreshing={refreshing}>
      <View style={{ gap: 16 }} testID="professions-screen">
        <Text variant="display" accessibilityRole="header" testID="title-professions">
          {p.title}
        </Text>
        {entry.shown ? <EviHero strings={p} onOpen={openEvi} /> : <TestHero strings={p} state={testState} onOpen={openTest} />}

        {matches.length > 0 ? (
          <View style={{ gap: 10 }} testID="profession-matches">
            <Text variant="heading" accessibilityRole="header">
              {p.matchesHeading}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${p.matchesSource}. ${p.matchesHelpLabel}`}
              accessibilityState={{ expanded: helpOpen }}
              onPress={() => setHelpOpen((open) => !open)}
              testID="matches-help-toggle"
              style={{ minHeight: MIN_TARGET, justifyContent: "center" }}
            >
              <Text variant="secondary" tone="accent" bold>
                {p.matchesSource} · ?
              </Text>
            </Pressable>
            {helpOpen ? (
              <Text variant="secondary" tone="text2" testID="matches-help">
                {p.matchesHelp}
              </Text>
            ) : null}
            {matches.map(({ card, percent, reasons }) => (
              <Pressable
                key={card.cardId}
                accessibilityRole="button"
                accessibilityLabel={`${title(card)}. ${format(p.matchPercent, { percent: String(percent) })}`}
                onPress={() => open(card)}
                testID={`match-${card.cardKey}`}
                style={{ overflow: "hidden", borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
              >
                <ProfessionPhoto cardKey={card.cardKey} testID={`match-photo-${card.cardKey}`} />
                <View style={{ minHeight: MIN_TARGET + 16, gap: 6, padding: 14 }}>
                  <Text variant="heading" tone="accent" testID={`match-percent-${card.cardKey}`}>
                    {percent}%
                  </Text>
                  <Text variant="body" bold>
                    {title(card)}
                  </Text>
                  <Text variant="secondary" tone="text2">
                    {format(p.matchReasons, { scales: reasons.map((id) => p[`scale.${id}`]).join(", ") })}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <TextField label={p.searchLabel} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search" testID="professions-search" />
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
        ) : all.length === 0 || (scale !== null && inScale.length === 0) ? (
          <Card>
            <Text variant="heading">{p.emptyTitle}</Text>
            <Text variant="secondary" tone="text2">
              {p.emptyBody}
            </Text>
          </Card>
        ) : groups.length === 0 ? (
          <Text variant="secondary" tone="text2" accessibilityRole="summary" accessibilityLiveRegion="polite" testID="professions-search-empty">
            {p.searchEmpty}
          </Text>
        ) : (
          groups.map((group) => (
            <View key={group.scale} style={{ gap: 10 }} testID={`group-${group.scale}`}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <Text variant="heading" accessibilityRole="header">
                  {p[`scale.${group.scale}`]}
                </Text>
                <Text variant="caption" tone="text2">
                  {countLabel(group.cards.length)}
                </Text>
              </View>
              {group.cards.map((card) => {
                const summary = lang === "ky" ? card.summaryKy : card.summaryRu;
                return (
                  <Pressable
                    key={card.cardId}
                    accessibilityRole="button"
                    accessibilityLabel={title(card)}
                    onPress={() => open(card)}
                    testID={`profession-${card.cardKey}`}
                    style={{ overflow: "hidden", borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}
                  >
                    <ProfessionPhoto cardKey={card.cardKey} testID={`tile-photo-${card.cardKey}`} />
                    <View style={{ minHeight: MIN_TARGET + 16, gap: 8, padding: 14 }}>
                      <Text variant="body" bold>
                        {title(card)}
                      </Text>
                      {summary ? (
                        <Text variant="secondary" tone="text2">
                          {summary}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {card.orvisScales.map((sc) => (
                          <Chip key={sc} label={p[`scale.${sc}`]} />
                        ))}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}
