// Общие части «Университетов»: фото с запасным адресом и подписью, сердечко, карточки
// страны, города и вуза, строка пути. Фото вуза - только из нашего бакета по манифесту,
// без него заглушка (веб: план 4.4, приёмка 7.6.5).
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { ChevronLeft, Heart, ImageOff } from "lucide-react-native";
import { useState } from "react";
import { Linking, PixelRatio, Pressable, View, useWindowDimensions } from "react-native";

import { formatPortalString } from "@web/lib/portal/i18n";
import type { IndexUniversity } from "@web/lib/portal/university-index";

import { getConfig } from "@/config";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import type { CityCard, CountryCard, TileModel, UniversityStrings } from "./model";
import { geographyPhotoUrls, universityPhotoUrls, type PhotoCreditView, type PhotoUrls } from "./photos";

export const open = (href: string) => router.push(href as Href);
export const universityRoute = (id: string) => `/universities/${id}`;
export const countryRoute = (code: string, view: "cities" | "list" | "map" = "cities") =>
  `/universities/country/${code.toLowerCase()}${view === "cities" ? "" : `?view=${view}`}`;
export const cityRoute = (code: string, key: string) => `/universities/country/${code.toLowerCase()}/${key}`;

function supabaseUrl(): string {
  return getConfig().supabaseUrl;
}

/** Фото: копия нужной ширины, при отказе оригинал, при отказе обоих - заглушка (`quiet` - без значка и надписи). */
export function RemotePhoto({ urls, height, label, strings, rounded = true, quiet = false }: { urls: PhotoUrls | null; height: number; label: string; strings: UniversityStrings; rounded?: boolean; quiet?: boolean }) {
  const { tokens } = useTheme();
  const [stage, setStage] = useState<"sized" | "original" | "failed">("sized");
  const uri = urls === null ? null : stage === "sized" ? (urls.sized ?? urls.original) : stage === "original" ? urls.original : null;
  const radius = rounded ? tokens.radiusItem : 0;
  if (uri === null && quiet) {
    // Маленькая карточка («Мои вузы» на Главной): серая подложка без надписи, название стоит под ней (как на вебе).
    return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height, borderRadius: radius, backgroundColor: tokens.skeleton }} />;
  }
  if (uri === null) {
    return (
      <View
        accessible
        accessibilityLabel={urls === null ? strings.photoMissing : strings.photoFailed}
        style={{ height, borderRadius: radius, backgroundColor: tokens.skeleton, alignItems: "center", justifyContent: "center", gap: 6, padding: 12 }}
      >
        <ImageOff size={20} strokeWidth={1.75} color={tokens.text2} />
        <Text variant="caption" tone="text2" style={{ textAlign: "center" }}>
          {urls === null ? strings.photoMissing : strings.photoFailed}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      contentFit="cover"
      transition={150}
      onError={() => setStage((s) => (s === "sized" && urls?.sized ? "original" : "failed"))}
      style={{ height, borderRadius: radius, backgroundColor: tokens.skeleton }}
    />
  );
}

/** Ширина колонки в физических пикселях: по ней выбирается шаг копии. */
export function usePhotoPixels(): number {
  const { width } = useWindowDimensions();
  return Math.round((width - 32) * PixelRatio.get());
}

export function universityUrls(photoKey: string | null, pixels: number): PhotoUrls | null {
  return universityPhotoUrls(photoKey, supabaseUrl(), pixels);
}
export function geographyUrls(photo: Parameters<typeof geographyPhotoUrls>[0], pixels: number): PhotoUrls | null {
  return geographyPhotoUrls(photo, supabaseUrl(), pixels);
}

