// Карточки каталога: страна, город, вуз. Вся карточка - одна кнопка (веб: ссылка названия растянута на карточку), а «©» и
// сердечко лежат над ней отдельными элементами на углах фото и нажимаются сами по себе: так их слышит читалка
// (вложенная кнопка скрывается вместе с содержимым карточки, G44) и так же устроен веб (UniversityTile.tsx, Places.tsx).
import { memo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

import type { CityCard, CountryCard, TileModel, UniversityStrings } from "./model";
import { PhotoCredit } from "./PhotoCredit";
import { cityRoute, countryRoute, FavoriteHeart, geographyUrls, open, RemotePhoto, universityRoute, universityUrls, usePhotoPixels } from "./parts";
import { geographyPhotoCredit, universityPhotoCredit } from "./photos";

/** Высоты фото карточек (px). */
export const COUNTRY_PHOTO = 140;
export const CITY_PHOTO = 120;
export const TILE_PHOTO = 150;
/**
 * Потолок ширины копии: веб отдаёт карточке вуза копии до 640 px (`TILE_WIDTHS` в university-tiles.ts), карточке места до
 * 1200 px (`PLACE_CARD_WIDTHS`). Приложение брало ширину экрана целиком (до 1280 px), и 165 карточек Китая держали 165
 * картинок по 1-2 МБ в памяти (G47).
 */
export const TILE_PHOTO_PIXELS = 640;
export const PLACE_PHOTO_PIXELS = 1200;

/**
 * Каркас карточки: одна кнопка с подписью читалки и слой над фото для «©» и сердечка. Нажатие сжимает всю карточку, как
 * прежде (слой лежит вне кнопки, поэтому состояние нажатия хранит каркас).
 */
function CardShell({
  onPress,
  label,
  hint,
  testID,
  photoHeight,
  overlay,
  children,
}: {
  onPress: () => void;
  label: string;
  hint?: string;
  testID?: string;
  photoHeight: number;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const { tokens, scheme } = useTheme();
  const [pressed, setPressed] = useState(false);
  return (
    <View
      style={{
        backgroundColor: tokens.surface,
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        overflow: "hidden",
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
        transform: [{ scale: pressed ? tokens.pressScale : 1 }],
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} testID={testID}>
        {children}
      </Pressable>
      {overlay ? (
        <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: photoHeight }}>
          {overlay}
        </View>
      ) : null}
    </View>
  );
}

export function CountryCardView({ card, strings, photoActive = true }: { card: CountryCard; strings: UniversityStrings; photoActive?: boolean }) {
  const pixels = usePhotoPixels(PLACE_PHOTO_PIXELS);
  const urls = geographyUrls(card.photo, pixels);
  const [shown, setShown] = useState(urls !== null);
  return (
    <CardShell
      onPress={() => open(countryRoute(card.code))}
      label={`${card.name}. ${card.counts}`}
      testID={`country-${card.code}`}
      photoHeight={COUNTRY_PHOTO}
      overlay={card.photo !== null && shown ? <PhotoCredit credit={geographyPhotoCredit(card.photo)} strings={strings} placement="top" testID={`credit-${card.code}`} /> : null}
    >
      <RemotePhoto urls={urls} height={COUNTRY_PHOTO} label={card.name} strings={strings} rounded={false} decorative active={photoActive} onDisplay={setShown} testID={`photo-${card.code}`} />
      <View style={{ padding: 12, gap: 2 }}>
        <Text variant="heading">{card.name}</Text>
        <Text variant="secondary" tone="text2">
          {card.counts}
        </Text>
      </View>
    </CardShell>
  );
}

export function CityCardView({ card, code, strings, photoActive = true }: { card: CityCard; code: string; strings: UniversityStrings; photoActive?: boolean }) {
  const pixels = usePhotoPixels(PLACE_PHOTO_PIXELS);
  const urls = geographyUrls(card.photo, pixels);
  const [shown, setShown] = useState(urls !== null);
  return (
    <CardShell
      onPress={() => open(cityRoute(code, card.key))}
      label={[card.name, card.count, card.summary, `${strings.cityFactLabel}: ${card.fact}`].join(". ")}
      testID={`city-${card.key}`}
      photoHeight={CITY_PHOTO}
      overlay={shown ? <PhotoCredit credit={geographyPhotoCredit(card.photo)} strings={strings} placement="top" testID={`credit-${card.key}`} /> : null}
    >
      <RemotePhoto urls={urls} height={CITY_PHOTO} label={card.name} strings={strings} rounded={false} decorative active={photoActive} onDisplay={setShown} testID={`photo-${card.key}`} />
      <View style={{ padding: 12, gap: 6 }}>
        <View style={{ gap: 2 }}>
          <Text variant="heading">{card.name}</Text>
          <Text variant="secondary" tone="text2">
            {card.count}
          </Text>
        </View>
        {/* Полное описание и «Интересный факт», как у веба (Places.tsx, CityCards): прежде описание резалось на двух строках, факта не было. */}
        <Text variant="secondary">{card.summary}</Text>
        <View style={{ gap: 2 }}>
          <Text variant="caption" tone="text2" bold>
            {strings.cityFactLabel}
          </Text>
          <Text variant="secondary">{card.fact}</Text>
        </View>
      </View>
    </CardShell>
  );
}

/** Уровни вуза маленькими «таблетками» (веб: `.pt-chip`). */
function LevelChips({ levels }: { levels: readonly string[] }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} testID="level-chips">
      {levels.map((level) => (
        <View key={level} style={{ minHeight: 26, paddingHorizontal: 10, paddingVertical: 2, justifyContent: "center", borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusChip, backgroundColor: tokens.bg }}>
          <Text variant="caption" tone="text2">
            {level}
          </Text>
        </View>
      ))}
    </View>
  );
}

