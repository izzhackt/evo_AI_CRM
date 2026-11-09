// Страна: шапка с фото, «Города · Списком · Карта» (`?view=`: без параметра города, `list`,
// `map`; иное - 404), карточки городов, «Другие вузы страны», «Списком» по городам, карта.
// Веб: src/app/(portal)/portal/universities/country/[code]/page.tsx.
import { useLocalSearchParams, router } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { countryCodeFromSlug } from "@web/lib/portal/university-index";
import { formatPortalString } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { EmptyBlock } from "@/ui/CardParts";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { Landmark } from "lucide-react-native";

import { CatalogFrame } from "./CatalogFrame";
import { CatalogMap } from "./CatalogMap";
import { useFavoriteState } from "./FavoritesContext";
import { countryPageModel, placeCounts, tileModel } from "./model";
import { CityCardView, geographyUrls, open, PathRow, PhotoCredit, RemotePhoto, universityRoute, UniversityTileView, usePhotoPixels } from "./parts";
import { geographyPhotoCredit } from "./photos";
import { NotFoundBlock } from "./NotFoundBlock";

type View_ = "cities" | "list" | "map";

/** `?view=`: только `list` и `map` (или без параметра); иное - null (неверный адрес). */
export function viewFromParam(value: string | string[] | undefined): View_ | null {
  if (value === undefined) return "cities";
  return value === "list" || value === "map" ? value : null;
}

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
  const [mapFailed, setMapFailed] = useState(false);
  return (
    <CatalogFrame>
      {(index) => {
        const page = countryPageModel(index, code, strings, lang);
        if (page === null) return <NotFoundBlock />;
        const tile = (item: (typeof page.others)[number], showPlace: boolean) => (
          <UniversityTileView key={item.id} tile={tileModel(index, item, { strings, lang, now, showPlace })} strings={strings} favored={favorites.isFavored(item.id)} onToggle={favorites.toggle} />
        );
        return (
          <View style={{ gap: 16 }}>
            <PathRow crumbs={[page.name]} strings={strings} />
            <View style={{ gap: 8 }}>
              <RemotePhoto urls={geographyUrls(page.country.photo, pixels)} height={view === "cities" ? 180 : 110} label={page.name} strings={strings} />
              {page.country.photo ? <PhotoCredit credit={geographyPhotoCredit(page.country.photo)} strings={strings} /> : null}
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
                action={<Button variant="ghost" label={strings.allCountries} onPress={() => open("/universities")} />}
              />
            ) : (
              <>
                <Segmented<View_>
                  value={view}
                  testIDPrefix="view"
                  options={[
                    { value: "cities", label: strings.viewCities },
                    { value: "list", label: strings.viewList },
                    { value: "map", label: strings.viewMap },
                  ]}
                  onChange={(next) => router.setParams({ view: next === "cities" ? undefined : next } as never)}
                />
                {view === "map" ? (
                  <View style={{ gap: 8 }}>
                    {mapFailed || page.pins.length === 0 ? (
                      <Text variant="secondary" tone="text2" testID="map-failed">
                        {page.pins.length === 0 ? formatPortalString(strings.mapWithoutPoint, { count: String(page.missingPins) }) : strings.mapFailed}
                      </Text>
                    ) : (
                      <>
                        <CatalogMap pins={page.pins} onOpen={(id) => open(universityRoute(id))} onFail={() => setMapFailed(true)} />
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
                  <View style={{ gap: 20 }}>
                    {page.groups.map((group) => (
                      <View key={group.cityKey ?? group.title} style={{ gap: 12 }}>
                        <Text variant="heading" accessibilityRole="header" onPress={group.cityKey ? () => open(`/universities/country/${code.toLowerCase()}/${group.cityKey}`) : undefined}>
                          {group.title}{" "}
                          <Text variant="secondary" tone="text2">
                            {placeCounts(strings, group.universities.length, null, lang)}
                          </Text>
                        </Text>
                        {group.universities.map((item) => tile(item, false))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ gap: 20 }}>
                    {page.cityCards.length > 0 ? (
                      <View style={{ gap: 16 }} accessibilityLabel={strings.citiesHeading}>
                        {page.cityCards.map((card) => (
                          <CityCardView key={card.key} card={card} code={code} strings={strings} />
                        ))}
                      </View>
                    ) : null}
                    {page.others.length > 0 ? (
                      <View style={{ gap: 12 }}>
                        <View style={{ gap: 2 }}>
                          <Text variant="heading" accessibilityRole="header">
                            {strings.otherUniversitiesHeading}
                          </Text>
                          <Text variant="secondary" tone="text2">
                            {strings.otherUniversitiesLead}
                          </Text>
                        </View>
                        {page.others.map((item) => tile(item, true))}
                      </View>
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
