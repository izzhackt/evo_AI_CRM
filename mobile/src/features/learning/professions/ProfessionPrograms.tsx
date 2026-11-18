// «Где учиться в EVO» на карточке профессии: программы каталога с ценой за год, ближайшим набором и избранным вуза.
// Веб: ProfessionProgramsTable.tsx. На телефоне таблица стала списком карточек: у каждой название вуза и программы,
// затем «Страна / Стоимость в год / Ближайший набор» построчно. Нет цены или набора - «нет данных», не ноль.
import { useQuery } from "@tanstack/react-query";
import type { ProfessionProgramRow } from "@web/lib/portal/profession-guide";
import type { ProfessionLinkedProgramRef } from "@web/lib/portal/professions";
import { Heart } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadProfessionPrograms } from "@/features/learning/professions/api";
import { monthLabel, tuitionLabel } from "@/features/learning/professions/model";
import { useFavoriteState } from "@/features/universities/FavoritesContext";
import { useUniversityIndex } from "@/features/universities/hooks";
import { open, universityRoute } from "@/features/universities/parts";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { CardSkeleton, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export function ProfessionPrograms({ refs, directions }: { refs: readonly ProfessionLinkedProgramRef[]; directions: readonly string[] }) {
  const { m } = useLang();
  const { transport, userKey } = usePortalApi();
  const universities = useUniversityIndex();
  const now = useMemo(() => new Date(), []);
  const index = universities.index;
  const rows = useQuery({
    queryKey: ["portal", userKey, "profession-programs", index?.version ?? null, refs.map((ref) => `${ref.institution_photo_key}/${ref.program_hint}`)],
    queryFn: () => loadProfessionPrograms(transport, refs, index?.universities ?? [], now),
    enabled: index !== null,
    staleTime: 0,
  });
  if (refs.length === 0) return <Directions items={directions} />;
  // Каталог недоступен - направления остаются текстом, как на сайте.
  if (universities.isError || rows.status === "error") return <Directions items={directions} />;
  if (!rows.data) return <CardSkeleton label={m("state.loading")} lines={3} />;
  return (
    <View style={{ gap: 10 }} testID="profession-programs">
      {rows.data.map((row) => (
        <ProgramCard key={`${row.ref.institution_photo_key}-${row.ref.program_hint}`} row={row} />
      ))}
    </View>
  );
}

function Directions({ items }: { items: readonly string[] }) {
  return (
    <View style={{ gap: 6 }} testID="profession-directions">
      {items.map((item) => (
        <Text key={item} variant="body">
          • {item}
        </Text>
      ))}
    </View>
  );
}

function ProgramCard({ row }: { row: ProfessionProgramRow }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const p = t("professions");
  const favorites = useFavoriteState();
  const id = row.institutionId;
  // Состояние избранного - то же, что у карточки вуза: строки одного вуза его делят; пока список не прочитан - как в строке.
  const favored = id === null ? false : (favorites.isFavored(id) ?? row.favored);
  const missing = p.valueMissing;
  const facts: readonly [string, string][] = [
    [p.colCountry, row.countryName ? row.countryName[lang] : missing],
    [p.colCost, row.tuition ? tuitionLabel(row.tuition, lang, p.approx) : missing],
    [p.colIntake, row.nextStartMonth ? monthLabel(row.nextStartMonth, lang) : missing],
  ];
  return (
    <View testID={`program-${row.ref.institution_photo_key}`} style={{ gap: 8, padding: 14, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          {id !== null ? (
            <Pressable accessibilityRole="link" accessibilityLabel={row.institutionName ?? ""} onPress={() => open(universityRoute(id))} hitSlop={4} style={{ minHeight: MIN_TARGET, justifyContent: "center" }} testID={`program-uni-${id}`}>
              <Text variant="body" bold tone="accent">
                {row.institutionName}
              </Text>
            </Pressable>
          ) : null}
          <Text variant="secondary">{row.ref.program_hint}</Text>
          {id === null ? (
            <Text variant="caption" tone="text2">
              {p.universityMissing}
            </Text>
          ) : !row.programFound ? (
            <Text variant="caption" tone="text2">
              {p.programMissing}
            </Text>
          ) : null}
        </View>
        {id !== null && favorites.isFavored(id) !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: favored }}
            accessibilityLabel={`${favored ? p.favoriteRemove : p.favoriteAdd} — ${row.institutionName ?? ""}`}
            onPress={() => favorites.toggle(id, !favored)}
            testID={`program-fav-${id}`}
            hitSlop={4}
            style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
          >
            <Heart size={22} strokeWidth={1.75} color={favored ? tokens.accent : tokens.text2} fill={favored ? tokens.accent : "none"} />
          </Pressable>
        ) : null}
      </View>
      {facts.map(([label, value]) => (
        <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <Text variant="caption" tone="text2" style={{ flexShrink: 0 }}>
            {label}
          </Text>
          <Text variant="secondary" style={{ flex: 1, textAlign: "right" }}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}
