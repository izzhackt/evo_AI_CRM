// «Где учиться в EVO» на карточке профессии: программы каталога с ценой за год, ближайшим набором и избранным вуза.
// Веб: ProfessionProgramsTable.tsx. На телефоне таблица стала списком карточек: у каждой название вуза и программы,
// затем «Страна / Стоимость в год / Ближайший набор» построчно. Нет цены или набора - «нет данных», не ноль.
// Избранное как в вебе: кнопка с сердечком и словами «В избранное» / «В избранном», на всю ширину карточки, состояние для читалки,
// сбой строкой под кнопкой («Не удалось сохранить. Нажмите ещё раз.»), без окна-предупреждения. Кнопка есть у каждой строки с вузом
// и когда список избранного не прочитался (как у веба, где состояние приходит с карточкой): первое нажатие тогда перечитывает список.
import { useQuery } from "@tanstack/react-query";
import type { ProfessionProgramRow } from "@web/lib/portal/profession-guide";
import type { ProfessionLinkedProgramRef } from "@web/lib/portal/professions";
import { Heart } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { loadProfessionPrograms } from "@/features/learning/professions/api";
import { monthLabel, tuitionLabel } from "@/features/learning/professions/model";
import { useFavoriteIds, useToggleFavorite, useUniversityIndex } from "@/features/universities/hooks";
import { open, universityRoute } from "@/features/universities/parts";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { CardSkeleton, MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";
import { useAnnouncer } from "@/ui/useAnnouncer";

/** Избранное для строк «Где учиться»: тот же список и тот же переключатель, что у карточки вуза, но сбой - строкой, а не окном. */
type ProgramFavorites = Readonly<{
  /** Состояние вуза; `null` - список избранного не прочитан. */
  isFavored: (id: string) => boolean | null;
  toggle: (id: string, next: boolean) => void;
  /** Вуз, у которого последнее нажатие не удалось. */
  failedId: string | null;
}>;

function useProgramFavorites(): Readonly<{ favorites: ProgramFavorites; region: ReturnType<typeof useAnnouncer>["region"] }> {
  const { t } = useLang();
  const failureText = t("professions").favoriteError;
  const ids = useFavoriteIds();
  const { toggle, failedId, clearFailed } = useToggleFavorite();
  const [unreadFailedId, setUnreadFailedId] = useState<string | null>(null);
  const { announce, region } = useAnnouncer();
  const listRead = ids.data !== undefined;
  const failed = unreadFailedId ?? failedId;
  // Сбой читает и читалка (веб: `role="alert"`), один раз на сбой.
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (failed !== null && failed !== spoken.current) announce(failureText, "assertive");
    spoken.current = failed;
  }, [failed, announce, failureText]);
  const press = useCallback(
    (id: string, next: boolean) => {
      setUnreadFailedId(null);
      clearFailed();
      if (listRead) {
        void toggle(id, next);
        return;
      }
      // Список избранного не прочитался: сначала читаем его заново, иначе запись затёрла бы остальные сердечки неполным списком.
      void ids.refetch().then((result) => {
        if (result.data === undefined) setUnreadFailedId(id);
        else void toggle(id, next);
      });
    },
    [listRead, toggle, ids, clearFailed],
  );
  const set = ids.data === undefined ? null : new Set(ids.data);
  return { favorites: { isFavored: (id) => (set === null ? null : set.has(id)), toggle: press, failedId: failed }, region };
}

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
  return <ProgramList rows={rows.data} />;
}

/** Строки с избранным: список избранного читается, только когда есть что показать. */
function ProgramList({ rows }: { rows: readonly ProfessionProgramRow[] }) {
  const { favorites, region } = useProgramFavorites();
  return (
    <View style={{ gap: 10 }} testID="profession-programs">
      {rows.map((row) => (
        <ProgramCard key={`${row.ref.institution_photo_key}-${row.ref.program_hint}`} row={row} favorites={favorites} />
      ))}
      {region}
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

function ProgramCard({ row, favorites }: { row: ProfessionProgramRow; favorites: ProgramFavorites }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const p = t("professions");
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
            <Pressable accessibilityRole="link" accessibilityLabel={row.institutionName ?? ""} accessibilityLanguage="en" onPress={() => open(universityRoute(id))} hitSlop={4} style={{ minHeight: MIN_TARGET, justifyContent: "center" }} testID={`program-uni-${id}`}>
              <Text variant="body" bold tone="accent">
                {row.institutionName}
              </Text>
            </Pressable>
          ) : null}
          {/* Названия программ и вузов - на языке каталога (веб: `lang="en"`). */}
          <Text variant="secondary" accessibilityLanguage="en">
            {row.ref.program_hint}
          </Text>
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
      {id !== null ? (
        <View style={{ gap: 4, paddingTop: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: favored }}
            accessibilityLabel={`${favored ? p.favoriteRemove : p.favoriteAdd} — ${row.institutionName ?? ""}`}
            onPress={() => favorites.toggle(id, !favored)}
            testID={`program-fav-${id}`}
            style={({ pressed }) => ({
              minHeight: MIN_TARGET,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 14,
              borderRadius: tokens.radiusControl,
              borderWidth: 1,
              borderColor: favored ? tokens.accent : tokens.line,
              backgroundColor: tokens.surface,
              transform: [{ scale: pressed ? tokens.pressScale : 1 }],
            })}
          >
            <Heart size={16} strokeWidth={1.75} color={favored ? tokens.accent : tokens.text} fill={favored ? tokens.accent : "none"} />
            {/* Слова видны, а читалка слышит подпись кнопки: действие и название вуза. */}
            <Text variant="secondary" bold={favored} tone={favored ? "accent" : "text"}>
              {favored ? p.favoriteAdded : p.favoriteAdd}
            </Text>
          </Pressable>
          {favorites.failedId === id ? (
            <Text variant="caption" tone="error" accessibilityRole="alert" testID={`program-fav-error-${id}`} style={{ textAlign: "right" }}>
              {p.favoriteError}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
