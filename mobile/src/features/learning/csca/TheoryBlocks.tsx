// Блоки теории урока (контракт §13; веб: components/portal/csca/TheoryBlocks.tsx): идея, формулы, рисунок, таблица, разбор
// по шагам, типичные ошибки, плашка «без калькулятора», термины, интерактивный блок (рисуется его рисунком: виджетов нет ни
// на вебе, ни на iPhone). Неизвестный `kind` парсер уже отбросил; блок рисунка без рисунка в выдаче пропускается.
// Разбор примера открывается по шагам, ответ появляется после последнего шага. Английское условие примера и термины читаются
// английским голосом, объяснения языком устройства. Таблица шире экрана прокручивается вбок, как на вебе.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { CscaCell, CscaFigure, CscaTheoryBlock } from "@web/lib/portal/csca";

import { StepReveal } from "@/features/learning/csca/StepReveal";
import { CELL_PADDING, tableLayout, type TableBlock } from "@/features/learning/csca/table-layout";
import { FigureView } from "@/features/learning/figure/FigureView";
import { DisplayFormula, MathText } from "@/features/learning/math/MathText";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

function cellText(cell: CscaCell, lang: "ru" | "ky"): string {
  return "tex" in cell ? `$${cell.tex}$` : cell[lang];
}

function PitfallIcon({ color }: { color: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ marginTop: 4 }}>
      <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
        <Circle cx={9} cy={9} r={7.25} stroke={color} strokeWidth={1.5} />
        <Path d="M9 5.2v4.6M9 12.6h.01" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

function NoCalculatorIcon({ color }: { color: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
        <Rect x={6.5} y={3.5} width={15} height={21} rx={3} stroke={color} strokeWidth={1.5} />
        <Rect x={9.5} y={6.5} width={9} height={4} rx={1} stroke={color} strokeWidth={1.5} />
        <Path d="M10 14.5h.01M14 14.5h.01M18 14.5h.01M10 18.5h.01M14 18.5h.01M18 18.5h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
        <Path d="M4 25 24 3" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Таблица: до трёх столбцов поровну на всю ширину, шире экрана прокручивается вбок (U13 аудита). */
function TableView({ block, testID }: { block: TableBlock; testID: string }) {
  const { lang } = useLang();
  const { tokens } = useTheme();
  const [available, setAvailable] = useState(0);
  const layout = tableLayout(block, lang, available);
  const caption = lang === "ky" ? block.caption_ky : block.caption_ru;
  const grid = (
    <View>
      {[block.header, ...block.rows].map((row, r) => (
        <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 1, borderTopColor: r === 1 ? tokens.controlEdge : tokens.line, backgroundColor: r === 0 ? tokens.bg : "transparent" }} testID={`${testID}-row-${r}`}>
          {row.map((cell, k) => (
            <View key={k} style={{ width: layout.widths ? layout.widths[k] : undefined, flex: layout.widths ? undefined : 1, paddingHorizontal: CELL_PADDING, paddingVertical: 10, justifyContent: "center" }}>
              <MathText source={cellText(cell, lang)} variant={r === 0 ? "caption" : "secondary"} tone={r === 0 ? "text2" : "text"} bold={r === 0} style={r > 0 && k === 0 ? { fontFamily: sansFont("medium") } : undefined} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <MathText source={caption} variant="caption" tone="text2" bold />
      <View
        testID={`${testID}-frame`}
        onLayout={(event) => setAvailable(Math.max(0, Math.floor(event.nativeEvent.layout.width) - 2))}
        style={{ borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusItem, overflow: "hidden", backgroundColor: tokens.surface }}
      >
        {layout.scroll ? (
          <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel={caption} testID={`${testID}-scroll`}>
            {grid}
          </ScrollView>
        ) : (
          grid
        )}
      </View>
    </View>
  );
}

function Block({ block, figures, index }: { block: CscaTheoryBlock; figures: Readonly<Record<string, CscaFigure>>; index: number }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const pick = (ru: string, ky: string) => (lang === "ky" ? ky : ru);
  const testID = `theory-${block.kind}-${index}`;
  switch (block.kind) {
    case "idea":
      return <MathText source={pick(block.ru, block.ky)} testID={testID} />;
    case "formula":
      return (
        <View style={{ gap: 10, padding: 16, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }} testID={testID}>
          {block.tex.map((tex, i) => (
            <DisplayFormula key={i} tex={tex} />
          ))}
          <MathText source={pick(block.note_ru, block.note_ky)} variant="secondary" tone="text2" />
        </View>
      );
    case "figure":
    case "interactive": {
      const figure = block.figure_key ? figures[block.figure_key] : undefined;
      // Рисунок, которого нет в выдаче (сбой контента), пропускается: пустая подпись без рисунка ничего не поясняет.
      if (!figure) return null;
      return (
        <View style={{ gap: 6 }} testID={testID}>
          <FigureView figure={figure} />
          <MathText source={pick(block.caption_ru, block.caption_ky)} variant="caption" tone="text2" />
        </View>
      );
    }
    case "table":
      return <TableView block={block} testID={testID} />;
    case "example":
      return (
        <View style={{ gap: 12, paddingTop: 20, borderTopWidth: 1, borderTopColor: tokens.line }} testID={testID}>
          <Text variant="heading" accessibilityRole="header">
            {pick(block.title_ru, block.title_ky)}
          </Text>
          <View style={{ padding: 14, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
            <MathText source={block.stem_en} lang="en" style={{ fontFamily: sansFont("medium") }} />
          </View>
          <StepReveal steps={block.steps.map((step) => pick(step.ru, step.ky))} answer={pick(block.answer_ru, block.answer_ky)} testID={`${testID}-steps`} />
        </View>
      );
    case "pitfalls":
      return (
        <View style={{ gap: 12 }} testID={testID}>
          <Text variant="body" bold accessibilityRole="header">
            {c["block.pitfalls"]}
          </Text>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12 }}>
              <PitfallIcon color={tokens.warn} />
              <View style={{ flex: 1 }}>
                <MathText source={pick(item.ru, item.ky)} variant="secondary" />
              </View>
            </View>
          ))}
        </View>
      );
    case "tip":
      return (
        <View style={{ flexDirection: "row", gap: 16, padding: 16, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }} testID={testID}>
          <NoCalculatorIcon color={tokens.text2} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="body" bold>
              {c["block.tip"]}
            </Text>
            <MathText source={pick(block.ru, block.ky)} variant="secondary" />
          </View>
        </View>
      );
    case "terms":
      return (
        <View style={{ gap: 8 }} testID={testID}>
          <Text variant="body" bold accessibilityRole="header">
            {c["block.terms"]}
          </Text>
          {block.terms.map((term, i) => (
            <View key={term.en} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, rowGap: 2, paddingVertical: 9, borderBottomWidth: i < block.terms.length - 1 ? 1 : 0, borderBottomColor: tokens.line }}>
              <Text variant="secondary" bold accessibilityLanguage="en">
                {term.en}
              </Text>
              <Text variant="secondary" tone="text2">
                {pick(term.ru, term.ky)}
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

export function TheoryBlocks({ blocks, figures }: { blocks: readonly CscaTheoryBlock[]; figures: Readonly<Record<string, CscaFigure>> }) {
  return (
    <View style={{ gap: 20 }} testID="theory-blocks">
      {blocks.map((block, i) => (
        <Block key={i} block={block} figures={figures} index={i} />
      ))}
    </View>
  );
}