type TileViewProps = {
  tile: TileModel;
  strings: UniversityStrings;
  favored: boolean | null;
  onToggle: (id: string, next: boolean) => void;
  photoActive?: boolean;
  priority?: "low" | "normal" | "high";
};

/** Та же карточка: модель сравнивается по содержимому (экран строит её заново при каждой отрисовке), остальное - как есть. */
function sameTileProps(a: TileViewProps, b: TileViewProps): boolean {
  const x = a.tile;
  const y = b.tile;
  return (
    a.strings === b.strings &&
    a.favored === b.favored &&
    a.onToggle === b.onToggle &&
    a.photoActive === b.photoActive &&
    a.priority === b.priority &&
    (x === y || (x.id === y.id && x.name === y.name && x.place === y.place && x.intake === y.intake && x.photoKey === y.photoKey && x.levels.length === y.levels.length && x.levels.every((level, i) => level === y.levels[i])))
  );
}

/**
 * Карточка вуза: фото, место, название, уровни, ближайший набор. Сердечко (если избранное известно) в углу фото, «©» в другом.
 * `photoActive` - окно прокрутки (NearList): вдали от экрана фото не грузится. Подпись читалки собрана из всего, что видит глаз:
 * название, место, уровни, ближайший набор; «Программы и сроки» - подсказка действия. Перерисовывается, только если изменилась
 * она сама (окно прокрутки меняет `photoActive` у единиц карточек из 165, остальные не трогаются).
 */
export const UniversityTileView = memo(function UniversityTileView({
  tile,
  strings,
  favored,
  onToggle,
  photoActive = true,
  priority,
}: TileViewProps) {
  const pixels = usePhotoPixels(TILE_PHOTO_PIXELS);
  const urls = universityUrls(tile.photoKey, pixels);
  const credit = universityPhotoCredit(tile.photoKey);
  const [shown, setShown] = useState(urls !== null);
  const label = [tile.name, tile.place, tile.levels.length > 0 ? `${strings.levelLabel}: ${tile.levels.join(", ")}` : null, `${strings.nearestIntake}: ${tile.intake}`].filter((part): part is string => part !== null && part !== "").join(". ");
  return (
    <CardShell
      onPress={() => open(universityRoute(tile.id))}
      label={label}
      hint={strings.openCard}
      testID={`tile-${tile.id}`}
      photoHeight={TILE_PHOTO}
      overlay={
        <>
          {favored !== null ? (
            <View style={{ position: "absolute", top: 10, right: 10 }}>
              <FavoriteHeart favored={favored} name={tile.name} onToggle={() => onToggle(tile.id, !favored)} strings={strings} onPhoto />
            </View>
          ) : null}
          {shown && credit !== null ? <PhotoCredit credit={credit} universityName={tile.name} strings={strings} placement="bottom" testID={`credit-${tile.id}`} /> : null}
        </>
      }
    >
      <RemotePhoto urls={urls} height={TILE_PHOTO} label={tile.name} strings={strings} rounded={false} active={photoActive} priority={priority} onDisplay={setShown} />
      <View style={{ padding: 12, gap: 6 }}>
        <View style={{ gap: 2 }}>
          <Text variant="heading">{tile.name}</Text>
          {tile.place ? (
            <Text variant="secondary" tone="text2">
              {tile.place}
            </Text>
          ) : null}
        </View>
        {tile.levels.length > 0 ? <LevelChips levels={tile.levels} /> : null}
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.nearestIntake}:{" "}
          </Text>
          {tile.intake}
        </Text>
      </View>
    </CardShell>
  );
}, sameTileProps);
