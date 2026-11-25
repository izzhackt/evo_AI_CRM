// Страна: шапка с фото, «Города · Списком · Карта» (`?view=`: без параметра города, `list`,
// `map`; иное - 404), карточки городов, «Другие вузы страны», «Списком» по городам, карта.
// Веб: src/app/(portal)/portal/universities/country/[code]/page.tsx.
import { useLocalSearchParams, router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { countryCodeFromSlug } from "@web/lib/portal/university-index";
import { formatPortalString } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import type { Lang } from "@/i18n";
import { Button } from "@/ui/Button";
import { EmptyBlock, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Landmark } from "lucide-react-native";

import { CatalogFrame } from "./CatalogFrame";
import { CatalogMap } from "./CatalogMap";
import { useFavoriteState } from "./FavoritesContext";
import { cityItem, nodeItem, ResultsStatus, tileItem } from "./lists";
import { countryPageModel, placeCounts, searchCountry, tileModel, type UniversityStrings } from "./model";
import { NearList, type NearItem } from "./NearList";
import { NotFoundBlock } from "./NotFoundBlock";
import { ALL_COUNTRIES_ROUTE, cityRoute, CreditedPhoto, geographyUrls, open, PathRow, universityRoute, usePhotoPixels } from "./parts";
import { geographyPhotoCredit } from "./photos";

type View_ = "cities" | "list" | "map";

/** `?view=`: только `list` и `map` (или без параметра); иное - null (неверный адрес). */
export function viewFromParam(value: string | string[] | undefined): View_ | null {
  if (value === undefined) return "cities";
  return value === "list" || value === "map" ? value : null;
}

/** Длина запроса поиска (веб: `maxLength={100}`, и адрес с запросом длиннее - 404). */
const SEARCH_MAX = 100;

export function CountryScreen() {
  const params = useLocalSearchParams<{ code: string; view?: string }>();
  const code = countryCodeFromSlug(String(params.code ?? ""));
  const view = viewFromParam(params.view);
  if (code === null || view === null) return <NotFoundBlock />;
  return <CountryBody code={code} view={view} />;
}

function CountryBody({ code, view }: { code: string; view: View_ }) {
  const { t, m, lang } = useLang();
  const strings = t("universities");
  const favorites = useFavoriteState();
  const pixels = usePhotoPixels();
  const now = useMemo(() => new Date(), []);
  // Загрузка карты: номер попытки и номер той, что не удалась. Пока сбой показан, карта не смонтирована, поэтому новая попытка
  // (кнопка «Повторить» или выбор «Карта» после сбоя) монтирует её заново. Сбой не липнет к экрану (у веба он жил, пока открыт вид).
  const [mapAttempt, setMapAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const mapFailed = failedAttempt === mapAttempt;
  const [query, setQuery] = useState("");
  return (
    <CatalogFrame>
      {(index) => {
        const page = countryPageModel(index, code, strings, lang);
        if (page === null) return <NotFoundBlock embedded />;
        const tile = (item: (typeof page.others)[number], showPlace: boolean, position: number, spaceBefore?: number) =>
          tileItem({ id: item.id, tile: tileModel(index, item, { strings, lang, now, showPlace }), strings, favorites, position, spaceBefore });
        const trimmed = query.trim();
        const found = view === "cities" && trimmed !== "" ? searchCountry(index, page, trimmed) : null;
        const foundCount = found === null ? null : found.cities.length + found.universities.length;
        return (
          <View style={{ gap: 16 }}>
            <PathRow crumbs={[{ label: page.name, href: null }]} strings={strings} />
            <View style={{ gap: 8 }}>
              <CreditedPhoto
                urls={geographyUrls(page.country.photo, pixels)}
                height={view === "cities" ? 180 : 110}
                label={page.name}
                strings={strings}
                credit={page.country.photo ? geographyPhotoCredit(page.country.photo) : null}
                placement="top"
                decorative
              />
              <Text variant="title" accessibilityRole="header">
                {page.name}
              </Text>
              <Text variant="secondary" tone="text2">
                {page.counts}
              </Text>
              {page.summary && view === "cities" ? <Text variant="body">{page.summary}</Text> : null}
            </View>

            {page.country.universityCount === 0 ? (
              <EmptyBlock
                icon={Landmark}
                title={strings.countryEmptyTitle}
                body={strings.countryEmptyBody}
                action={<Button variant="ghost" label={strings.allCountries} onPress={() => open(ALL_COUNTRIES_ROUTE)} />}
              />
            ) : (
              <>
                <LinkButton label={strings.allCountries} onPress={() => open(ALL_COUNTRIES_ROUTE)} testID="all-countries" />
                <Segmented<View_>
                  value={view}
                  testIDPrefix="view"
                  accessibilityLabel={strings.viewAria}
                  options={[
                    { value: "cities", label: strings.viewCities },
                    { value: "list", label: strings.viewList },
                    { value: "map", label: strings.viewMap },
                  ]}
                  onChange={(next) => {
                    // «Карта» после сбоя (из другого вида или повторным нажатием) - новая попытка; здоровую карту нажатие не перезагружает.
                    if (next === "map" && mapFailed) setMapAttempt((n) => n + 1);
                    router.setParams({ view: next === "cities" ? undefined : next } as never);
                  }}
                />
                {view === "map" ? (
                  <View style={{ gap: 8 }}>
                    {page.pins.length === 0 ? (
                      <Text variant="secondary" tone="text2" testID="map-failed">
                        {formatPortalString(strings.mapWithoutPoint, { count: String(page.missingPins) })}
                      </Text>
                    ) : mapFailed ? (
                      // Сбой карты - предупреждение с выходом на «Города» (веб: UniversitiesMapView, `role="alert"` и кнопка «Города»)
                      // и с повтором, которого у веба нет: страница там перезагружается, а экран приложения остаётся в стеке.
                      <View accessibilityRole="alert" style={{ gap: 8, alignItems: "flex-start" }} testID="map-failed">
                        <Text variant="secondary" tone="text2">
                          {strings.mapFailed}
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <Button variant="ghost" label={m("gate.retry")} onPress={() => setMapAttempt((n) => n + 1)} testID="map-failed-retry" />
                          <Button variant="ghost" label={strings.viewCities} onPress={() => router.setParams({ view: undefined } as never)} testID="map-failed-cities" />
                        </View>
                      </View>
                    ) : (
                      <>
                        <CatalogMap pins={page.pins} onOpen={(id) => open(universityRoute(id))} onFail={() => setFailedAttempt(mapAttempt)} />
                        <Text variant="caption" tone="text2" testID="map-summary">
                          {formatPortalString(strings.mapShown, { count: String(page.pins.length) })}
                          {page.missingPins > 0 ? `. ${formatPortalString(strings.mapWithoutPoint, { count: String(page.missingPins) })}` : ""}
                        </Text>
                        {/* Лицензия тайлов (OpenFreeMap, OpenMapTiles, ODbL OSM): подпись видна всегда. */}
                        <Text variant="caption" tone="text2" testID="map-attribution">
                          {m("uni.mapAttribution")}
                        </Text>
                      </>
                    )}
                  </View>
                ) : view === "list" ? (
                  <ListView page={page} code={code} strings={strings} lang={lang} tile={tile} />
                ) : (
                  <View style={{ gap: 20 }}>
                    <TextField
                      label={strings.searchLabel}
                      value={query}
                      onChangeText={setQuery}
                      placeholder={strings.searchPlaceholder}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      maxLength={SEARCH_MAX}
                      testID="country-search"
                      clearLabel={strings.searchClear}
                      onClear={() => setQuery("")}
                    />
                    <ResultsStatus found={foundCount} trimmed={trimmed} strings={strings} onClear={() => setQuery("")} />
                    {found !== null && foundCount !== 0 ? (
                      <NearList
                        gap={16}
                        items={[
                          ...(found.cities.length > 0 ? [nodeItem("heading:cities", <SectionHeading title={strings.citiesHeading} />)] : []),
                          ...found.cities.map((card, position) => cityItem({ card, code, strings, spaceBefore: position === 0 ? 12 : 16 })),
                          ...(found.universities.length > 0 ? [nodeItem("heading:universities", <SectionHeading title={strings.universitiesHeading} />, found.cities.length > 0 ? 20 : undefined)] : []),
                          ...found.universities.map((item, position) => tile(item, true, position, 12)),
                        ]}
                      />
                    ) : null}
                    {found === null && (page.cityCards.length > 0 || page.others.length > 0) ? (
                      <NearList
                        gap={16}
                        items={[
                          ...page.cityCards.map((card) => cityItem({ card, code, strings })),
                          ...(page.others.length > 0
                            ? [
                                nodeItem(
                                  "heading:others",
                                  <View style={{ gap: 2 }}>
                                    <Text variant="heading" accessibilityRole="header">
                                      {strings.otherUniversitiesHeading}
                                    </Text>
                                    <Text variant="secondary" tone="text2">
                                      {strings.otherUniversitiesLead}
                                    </Text>
                                  </View>,
                                  page.cityCards.length > 0 ? 20 : undefined,
                                ),
                              ]
                            : []),
                          ...page.others.map((item, position) => tile(item, true, position, 12)),
                        ]}
                      />
                    ) : null}
                  </View>
                )}
              </>
            )}
          </View>
        );
      }}
    </CatalogFrame>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <Text variant="heading" accessibilityRole="header">
      {title}
    </Text>
  );
}

type CountryPage = NonNullable<ReturnType<typeof countryPageModel>>;

/** «Списком»: города А-Я, вузы внутри; заголовок группы ведёт на страницу города, если она есть (веб: `h3 > a`). */
function ListView({
  page,
  code,
  strings,
  lang,
  tile,
}: {
  page: CountryPage;
  code: string;
  strings: UniversityStrings;
  lang: Lang;
  tile: (item: CountryPage["others"][number], showPlace: boolean, position: number, spaceBefore?: number) => NearItem;
}) {
  let position = 0;
  const items: NearItem[] = [];
  page.groups.forEach((group, groupIndex) => {
    const cityKey = group.cityKey;
    items.push(
      nodeItem(
        `group:${cityKey ?? group.title}`,
        <GroupHeading title={group.title} counts={placeCounts(strings, group.universities.length, null, lang)} onOpen={cityKey ? () => open(cityRoute(code, cityKey)) : null} />,
        groupIndex === 0 ? undefined : 20,
      ),
    );
    for (const item of group.universities) {
      items.push(tile(item, false, position, 12));
      position += 1;
    }
  });
  return <NearList gap={12} items={items} />;
}

/** Заголовок группы «Списком»: название и число вузов; у города со страницей это кнопка (цель 44, подсказка «Открыть страницу города»). */
function GroupHeading({ title, counts, onOpen }: { title: string; counts: string; onOpen: (() => void) | null }) {
  const { m } = useLang();
  const text = (
    <Text variant="heading" accessibilityRole={onOpen === null ? "header" : undefined}>
      {title}{" "}
      <Text variant="secondary" tone="text2">
        {counts}
      </Text>
    </Text>
  );
  if (onOpen === null) return text;
  return (
    <Pressable accessibilityRole="header" accessibilityLabel={`${title}, ${counts}`} accessibilityHint={m("uni.cityOpenHint")} onPress={onOpen} style={{ minHeight: MIN_TARGET, justifyContent: "center" }} testID="group-open">
      {text}
    </Pressable>
  );
}
