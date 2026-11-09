// «Университеты»: шесть карточек стран и поиск по названию по всем странам (веб S3, 7.3).
import { Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { CatalogFrame } from "./CatalogFrame";
import { useFavoriteState } from "./FavoritesContext";
import { countryCards, searchIndex, tileModel } from "./model";
import { CountryCardView, UniversityTileView } from "./parts";

export function UniversitiesScreen() {
  const { t, lang } = useLang();
  const strings = t("universities");
  const { tokens } = useTheme();
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
            <View
              style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderColor: tokens.controlEdge, borderRadius: tokens.radiusControl, backgroundColor: tokens.surface }}
            >
              <Search size={18} strokeWidth={1.75} color={tokens.text2} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                accessibilityLabel={strings.searchLabel}
                placeholder={strings.searchPlaceholder}
                placeholderTextColor={tokens.text2}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                testID="university-search"
                style={{ flex: 1, minHeight: 44, color: tokens.text, fontFamily: sansFont(), fontSize: tokens.sizeBody }}
              />
              {query !== "" ? (
                <Pressable accessibilityRole="button" accessibilityLabel={strings.searchClear} onPress={() => setQuery("")} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center", marginRight: -8 }}>
                  <X size={18} strokeWidth={1.75} color={tokens.text2} />
                </Pressable>
              ) : null}
            </View>
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
