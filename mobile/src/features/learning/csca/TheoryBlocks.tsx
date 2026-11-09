// Блоки теории урока (контракт §13): идея, формулы, рисунок, таблица, разбор по шагам,
// типичные ошибки, плашка «без калькулятора», термины, интерактивный блок (рисуется его
// рисунком: виджетов нет ни на вебе, ни на iPhone). Неизвестный `kind` парсер уже отбросил.
import { View } from "react-native";

import type { CscaCell, CscaFigure, CscaTheoryBlock } from "@web/lib/portal/csca";

import { Steps, TermsList } from "@/features/learning/csca/ItemCard";
import { FigureView } from "@/features/learning/figure/FigureView";
import { DisplayFormula, MathText } from "@/features/learning/math/MathText";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

function cellText(cell: CscaCell, lang: "ru" | "ky"): string {
  return "tex" in cell ? `$${cell.tex}$` : cell[lang];
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
        <View style={{ gap: 6 }} testID={testID}>
          {block.tex.map((tex, i) => (
            <DisplayFormula key={i} tex={tex} />
          ))}
          {pick(block.note_ru, block.note_ky) ? <MathText source={pick(block.note_ru, block.note_ky)} variant="secondary" tone="text2" /> : null}
        </View>
      );
    case "figure":
      return (
        <View style={{ gap: 6 }} testID={testID}>
          {figures[block.figure_key] ? <FigureView figure={figures[block.figure_key]} /> : null}
          <MathText source={pick(block.caption_ru, block.caption_ky)} variant="caption" tone="text2" />
        </View>
      );
    case "interactive":
      return (
        <View style={{ gap: 6 }} testID={testID}>
          {block.figure_key && figures[block.figure_key] ? <FigureView figure={figures[block.figure_key]} /> : null}
          <MathText source={pick(block.caption_ru, block.caption_ky)} variant="caption" tone="text2" />
        </View>
      );
    case "table":
      return (
        <View style={{ gap: 6 }} testID={testID}>
          <MathText source={pick(block.caption_ru, block.caption_ky)} variant="caption" tone="text2" bold />
          <View style={{ borderWidth: 1, borderColor: tokens.line, borderRadius: tokens.radiusItem, overflow: "hidden", backgroundColor: tokens.surface }}>
            {[block.header, ...block.rows].map((row, r) => (
              <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 1, borderTopColor: tokens.line, backgroundColor: r === 0 ? tokens.skeleton : "transparent" }}>
                {row.map((cell, k) => (
                  <View key={k} style={{ flex: 1, padding: 8 }}>
                    <MathText source={cellText(cell, lang)} variant="secondary" bold={r === 0} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      );
    case "example":
      return (
        <View style={{ gap: 8, padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }} testID={testID}>
          <Text variant="secondary" bold>
            {pick(block.title_ru, block.title_ky)}
          </Text>
          <MathText source={block.stem_en} />
          <Steps steps={block.steps.map((s) => pick(s.ru, s.ky))} />
          <MathText source={`${c.answerLabel}: ${pick(block.answer_ru, block.answer_ky)}`} bold />
        </View>
      );
    case "pitfalls":
      return (
        <View style={{ gap: 6 }} testID={testID}>
          <Text variant="secondary" bold>
            {c["block.pitfalls"]}
          </Text>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <Text variant="secondary">•</Text>
              <View style={{ flex: 1 }}>
                <MathText source={pick(item.ru, item.ky)} variant="secondary" />
              </View>
            </View>
          ))}
        </View>
      );
    case "tip":
      return (
        <View style={{ gap: 2, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.accentSoft }} testID={testID}>
          <Text variant="caption" tone="accent" bold>
            {c["block.tip"]}
          </Text>
          <MathText source={pick(block.ru, block.ky)} variant="secondary" />
        </View>
      );
    case "terms":
      return (
        <View testID={testID}>
          <TermsList terms={block.terms} />
        </View>
      );
  }
}

export function TheoryBlocks({ blocks, figures }: { blocks: readonly CscaTheoryBlock[]; figures: Readonly<Record<string, CscaFigure>> }) {
  return (
    <View style={{ gap: 14 }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} figures={figures} index={i} />
      ))}
    </View>
  );
}
