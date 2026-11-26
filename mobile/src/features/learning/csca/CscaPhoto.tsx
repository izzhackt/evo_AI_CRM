// Фото кампуса в обзоре CSCA (веб: OverviewPhoto в components/portal/csca/Overview.tsx и PhotoRights.tsx): кадр по точке
// из манифеста фото, тихая кнопка «©» в углу, по нажатию автор и лицензия со ссылками на страницу фото и на лицензию.
// Текст подписи берётся из общего словаря веба (`universities.photoCredit`), литералов «Pexels» здесь нет. Кнопка и
// панель одного цвета в светлой и тёмной теме (как `.pt-photo-rights` веба): белое «©» на тёмном круге.
import { Image } from "expo-image";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { CSCA_OVERVIEW_PHOTOS, type CscaPhoto as CscaPhotoRecord } from "@web/lib/portal/csca-overview";

import { photoSource } from "@/features/learning/csca/overview-photos";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Тёмная подложка кнопки и панели: `rgb(20 16 12 / 0.55)` и `/ 0.86` в portal.css. */
const SCRIM = "rgba(20, 16, 12, 0.55)";
const PANEL = "rgba(20, 16, 12, 0.86)";
const ON_PHOTO = "#ffffff";

/** «50% 55%» из манифеста в точку кадра `contentPosition`; неразобранное значение даёт середину. */
export function photoPosition(value: string): { left: `${number}%`; top: `${number}%` } {
  const match = /^(\d{1,3})%\s+(\d{1,3})%$/u.exec(value.trim());
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return match ? { left: `${clamp(Number(match[1]))}%`, top: `${clamp(Number(match[2]))}%` } : { left: "50%", top: "50%" };
}

function open(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

/** Шаблон словаря «Фото: {author}, {license}» с готовыми ссылками на месте подстановок. */
function Credit({ template, photo }: { template: string; photo: CscaPhotoRecord }) {
  const parts = template.split(/(\{[a-z]+\})/u);
  const link = (label: string, url: string) => (
    <Text key={label} variant="caption" accessibilityRole="link" onPress={() => open(url)} style={{ color: ON_PHOTO, textDecorationLine: "underline" }}>
      {label}
    </Text>
  );
  return (
    <Text variant="caption" style={{ color: ON_PHOTO }}>
      {parts.map((part, index) => {
        if (part === "{author}") return link(photo.author, photo.sourceUrl);
        if (part === "{license}") return link(photo.licence, photo.licenceUrl);
        return part === "" ? null : <Text key={index} variant="caption" style={{ color: ON_PHOTO }}>{part}</Text>;
      })}
    </Text>
  );
}

export function CscaPhoto({ photoKey, aspectRatio, rounded = false, testID }: { photoKey: string; aspectRatio: number; rounded?: boolean; testID?: string }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const [shown, setShown] = useState(false);
  const photo = CSCA_OVERVIEW_PHOTOS.find((entry) => entry.key === photoKey);
  const source = photo ? photoSource(photo) : null;
  if (!photo || !source) return null;
  const rights = t("universities");
  return (
    <View testID={testID} style={{ aspectRatio, overflow: "hidden", backgroundColor: tokens.skeleton, borderRadius: rounded ? tokens.radiusItem : 0 }}>
      <Image source={source} contentFit="cover" contentPosition={photoPosition(photo.objectPosition)} accessibilityLabel={photo.alt[lang]} style={{ width: "100%", height: "100%" }} />
      <View style={{ position: "absolute", right: 2, bottom: 2, alignItems: "flex-end", maxWidth: "100%" }}>
        {shown ? (
          <View style={{ maxWidth: 260, marginRight: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: tokens.radiusItem, backgroundColor: PANEL }} testID="photo-credit">
            <Credit template={rights.photoCredit} photo={photo} />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rights.photoRights}
          accessibilityState={{ expanded: shown }}
          onPress={() => setShown((value) => !value)}
          testID="photo-credit-toggle"
          style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: shown ? PANEL : SCRIM, alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" style={{ color: ON_PHOTO, fontSize: 14, lineHeight: 16 }}>
              ©
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
