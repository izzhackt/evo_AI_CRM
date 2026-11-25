// Памятка «Каким должно быть фото» - пример у документа «Фото» (веб: DocumentGuidePhotoRules.tsx, 20.11.2026): размер
// страны и четыре картинки «правильно / очки / закрытые уши / светлая одежда». Рисунок - силуэт, а не фото человека;
// подписи и размер берутся из общего словаря веба (admission.guidePhoto*), цвета - из токенов (photo*).
import { Check, X } from "lucide-react-native";
import { View, useWindowDimensions } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import type { GuideCountry } from "@web/lib/portal/document-guides";

import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Variant = "ok" | "glasses" | "ears" | "clothes";

function Silhouette({ variant }: { variant: Variant }) {
  const { tokens } = useTheme();
  return (
    <Svg viewBox="0 0 66 84" width="100%" height="100%">
      {variant === "ears" ? <Ellipse cx="33" cy="33" rx="19" ry="22" fill={tokens.photoInk} /> : null}
      <Ellipse cx="16.5" cy="35" rx="3.2" ry="5" fill={tokens.photoSkin} />
      <Ellipse cx="49.5" cy="35" rx="3.2" ry="5" fill={tokens.photoSkin} />
      <Ellipse cx="33" cy="33" rx="15" ry="18" fill={tokens.photoSkin} />
      {variant === "ears" ? <Path d="M14 34c0-14 8-23 19-23s19 9 19 23c-3-8-10-12-19-12s-16 4-19 12z" fill={tokens.photoInk} /> : null}
      <Rect x="28" y="48" width="10" height="9" fill={tokens.photoSkin} />
      {variant === "clothes" ? (
        <Path d="M8 84c1-16 10-25 25-25s24 9 25 25z" fill={tokens.photoPaper} stroke={tokens.photoLine} strokeWidth={1.2} />
      ) : (
        <Path d="M8 84c1-16 10-25 25-25s24 9 25 25z" fill={tokens.photoInk} />
      )}
      {variant === "glasses" ? (
        <G fill="none" stroke={tokens.photoInk} strokeWidth={2.2}>
          <Circle cx="26" cy="33" r="5" />
          <Circle cx="40" cy="33" r="5" />
          <Path d="M31 33h4" />
        </G>
      ) : null}
    </Svg>
  );
}

/** Рамка 33:44 с силуэтом и значком «верно / неверно» в углу. Бумага белая в обеих темах (как у веба). */
function Frame({ variant, width }: { variant: Variant; width: number }) {
  const { tokens } = useTheme();
  const ok = variant === "ok";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height: Math.round((width * 44) / 33), borderRadius: tokens.radiusItem, backgroundColor: tokens.photoPaper, borderWidth: 1, borderColor: tokens.photoLine, overflow: "hidden" }}
    >
      <View style={{ position: "absolute", left: "6%", top: "8%", width: "88%", height: "92%" }}>
        <Silhouette variant={variant} />
      </View>
      <View style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: ok ? tokens.ok : tokens.error, alignItems: "center", justifyContent: "center" }}>
        {ok ? <Check size={12} strokeWidth={3} color={tokens.photoPaper} /> : <X size={12} strokeWidth={3.2} color={tokens.photoPaper} />}
      </View>
    </View>
  );
}

const GAP = 8;

export function GuidePhotoRules({ country, width, id }: { country: GuideCountry | null; width: number; id: string }) {
  const { t } = useLang();
  const { fontScale } = useWindowDimensions();
  const strings = t("admission");
  const spec = country === "CN" ? strings.guidePhotoSpecCN : country === "MY" ? strings.guidePhotoSpecMY : strings.guidePhotoSpecAny;
  const cases: readonly { variant: Variant; title: string; hint: string }[] = [
    { variant: "ok", title: strings.guidePhotoOk, hint: strings.guidePhotoOkHint },
    { variant: "glasses", title: strings.guidePhotoGlasses, hint: strings.guidePhotoGlassesHint },
    { variant: "ears", title: strings.guidePhotoEars, hint: strings.guidePhotoEarsHint },
    { variant: "clothes", title: strings.guidePhotoClothes, hint: strings.guidePhotoClothesHint },
  ];
  // Четыре в ряд, как на вебе; на узком экране или при крупном шрифте системы - два: подписи читаются.
  const columns = width < 340 || fontScale > 1.3 ? 2 : 4;
  const cell = Math.floor((width - GAP * (columns - 1)) / columns);
  const frame = Math.min(cell, 112);
  return (
    <View style={{ gap: 10 }} testID={`${id}-photo-rules`}>
      <Text variant="caption" tone="text2" bold accessibilityRole="header">
        {strings.guidePhotoRulesTitle}
      </Text>
      <Text variant="caption" bold testID={`${id}-photo-spec`}>
        {spec}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP, rowGap: 14 }}>
        {cases.map((item) => (
          <View
            key={item.variant}
            accessible
            accessibilityLabel={`${item.variant === "ok" ? "" : `${strings.guidePhotoWrong}: `}${item.title}. ${item.hint}`}
            testID={`${id}-photo-${item.variant}`}
            style={{ width: cell, gap: 3 }}
          >
            <Frame variant={item.variant} width={frame} />
            <Text variant="caption" bold style={{ marginTop: 3 }}>
              {item.title}
            </Text>
            <Text variant="caption" tone="text2">
              {item.hint}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" tone="text2">
        {strings.guidePhotoNever}
        {country === "MY" ? ` ${strings.guidePhotoNoScan}` : ""}
      </Text>
    </View>
  );
}
