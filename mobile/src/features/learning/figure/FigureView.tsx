// Рисунок CSCA: только через строгий профиль (svg-profile.ts), векторно (react-native-svg),
// тёмная тема заменой шести цветов один к одному (контракт §15). Подписи не мельче 12 px
// (индексы 11): рисунок уже `figureMinWidth` не сжимается, а прокручивается в своей рамке.
// Касание открывает рисунок крупнее. Не разобранный рисунок: виден alt, не пустота.
import { memo, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText, TSpan } from "react-native-svg";

import { CSCA_FIGURE_DARK_PALETTE, figureMinWidth, type CscaFigure } from "@web/lib/portal/csca";

import { parseSvgProfile, type SvgNode } from "@/features/learning/figure/svg-profile";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

const CAMEL: Readonly<Record<string, string>> = {
  "stroke-width": "strokeWidth", "stroke-dasharray": "strokeDasharray", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin",
  "fill-opacity": "fillOpacity", "stroke-opacity": "strokeOpacity", "font-size": "fontSize", "font-style": "fontStyle", "font-weight": "fontWeight",
  "text-anchor": "textAnchor", "dominant-baseline": "alignmentBaseline",
};

function propsOf(node: SvgNode, dark: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === "xmlns" || name === "viewBox" || name === "font-family") continue;
    let next: unknown = value;
    if ((name === "fill" || name === "stroke") && dark) next = CSCA_FIGURE_DARK_PALETTE[value.toLowerCase()] ?? value;
    if (name === "points" || name === "d" || name === "stroke-dasharray") next = value.trim().replace(/\s+/gu, " ");
    if (name === "transform") continue; // обрабатывается ниже
    out[CAMEL[name] ?? name] = next;
  }
  if (node.attrs.transform) out.transform = node.attrs.transform;
  return out;
}

function render(node: SvgNode | string, dark: boolean, key: number): ReactNode {
  if (typeof node === "string") return node;
  const props = propsOf(node, dark);
  const children = node.children.map((child, i) => render(child, dark, i));
  switch (node.tag) {
    case "rect": return <Rect key={key} {...props} />;
    case "line": return <Line key={key} {...props} />;
    case "circle": return <Circle key={key} {...props} />;
    case "path": return <Path key={key} {...props} />;
    case "polygon": return <Polygon key={key} {...props} />;
    case "text": return <SvgText key={key} {...props}>{children as never}</SvgText>;
    case "tspan": return <TSpan key={key} {...props}>{children as never}</TSpan>;
    default: return null; // title и svg не рисуются элементами
  }
}

function Drawing({ root, width, height, pixelWidth, dark }: { root: SvgNode; width: number; height: number; pixelWidth: number; dark: boolean }) {
  return (
    <Svg width={pixelWidth} height={(pixelWidth * height) / width} viewBox={`0 0 ${width} ${height}`}>
      {root.children.map((child, i) => render(child, dark, i))}
    </Svg>
  );
}

function FigureViewBase({ figure, testID }: { figure: CscaFigure; testID?: string }) {
  const { lang, m } = useLang();
  const { tokens, scheme } = useTheme();
  const [available, setAvailable] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const parsed = useMemo(() => parseSvgProfile(figure.svg), [figure.svg]);
  const alt = lang === "ky" ? figure.altKy : figure.altRu;
  const dark = scheme === "dark";
  if (!parsed) {
    return (
      <View testID={testID} accessible accessibilityLabel={alt} style={{ padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line }}>
        <Text variant="secondary" tone="text2">
          {alt}
        </Text>
      </View>
    );
  }
  const minWidth = figureMinWidth(figure.svg, parsed.width);
  const pixelWidth = Math.max(available, minWidth);
  return (
    <View testID={testID} onLayout={(e) => setAvailable(Math.floor(e.nativeEvent.layout.width))}>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={alt} accessibilityHint={m("learn.figureOpen")} onPress={() => setZoomed(true)} style={{ minHeight: MIN_TARGET }}>
        <ScrollView horizontal scrollEnabled={available > 0 && minWidth > available} showsHorizontalScrollIndicator={false} style={{ borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, overflow: "hidden", backgroundColor: dark ? CSCA_FIGURE_DARK_PALETTE["#ffffff"] : "#ffffff" }}>
          {available > 0 ? <Drawing root={parsed.root} width={parsed.width} height={parsed.height} pixelWidth={pixelWidth} dark={dark} /> : null}
        </ScrollView>
      </Pressable>
      <Modal visible={zoomed} animationType="fade" onRequestClose={() => setZoomed(false)} transparent>
        <Pressable accessibilityRole="button" accessibilityLabel={m("learn.figureClose")} onPress={() => setZoomed(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", minHeight: MIN_TARGET }}>
          <ScrollView horizontal contentContainerStyle={{ alignItems: "center" }}>
            <View style={{ backgroundColor: dark ? CSCA_FIGURE_DARK_PALETTE["#ffffff"] : "#ffffff", marginHorizontal: 8 }}>
              <Drawing root={parsed.root} width={parsed.width} height={parsed.height} pixelWidth={Math.max(parsed.width * 1.8, minWidth)} dark={dark} />
            </View>
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

export const FigureView = memo(FigureViewBase);
