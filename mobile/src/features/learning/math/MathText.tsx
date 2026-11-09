// Текст с формулами `$…$` (контракт §14): куски текста обычным шрифтом приложения (кириллица и
// латиница), формулы это векторные SVG MathJax, вставленные в строку и переносимые вместе с
// текстом. Формула, которую MathJax не разобрал, показывается исходной строкой, как на iPhone.
import { useMemo } from "react";
import { PixelRatio, ScrollView, View, type StyleProp, type TextStyle } from "react-native";
import { SvgXml } from "react-native-svg";

import { splitMathText } from "@web/lib/portal/csca";

import { colorizeSvg, typesetTex } from "@/features/learning/math/mathjax-svg";
import { speakMathText, speakTex } from "@/features/learning/math/speak";
import { useTheme } from "@/theme/ThemeProvider";
import { Text, type TextVariant } from "@/ui/Text";

/** Размер шрифта варианта с учётом системного масштаба (не больше предела `Text`). */
function useFontSize(variant: TextVariant): number {
  const { tokens } = useTheme();
  const base = { display: tokens.sizeDisplay, title: tokens.sizeTitle, heading: tokens.sizeHeading, body: tokens.sizeBody, secondary: tokens.sizeSecondary, caption: tokens.sizeCaption, tab: tokens.sizeTab, data: tokens.sizeSecondary }[variant];
  const max = variant === "body" || variant === "secondary" || variant === "caption" || variant === "data" ? 2 : variant === "heading" ? 1.4 : 1.3;
  return base * Math.min(PixelRatio.getFontScale(), max);
}

/** Подгонка по симулятору iOS 26.5: низ встроенного вида стоит чуть ниже базовой линии текста. */
const BASELINE_NUDGE_EM = 0.12;

type FormulaProps = Readonly<{ tex: string; fontSize: number; color: string; display?: boolean }>;

/** Одна формула: SVG размером в em шрифта, базовая линия сдвинута на нижний вынос. */
function InlineFormula({ tex, fontSize, color }: FormulaProps) {
  const set = useMemo(() => typesetTex(tex, false), [tex]);
  if (!set) return <Text style={{ fontSize }}>{tex}</Text>;
  const width = set.widthEm * fontSize;
  const height = set.heightEm * fontSize;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width, height, transform: [{ translateY: (set.depthEm - BASELINE_NUDGE_EM) * fontSize }] }}>
      <SvgXml xml={colorizeSvg(set.svg, color)} width={width} height={height} />
    </View>
  );
}

export function MathText({
  source,
  variant = "body",
  tone = "text",
  bold,
  style,
  testID,
}: {
  source: string;
  variant?: TextVariant;
  tone?: "text" | "text2" | "accent" | "error" | "ok" | "onAccent";
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const fontSize = useFontSize(variant);
  const color = tone === "text" ? tokens.text : tone === "text2" ? tokens.text2 : tone === "accent" ? tokens.accent : tone === "error" ? tokens.error : tone === "ok" ? tokens.ok : tokens.onAccent;
  const segments = useMemo(() => splitMathText(source), [source]);
  const hasMath = segments.some((s) => s.math);
  // Нижние выносы формул (дроби, индексы) выступают за строку; рамка текста их обрезает, поэтому
  // снизу оставляется запас по самой глубокой формуле.
  const pad = hasMath ? Math.ceil(Math.max(0, ...segments.filter((s) => s.math).map((s) => (typesetTex(s.value, false)?.depthEm ?? 0) * fontSize))) : 0;
  // Одна формула без текста (ячейка таблицы, вариант «$6$»): обычный блок, без подгонки базовой
  // линии внутри текста, чтобы рисунок не обрезался рамкой абзаца.
  const only = segments.length === 1 && segments[0].math ? typesetTex(segments[0].value, false) : null;
  if (only) {
    const width = only.widthEm * fontSize;
    const height = only.heightEm * fontSize;
    return (
      <View testID={testID} accessible accessibilityLabel={speakMathText(source)} accessibilityLanguage="en" style={{ minHeight: fontSize * 1.45, justifyContent: "center", alignItems: "flex-start" }}>
        <SvgXml xml={colorizeSvg(only.svg, color)} width={width} height={height} />
      </View>
    );
  }
  if (!hasMath) {
    return (
      <Text variant={variant} tone={tone} bold={bold} style={style} testID={testID}>
        {source}
      </Text>
    );
  }
  return (
    <Text variant={variant} tone={tone} bold={bold} style={[style, { paddingBottom: pad }]} testID={testID} accessibilityLabel={speakMathText(source)} accessibilityLanguage="en">
      {segments.map((segment, index) =>
        segment.math ? <InlineFormula key={index} tex={segment.value} fontSize={fontSize} color={color} /> : segment.value,
      )}
    </Text>
  );
}

/** Формула отдельной строкой (блок `formula`, ячейки таблицы): по центру, широкая прокручивается. */
export function DisplayFormula({ tex, variant = "body", testID }: { tex: string; variant?: TextVariant; testID?: string }) {
  const { tokens } = useTheme();
  const fontSize = useFontSize(variant) * 1.15;
  const set = useMemo(() => typesetTex(tex, true), [tex]);
  if (!set) {
    return (
      <Text variant={variant} style={{ textAlign: "center" }} testID={testID}>
        {tex}
      </Text>
    );
  }
  const width = set.widthEm * fontSize;
  const height = set.heightEm * fontSize;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 4 }} testID={testID} accessible accessibilityLabel={speakTex(tex)} accessibilityLanguage="en">
      <SvgXml xml={colorizeSvg(set.svg, tokens.text)} width={width} height={height} />
    </ScrollView>
  );
}
