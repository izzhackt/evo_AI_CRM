// Общие части «Университетов»: фото с запасным адресом и «©», сердечко, строка пути. Карточки страны, города и вуза - в
// cards.tsx. Фото вуза - только из нашего бакета по манифесту, без него заглушка (веб: план 4.4, приёмка 7.6.5).
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { ChevronLeft, ChevronRight, Heart, ImageOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { PixelRatio, Pressable, View, useWindowDimensions } from "react-native";

import { getConfig } from "@/config";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { PhotoCredit, type CreditPlacement } from "./PhotoCredit";
import type { UniversityStrings } from "./model";
import { geographyPhotoUrls, universityPhotoUrls, type PhotoCreditView, type PhotoUrls } from "./photos";

export { creditLine } from "./credit";
export { PhotoCredit } from "./PhotoCredit";

/** «Все страны»: маркер `all=1` отключает вход в страну студента. */
export const ALL_COUNTRIES_ROUTE = "/universities?all=1";
export const open = (href: string) => router.push(href as Href);
export const universityRoute = (id: string) => `/universities/${id}`;
export const countryRoute = (code: string, view: "cities" | "list" | "map" = "cities") =>
  `/universities/country/${code.toLowerCase()}${view === "cities" ? "" : `?view=${view}`}`;
export const cityRoute = (code: string, key: string) => `/universities/country/${code.toLowerCase()}/${key}`;

function supabaseUrl(): string {
  return getConfig().supabaseUrl;
}

/**
 * Фото: копия нужной ширины, при отказе оригинал, при отказе обоих - заглушка (`quiet` - без значка и надписи).
 * `active={false}` - окно прокрутки (NearList): фото далеко от экрана, вместо него ровная подложка того же размера, картинка не
 * грузится и не занимает память; раскладка от этого не меняется. `onDisplay` сообщает, есть ли что показывать (адрес есть и оба
 * запроса не отказали): рядом стоящая «©» прячется вместе с фото, как у веба (`.pt-place-media:not(:has(img)) .pt-photo-rights`).
 */
export function RemotePhoto({
  urls,
  height,
  label,
  strings,
  rounded = true,
  quiet = false,
  decorative = false,
  active = true,
  priority,
  onDisplay,
  testID,
}: {
  urls: PhotoUrls | null;
  height: number;
  label: string;
  strings: UniversityStrings;
  rounded?: boolean;
  quiet?: boolean;
  /** Фото - фон, его смысл несёт соседний текст (веб: `alt=""` у фото мест): читалка его пропускает. */
  decorative?: boolean;
  active?: boolean;
  priority?: "low" | "normal" | "high";
  onDisplay?: (shown: boolean) => void;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const [stage, setStage] = useState<"sized" | "original" | "failed">("sized");
  const uri = urls === null ? null : stage === "sized" ? (urls.sized ?? urls.original) : stage === "original" ? urls.original : null;
  const radius = rounded ? tokens.radiusItem : 0;
  const shown = uri !== null;
  useEffect(() => {
    onDisplay?.(shown);
  }, [onDisplay, shown]);
  if (uri !== null && !active) {
    // Далеко от экрана: ровная подложка без значка и надписи, чтобы не мигать подписью «нет фото» (фото есть, оно только не загружено).
    return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={testID ? `${testID}-idle` : undefined} style={{ height, borderRadius: radius, backgroundColor: tokens.skeleton }} />;
  }
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
      // В тихом режиме фото внутри карточки-ссылки: название уже читает сама карточка, не дублируем.
      accessibilityLabel={quiet || decorative ? undefined : label}
      accessibilityElementsHidden={quiet || decorative}
      importantForAccessibility={quiet || decorative ? "no-hide-descendants" : "auto"}
      testID={testID}
      contentFit="cover"
      priority={priority}
      transition={150}
      onError={() => setStage((s) => (s === "sized" && urls?.sized ? "original" : "failed"))}
      style={{ height, borderRadius: radius, backgroundColor: tokens.skeleton }}
    />
  );
}

/**
 * Фото-шапка с «©» в углу (страна, город, вуз): фото и кнопка одним блоком, кнопка прячется, если фото не показано.
 * `credit` без фото (нет адреса) ничего не рисует, кроме заглушки фото.
 */
export function CreditedPhoto({
  urls,
  height,
  label,
  strings,
  credit,
  universityName,
  placement,
  decorative = false,
  testID,
}: {
  urls: PhotoUrls | null;
  height: number;
  label: string;
  strings: UniversityStrings;
  credit: PhotoCreditView | null;
  universityName?: string;
  placement: CreditPlacement;
  decorative?: boolean;
  testID?: string;
}) {
  const [shown, setShown] = useState(urls !== null);
  return (
    <View>
      <RemotePhoto urls={urls} height={height} label={label} strings={strings} decorative={decorative} onDisplay={setShown} testID={testID} />
      {shown ? <PhotoCredit credit={credit} universityName={universityName} strings={strings} placement={placement} /> : null}
    </View>
  );
}

/**
 * Ширина колонки в физических пикселях: по ней выбирается шаг копии. `cap` - потолок: карточкам списков копии нужны меньше
 * шапок (веб: до 640 px у карточки вуза, до 1200 у карточки места), а память на 165 картинках ограничена.
 */
export function usePhotoPixels(cap?: number): number {
  const { width } = useWindowDimensions();
  const pixels = Math.round((width - 32) * PixelRatio.get());
  return cap === undefined ? pixels : Math.min(pixels, cap);
}

export function universityUrls(photoKey: string | null, pixels: number): PhotoUrls | null {
  return universityPhotoUrls(photoKey, supabaseUrl(), pixels);
}
export function geographyUrls(photo: Parameters<typeof geographyPhotoUrls>[0], pixels: number): PhotoUrls | null {
  return geographyPhotoUrls(photo, supabaseUrl(), pixels);
}

/**
 * Сердечко (веб: FavoriteToggle). `onPhoto` - на фото карточки в белом круге с тенью (`.pt-uni-card-fav .pt-favorite-btn`),
 * иначе рядом с названием. Оно не вложено в нажимаемую карточку, а лежит над ней отдельным элементом: читалка
 * доходит и до него (аудит паритета 25.11.2026, G44).
 */
export function FavoriteHeart({ favored, name, onToggle, strings, onPhoto = false }: { favored: boolean; name: string; onToggle: () => void; strings: UniversityStrings; onPhoto?: boolean }) {
  const { tokens, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${favored ? strings.favoriteRemove : strings.favoriteAdd}: ${name}`}
      accessibilityState={{ selected: favored }}
      onPress={onToggle}
      hitSlop={onPhoto ? 0 : 4}
      testID={`heart-${name}`}
      style={{
        width: MIN_TARGET,
        height: MIN_TARGET,
        alignItems: "center",
        justifyContent: "center",
        ...(onPhoto ? { borderRadius: MIN_TARGET / 2, backgroundColor: tokens.surface, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard } : null),
      }}
    >
      <Heart size={22} strokeWidth={1.75} color={favored ? tokens.accent : tokens.text2} fill={favored ? tokens.accent : "none"} />
    </Pressable>
  );
}

/** Звено пути: у предков `href` (веб: ссылки хлебных крошек), у текущей страницы `null`. */
export type Crumb = Readonly<{ label: string; href: string | null }>;

/**
 * Строка пути (веб: Breadcrumbs в Places.tsx): назад и ссылки «Университеты › Страна › Город › Вуз». Предки нажимаются
 * (цель 44), текущая страница - обычный текст. Первое звено «Университеты» ведёт на список стран и ставится само.
 */
export function PathRow({ crumbs, strings }: { crumbs: readonly Crumb[]; strings: UniversityStrings }) {
  const { tokens } = useTheme();
  const { m } = useLang();
  const all: readonly Crumb[] = [{ label: strings.title, href: ALL_COUNTRIES_ROUTE }, ...crumbs];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: -8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m("uni.back")}
        onPress={() => (router.canGoBack() ? router.back() : open(ALL_COUNTRIES_ROUTE))}
        style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
        testID="path-back"
      >
        <ChevronLeft size={24} strokeWidth={1.75} color={tokens.text} />
      </Pressable>
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center" }} testID="path-crumbs">
        {all.map((crumb, index) => (
          <View key={`${index}:${crumb.label}`} style={{ flexShrink: 1, flexDirection: "row", alignItems: "center" }}>
            {index > 0 ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <ChevronRight size={16} strokeWidth={1.5} color={tokens.text2} />
              </View>
            ) : null}
            {crumb.href !== null ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={crumb.label}
                onPress={() => open(crumb.href as string)}
                testID={`crumb-${index}`}
                style={{ minHeight: MIN_TARGET, paddingHorizontal: 4, justifyContent: "center" }}
              >
                <Text variant="secondary" tone="text2" numberOfLines={1}>
                  {crumb.label}
                </Text>
              </Pressable>
            ) : (
              <Text variant="secondary" numberOfLines={1} style={{ paddingHorizontal: 4, flexShrink: 1, fontFamily: sansFont("medium") }} testID="crumb-current">
                {crumb.label}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
