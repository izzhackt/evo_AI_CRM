// «Университеты»: шесть карточек стран и поиск по городу и названию вуза по всем странам (веб S3, 7.3).
import { useMemo, useState } from "react";
import { View } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

import { CatalogFrame } from "./CatalogFrame";
import { useFavoriteState } from "./FavoritesContext";
import { countryCards, searchIndex, tileModel } from "./model";
import { CountryCardView, UniversityTileView } from "./parts";

export function UniversitiesScreen() {
  const { t, lang } = useLang();
  const strings = t("universities");
  const [query, setQuery] = useState("");
  const favorites = useFavoriteState();
  const now = useMemo(() => new Date(), []);
  return (
    <CatalogFrame
      header={
        <View style={{ gap: 4 }}>
          <Text variant="title" accessibilityRole="header">
            {strings.title}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings.lead}
          </Text>
        </View>
      }
    >
      {(index) => {
        const trimmed = query.trim();
        const found = trimmed === "" ? null : searchIndex(index, trimmed);
        return (
          <View style={{ gap: 16 }}>
            <TextField
              label={strings.searchLabel}
              value={query}
              onChangeText={setQuery}
              placeholder={strings.searchPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              testID="university-search"
              clearLabel={strings.searchClear}
              onClear={() => setQuery("")}
            />
            {found === null ? (
              <View style={{ gap: 16 }} accessibilityLabel={strings.countriesHeading}>
                {countryCards(index, strings, lang).map((card) => (
                  <CountryCardView key={card.code} card={card} strings={strings} />
                ))}
              </View>
            ) : found.length === 0 ? (
              <View style={{ gap: 4 }} testID="search-empty">
                <Text variant="body" bold>
                  {formatPortalString(strings.searchEmptyTitle, { query: trimmed })}
                </Text>
                <Text variant="secondary" tone="text2">
                  {strings.searchEmptyBody}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 16 }}>
                <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite">
                  {formatPortalString(strings.searchFound, { count: String(found.length) })}
                </Text>
                {found.map((item) => (
                  <UniversityTileView
                    key={item.id}
                    tile={tileModel(index, item, { strings, lang, now, showPlace: true })}
                    strings={strings}
                    favored={favorites.isFavored(item.id)}
                    onToggle={favorites.toggle}
                  />
                ))}
              </View>
            )}
          </View>
        );
      }}
    </CatalogFrame>
  );
}
