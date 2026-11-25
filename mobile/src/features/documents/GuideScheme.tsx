// Нарисованная схема документа с метками 1-3 и легендой - запасной вид справки «Пример»: у документа нет настоящих
// образцов (для страны дела или вообще), образец не загрузился или нет сети. Рисунки - вымышленные SVG веба
// (public/portal/document-samples), они зашиты в приложение через document-samples.generated.ts
// (npm run sync-document-samples): схема показывается и без сети, поэтому ей не нужен адрес.
import { SvgXml } from "react-native-svg";
import { View } from "react-native";
import type { DocumentGuideView } from "@web/lib/portal/document-guides";

import { DOCUMENT_SAMPLE_SVG } from "@/features/documents/document-samples.generated";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

const SCHEME_RATIO = 640 / 400;

/**
 * react-native-svg не раскодирует сущности в тексте (в образце паспорта строка MRZ с `&lt;` рисовалась буквально).
 * Раскодируем сами; «<» заменяем полноширинным «＜» (вид тот же, а разбор XML не ломается).
 */
export function decodeSvgText(xml: string): string {
  return xml.replace(/>([^<]+)</g, (_match, text: string) => `>${text.replaceAll("&lt;", "＜").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&")}<`);
}

function schemeXml(sampleSrc: string): string | null {
  const name = sampleSrc.split("/").pop() ?? "";
  return Object.hasOwn(DOCUMENT_SAMPLE_SVG, name) ? decodeSvgText(DOCUMENT_SAMPLE_SVG[name]) : null;
}

export function SchemeFigure({ guide, width }: { guide: DocumentGuideView; width: number }) {
  const { tokens } = useTheme();
  const xml = schemeXml(guide.sampleSrc);
  if (!xml) return null;
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height: width / SCHEME_RATIO, borderRadius: tokens.radiusCard, overflow: "hidden", borderWidth: 1, borderColor: tokens.line }} testID="guide-sample">
      <SvgXml xml={xml} width={width} height={width / SCHEME_RATIO} />
      {guide.pins.map((pin) => (
        <View key={pin.n} style={{ position: "absolute", left: `${pin.x}%`, top: `${pin.y}%`, width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: 11, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center", boxShadow: tokens.shadowCard }}>
          <Text variant="caption" bold tone="onAccent" style={{ fontSize: 12, lineHeight: 14 }}>
            {pin.n}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function SchemeLegend({ guide }: { guide: DocumentGuideView }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }} testID="guide-legend">
      {guide.pins.map((pin) => (
        <View key={pin.n} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: tokens.accent, alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" bold tone="onAccent" style={{ fontSize: 11, lineHeight: 13 }}>
              {pin.n}
            </Text>
          </View>
          <Text variant="caption" tone="text2">
            {pin.legend}
          </Text>
        </View>
      ))}
    </View>
  );
}
