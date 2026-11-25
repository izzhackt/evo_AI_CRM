// Строители пунктов для NearList: карточка вуза, карточка города, заголовок. Один вид пункта на всех экранах каталога, чтобы
// порядок, ключи и подписи не расходились (поиск, «Другие вузы», «Списком», вузы города).
import type { ReactNode } from "react";
import { View } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";

import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { useAnnounceResults } from "./announce-results";
import { CityCardView, UniversityTileView } from "./cards";
import type { useFavoriteState } from "./FavoritesContext";
import type { CityCard, TileModel, UniversityStrings } from "./model";
import type { NearItem } from "./NearList";

type Favorites = ReturnType<typeof useFavoriteState>;

/** Сколько первых карточек списка грузятся с высоким приоритетом (веб: первые три - `priority`). */
const FIRST_PRIORITY = 3;

export function tileItem({
  id,
  tile,
  strings,
  favorites,
  position = Number.MAX_SAFE_INTEGER,
  spaceBefore,
}: {
  id: string;
  tile: TileModel;
  strings: UniversityStrings;
  favorites: Favorites;
  /** Номер карточки в списке: первые получают высокий приоритет загрузки. */
  position?: number;
  spaceBefore?: number;
}): NearItem {
  const favored = favorites.isFavored(id);
  return {
    key: `uni:${id}`,
    spaceBefore,
    render: (near) => <UniversityTileView tile={tile} strings={strings} favored={favored} onToggle={favorites.toggle} photoActive={near} priority={position < FIRST_PRIORITY ? "high" : undefined} />,
  };
}

export function cityItem({ card, code, strings, spaceBefore }: { card: CityCard; code: string; strings: UniversityStrings; spaceBefore?: number }): NearItem {
  return { key: `city:${card.key}`, spaceBefore, render: (near) => <CityCardView card={card} code={code} strings={strings} photoActive={near} /> };
}

/** Пункт без картинки (заголовок раздела, строка): рисуется всегда одинаково. */
export function nodeItem(key: string, node: ReactNode, spaceBefore?: number): NearItem {
  return { key, spaceBefore, render: () => node };
}

/**
 * Состояние поиска: «Найдено: N» (читалка слышит его при каждом изменении) или «ничего не нашлось» с кнопкой «Очистить поиск»
 * (веб: UniversitySearch.tsx, `role="status"` и кнопка очистки в пустом результате).
 */
export function ResultsStatus({ found, trimmed, strings, onClear }: { found: number | null; trimmed: string; strings: UniversityStrings; onClear: () => void }) {
  const message = found === null ? null : found === 0 ? formatPortalString(strings.searchEmptyTitle, { query: trimmed }) : formatPortalString(strings.searchFound, { count: String(found) });
  useAnnounceResults(message);
  if (found === null) return null;
  if (found === 0) {
    return (
      <View style={{ gap: 8, alignItems: "flex-start" }} testID="search-empty">
        <View style={{ gap: 4 }}>
          <Text variant="body" bold>
            {message}
          </Text>
          <Text variant="secondary" tone="text2">
            {strings.searchEmptyBody}
          </Text>
        </View>
        <Button variant="ghost" label={strings.searchClear} onPress={onClear} testID="search-empty-clear" />
      </View>
    );
  }
  return (
    <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite" testID="search-status">
      {message}
    </Text>
  );
}
