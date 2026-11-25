// Три профессии от Эви под репликой «Придумал!» (веб: `EviResults.tsx`, `.pt-evi-results*`): под крупным заголовком «Твои профессии»
// три карточки с фото. Фото - снимок профессии по ключу карточки каталога (нет файла - серая подложка с номером, как в вебе), номер -
// красным кружком на фото, название, строка «чем занимается» из самой карточки каталога и объяснение «почему» словами Эви. Вся
// карточка - одна ссылка на профессию (там «Где учиться в EVO»). Процентов и оценок нет: сравнивать не с чем.
// Раскладка как на вебе: шире 600 pt - три в ряд; уже (телефон) - лента с прокруткой вбок от края до края, карточка 78 % ширины, листание
// с остановкой на карточке.
import { useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";

import type { EviResult } from "@web/lib/portal/evi";

import { ProfessionPhoto, professionPhotoSource } from "@/features/learning/professions/ProfessionPhoto";
import type { PortalStrings } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Strings = PortalStrings<"professions">;

/** Ширина переписки, с которой карточки встают в ряд (веб: `@container pt-evi-log (min-width: 600px)`). */
export const RESULTS_ROW_MIN_WIDTH = 600;
const RAIL_CARD_SHARE = 0.78;
const GAP = 12;
const GUTTER = 16;

export function EviResults({ results, strings, onOpen }: Readonly<{ results: readonly EviResult[]; strings: Strings; onOpen: (result: EviResult) => void }>) {
  const window = useWindowDimensions();
  // Ширина колонки переписки (без полей); до первого замера - по окну.
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? Math.max(0, window.width - GUTTER * 2);
  const row = width >= RESULTS_ROW_MIN_WIDTH;
  const cardWidth = Math.round(width * RAIL_CARD_SHARE);
  const cards = results.map((result, index) => (
    <ResultCard key={result.cardId} result={result} index={index} strings={strings} onOpen={onOpen} width={row ? undefined : cardWidth} />
  ));
  return (
    <View style={{ gap: GAP }} testID="evi-results" onLayout={(event) => setMeasured(Math.round(event.nativeEvent.layout.width))}>
      <Text variant="title" bold accessibilityRole="header" style={{ marginTop: 8 }}>
        {strings["evi.resultsTitle"]}
      </Text>
      {row ? (
        <View style={{ flexDirection: "row", gap: GAP }} testID="evi-results-row">
          {cards}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth + GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          // От края до края: поля переписки забирает сама лента, как `margin-inline: -16px` в вебе.
          style={{ marginHorizontal: -GUTTER }}
          contentContainerStyle={{ gap: GAP, paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 8 }}
          testID="evi-results-rail"
        >
          {cards}
        </ScrollView>
      )}
    </View>
  );
}

function ResultCard({ result, index, strings, onOpen, width }: Readonly<{ result: EviResult; index: number; strings: Strings; onOpen: (result: EviResult) => void; width: number | undefined }>) {
  const { tokens, scheme } = useTheme();
  const hasPhoto = professionPhotoSource(result.cardKey) !== null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${index + 1}. ${result.title}`}
      onPress={() => onOpen(result)}
      testID={`evi-result-${result.cardKey}`}
      style={{
        width,
        flex: width === undefined ? 1 : undefined,
        overflow: "hidden",
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        backgroundColor: tokens.eviBubble,
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
      }}
    >
      {/* Подложка 16:9 стоит и без фото (в вебе так же), номер сидит на ней. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ aspectRatio: 16 / 9, backgroundColor: tokens.skeleton }}>
        {hasPhoto ? <ProfessionPhoto cardKey={result.cardKey} testID={`evi-result-photo-${result.cardKey}`} /> : null}
        <View
          testID={`evi-result-number-${index + 1}`}
          style={{ position: "absolute", top: 10, left: 10, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tokens.accent, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
        >
          <Text variant="secondary" bold tone="onAccent">
            {index + 1}
          </Text>
        </View>
      </View>
      <View style={{ gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 }}>
        <Text variant="body" bold>
          {result.title}
        </Text>
        {result.summary ? (
          <Text variant="secondary" tone="text2">
            {result.summary}
          </Text>
        ) : null}
        <Text variant="secondary">{result.why}</Text>
      </View>
    </Pressable>
  );
}
