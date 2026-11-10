// Город: шапка с фото и текстом, факт со ссылкой «Источник», карточки вузов города.
// Город без фото страницы не имеет (веб: 404).
import { useLocalSearchParams } from "expo-router";
import { Linking, View } from "react-native";
import { useMemo } from "react";

import { countryCodeFromSlug, localizedText } from "@web/lib/portal/university-index";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

import { CatalogFrame } from "./CatalogFrame";
import { useFavoriteState } from "./FavoritesContext";
import { cityPageModel, tileModel } from "./model";
import { geographyUrls, PathRow, PhotoCredit, RemotePhoto, UniversityTileView, usePhotoPixels } from "./parts";
import { geographyPhotoCredit } from "./photos";
import { NotFoundBlock } from "./NotFoundBlock";

export function CityScreen() {
  const params = useLocalSearchParams<{ code: string; city: string }>();
  const code = countryCodeFromSlug(String(params.code ?? ""));
  const cityKey = String(params.city ?? "");
  const { t, lang } = useLang();
  const { tokens } = useTheme();
  const strings = t("universities");
  const favorites = useFavoriteState();
  const pixels = usePhotoPixels();
  const now = useMemo(() => new Date(), []);
  if (code === null) return <NotFoundBlock />;
  return (
    <CatalogFrame>
      {(index) => {
        const page = cityPageModel(index, code, cityKey, strings, lang);
        const country = index.countries.find((entry) => entry.code === code);
        if (page === null || !country) return <NotFoundBlock />;
        return (
          <View style={{ gap: 16 }}>
            <PathRow crumbs={[localizedText(country.name, lang), page.name]} strings={strings} />
            <View style={{ gap: 8 }}>
              <RemotePhoto urls={geographyUrls(page.city.photo, pixels)} height={180} label={page.name} strings={strings} />
              <PhotoCredit credit={geographyPhotoCredit(page.city.photo)} strings={strings} />
              <Text variant="title" accessibilityRole="header">
                {page.name}
              </Text>
              <Text variant="secondary" tone="text2">
                {page.counts}
              </Text>
              <Text variant="body">{page.summary}</Text>
              <View style={{ gap: 4, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.accentSoft }}>
                <Text variant="caption" tone="accent" bold>
                  {strings.cityFactLabel}
                </Text>
                <Text variant="secondary">{page.fact}</Text>
                <Text variant="secondary" tone="accent" bold accessibilityRole="link" onPress={() => void Linking.openURL(page.city.fact.sourceUrl).catch(() => undefined)}>
                  {strings.factSource}
                </Text>
              </View>
            </View>
            <Text variant="heading" accessibilityRole="header">
              {strings.cityUniversitiesHeading}
            </Text>
            {page.universities.map((item) => (
              <UniversityTileView key={item.id} tile={tileModel(index, item, { strings, lang, now, showPlace: false })} strings={strings} favored={favorites.isFavored(item.id)} onToggle={favorites.toggle} />
            ))}
          </View>
        );
      }}
    </CatalogFrame>
  );
}