/** «©»: автор и лицензия по нажатию; ссылка на источник открывается в браузере. */
export function PhotoCredit({ credit, universityName, strings }: { credit: PhotoCreditView | null; universityName?: string; strings: UniversityStrings }) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const [shown, setShown] = useState(false);
  if (credit === null) return null;
  const line = credit.kind === "official"
    ? formatPortalString(strings.photoCreditOfficial, { university: universityName ?? "" })
    : credit.sourceName
      ? formatPortalString(strings.photoCreditSource, { author: credit.author, source: credit.sourceName, license: credit.license })
      : formatPortalString(strings.photoCredit, { author: credit.author, license: credit.license });
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown ? m("uni.creditHide") : strings.photoRights}
        onPress={() => setShown((v) => !v)}
        style={{ minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start" }}
        hitSlop={4}
      >
        <Text variant="caption" tone="text2" bold>
          © {strings.photoRights}
        </Text>
      </Pressable>
      {shown ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(credit.sourceUrl).catch(() => undefined)}>
          <Text variant="caption" style={{ color: tokens.accent }}>
            {line}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FavoriteHeart({ favored, name, onToggle, strings }: { favored: boolean; name: string; onToggle: () => void; strings: UniversityStrings }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${favored ? strings.favoriteRemove : strings.favoriteAdd}: ${name}`}
      accessibilityState={{ selected: favored }}
      onPress={onToggle}
      hitSlop={4}
      testID={`heart-${name}`}
      style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
    >
      <Heart size={22} strokeWidth={1.75} color={favored ? tokens.accent : tokens.text2} fill={favored ? tokens.accent : "none"} />
    </Pressable>
  );
}

/** Строка пути: назад и цепочка «Университеты › Страна › Город». */
export function PathRow({ crumbs, strings }: { crumbs: readonly string[]; strings: UniversityStrings }) {
  const { tokens } = useTheme();
  const { m, format } = useLang();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: -8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m("uni.back")}
        onPress={() => (router.canGoBack() ? router.back() : open("/universities"))}
        style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
        testID="path-back"
      >
        <ChevronLeft size={24} strokeWidth={1.75} color={tokens.text} />
      </Pressable>
      <Text variant="caption" tone="text2" numberOfLines={1} style={{ flex: 1 }} accessibilityLabel={format(m("uni.pathLabel"), { path: crumbs.join(", ") })}>
        {[strings.title, ...crumbs].join(" › ")}
      </Text>
    </View>
  );
}

function CardFrame({ children, onPress, label, testID }: { children: React.ReactNode; onPress: () => void; label: string; testID?: string }) {
  const { tokens, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        backgroundColor: tokens.surface,
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        overflow: "hidden",
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
        transform: [{ scale: pressed ? tokens.pressScale : 1 }],
      })}
    >
      {children}
    </Pressable>
  );
}

export function CountryCardView({ card, strings }: { card: CountryCard; strings: UniversityStrings }) {
  const pixels = usePhotoPixels();
  return (
    <CardFrame onPress={() => open(countryRoute(card.code))} label={`${card.name}. ${card.counts}`} testID={`country-${card.code}`}>
      <RemotePhoto urls={geographyUrls(card.photo, pixels)} height={140} label={card.name} strings={strings} rounded={false} />
      <View style={{ padding: 12, gap: 2 }}>
        <Text variant="heading">{card.name}</Text>
        <Text variant="secondary" tone="text2">
          {card.counts}
        </Text>
      </View>
    </CardFrame>
  );
}

export function CityCardView({ card, code, strings }: { card: CityCard; code: string; strings: UniversityStrings }) {
  const pixels = usePhotoPixels();
  return (
    <CardFrame onPress={() => open(cityRoute(code, card.key))} label={`${card.name}. ${card.count}`} testID={`city-${card.key}`}>
      <RemotePhoto urls={geographyUrls(card.photo, pixels)} height={120} label={card.name} strings={strings} rounded={false} />
      <View style={{ padding: 12, gap: 2 }}>
        <Text variant="heading">{card.name}</Text>
        <Text variant="secondary" tone="text2">
          {card.count}
        </Text>
        <Text variant="caption" tone="text2" numberOfLines={2}>
          {card.summary}
        </Text>
      </View>
    </CardFrame>
  );
}

/** Карточка вуза: фото, название, место, уровни, ближайший набор, сердечко (если избранное известно). */
export function UniversityTileView({ tile, strings, favored, onToggle }: { tile: TileModel; strings: UniversityStrings; favored: boolean | null; onToggle: (id: string, next: boolean) => void }) {
  const pixels = usePhotoPixels();
  const urls = universityUrls(tile.photoKey, pixels);
  return (
    <CardFrame onPress={() => open(universityRoute(tile.id))} label={`${tile.name}. ${tile.place ? `${tile.place}. ` : ""}${strings.openCard}`} testID={`tile-${tile.id}`}>
      <RemotePhoto urls={urls} height={150} label={tile.name} strings={strings} rounded={false} />
      <View style={{ padding: 12, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
          <Text variant="heading" style={{ flex: 1 }}>
            {tile.name}
          </Text>
          {favored !== null ? <FavoriteHeart favored={favored} name={tile.name} onToggle={() => onToggle(tile.id, !favored)} strings={strings} /> : null}
        </View>
        {tile.place ? (
          <Text variant="secondary" tone="text2">
            {tile.place}
          </Text>
        ) : null}
        {tile.levels.length > 0 ? (
          <Text variant="secondary">
            <Text variant="secondary" tone="text2">
              {strings.levelLabel}:{" "}
            </Text>
            {tile.levels.join(", ")}
          </Text>
        ) : null}
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.nearestIntake}:{" "}
          </Text>
          {tile.intake}
        </Text>
      </View>
    </CardFrame>
  );
}

export type { IndexUniversity };
