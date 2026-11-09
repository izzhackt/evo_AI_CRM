// Карточка задания CSCA: условие (английский, формулы), рисунок, четыре варианта, вердикт и
// разбор каждого варианта, решение по шагам, термины, «Сообщить об ошибке». Ключ ответа до
// ответа клиенту не приходит никогда (контракт §5): верный вариант виден только из `explain`.
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import type { CscaExplain, CscaFigure, CscaItem, CscaOptionId } from "@web/lib/portal/csca";

import { FigureView } from "@/features/learning/figure/FigureView";
import { MathText } from "@/features/learning/math/MathText";
import { Chip } from "@/features/learning/ui";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type ItemState =
  | { kind: "open"; selected: CscaOptionId | null; busy?: boolean }
  | { kind: "answered"; selected: CscaOptionId | null; correct: boolean; explain: CscaExplain }
  /** Тест на время: выбор без вердикта. */
  | { kind: "test"; selected: CscaOptionId | null };

const LETTER: Readonly<Record<CscaOptionId, string>> = { a: "A", b: "B", c: "C", d: "D" };

export function OptionRow({ id, label, selected, mark, onPress, disabled, children, testID }: { id: CscaOptionId; label: string; selected: boolean; mark: "none" | "correct" | "wrong"; onPress?: () => void; disabled?: boolean; children?: ReactNode; testID?: string }) {
  const { tokens } = useTheme();
  const { t } = useLang();
  const c = t("csca");
  const border = mark === "correct" ? tokens.ok : mark === "wrong" ? tokens.error : selected ? tokens.accent : tokens.line;
  return (
    <View style={{ borderWidth: mark === "none" && !selected ? 1 : 2, borderColor: border, borderRadius: tokens.radiusItem, backgroundColor: tokens.surface, overflow: "hidden" }}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, disabled: disabled ?? false }}
        accessibilityLabel={`${LETTER[id]}. ${label.replaceAll("$", "")}${mark === "correct" ? `. ${c.correctChoice}` : mark === "wrong" ? `. ${c.yourChoice}, ${c.verdictWrong}` : ""}`}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        style={{ minHeight: MIN_TARGET + 8, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: border, alignItems: "center", justifyContent: "center", backgroundColor: selected || mark !== "none" ? border : "transparent" }}>
          <Text variant="caption" bold tone={selected || mark !== "none" ? "onAccent" : "text2"}>
            {LETTER[id]}
          </Text>
        </View>
        <View style={{ flex: 1 }} importantForAccessibility="no-hide-descendants">
          <MathText source={label} variant="body" />
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** Решение по шагам: «Следующий шаг» открывает следующую строку, «Показать решение» всё сразу. */
export function Steps({ steps, testID }: { steps: readonly string[]; testID?: string }) {
  const { t, format } = useLang();
  const c = t("csca");
  const [shown, setShown] = useState(1);
  return (
    <View style={{ gap: 8 }} testID={testID}>
      {steps.slice(0, shown).map((step, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Text variant="caption" tone="text2" bold>
            {format(c.exampleStep, { n: String(i + 1) })}
          </Text>
          <MathText source={step} variant="secondary" />
        </View>
      ))}
      {shown < steps.length ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" label={c.nextSolutionStep} onPress={() => setShown((n) => n + 1)} testID={testID ? `${testID}-next` : undefined} />
          <Button variant="ghost" label={c.showSolution} onPress={() => setShown(steps.length)} testID={testID ? `${testID}-all` : undefined} />
        </View>
      ) : null}
    </View>
  );
}

export function TermsList({ terms }: { terms: readonly { en: string; ru: string; ky: string }[] }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  if (terms.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text variant="caption" tone="text2" bold>
        {c.itemTerms}
      </Text>
      {terms.map((term, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 2, borderBottomWidth: i < terms.length - 1 ? 1 : 0, borderBottomColor: tokens.line }}>
          <Text variant="secondary" bold style={{ flex: 1 }} accessibilityLanguage="en">
            {term.en}
          </Text>
          <Text variant="secondary" tone="text2" style={{ flex: 1 }}>
            {lang === "ky" ? term.ky : term.ru}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ItemCard({
  item,
  figure,
  state,
  counter,
  onSelect,
  footer,
  onReport,
  testID,
}: {
  item: CscaItem;
  figure: CscaFigure | null;
  state: ItemState;
  counter?: string;
  onSelect?: (id: CscaOptionId) => void;
  footer?: ReactNode;
  onReport?: () => void;
  testID?: string;
}) {
  const { lang, t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const answered = state.kind === "answered" ? state : null;
  const explainById = answered ? Object.fromEntries(answered.explain.options.map((o) => [o.id, lang === "ky" ? o.explainKy : o.explainRu])) : {};
  const solution = answered ? (lang === "ky" ? answered.explain.solutionKy : answered.explain.solutionRu) : [];
  return (
    <View style={{ gap: 12 }} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {counter ? (
          <Text variant="caption" tone="text2" bold accessibilityRole="header">
            {counter}
          </Text>
        ) : null}
        <Text variant="caption" tone="text2">
          {format(c.difficulty, { n: String(item.difficulty) })} · {format(c.estSeconds, { n: String(item.estSeconds) })}
        </Text>
      </View>
      <View accessible accessibilityLanguage="en">
        <MathText source={item.stemEn} variant="body" testID="item-stem" />
      </View>
      {figure ? <FigureView figure={figure} /> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={c.optionsLabel} style={{ gap: 8 }}>
        {item.options.map((option) => {
          const isSelected = state.selected === option.id;
          const isCorrect = answered?.explain.correctOptionId === option.id;
          const mark = answered ? (isCorrect ? "correct" : isSelected ? "wrong" : "none") : "none";
          const text = explainById[option.id];
          return (
            <OptionRow
              key={option.id}
              id={option.id}
              label={option.label}
              selected={isSelected}
              mark={mark}
              disabled={answered !== null || (state.kind === "open" && state.busy === true)}
              onPress={() => onSelect?.(option.id)}
              testID={`option-${option.id}`}
            >
              {answered && text ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 10, paddingLeft: 52 }}>
                  <MathText source={text} variant="secondary" tone="text2" />
                </View>
              ) : null}
            </OptionRow>
          );
        })}
      </View>
      {answered ? (
        <View style={{ gap: 10 }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Chip tone={answered.correct ? "ok" : "bad"} label={answered.correct ? c.verdictCorrect : c.verdictWrong} testID="verdict" />
            <Text variant="secondary" tone="text2">
              {format(c.verdictCorrectIs, { option: LETTER[answered.explain.correctOptionId] })}
            </Text>
          </View>
          {solution.length > 0 ? (
            <View style={{ gap: 6, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.accentSoft }}>
              <Text variant="secondary" bold>
                {c.solutionHeading}
              </Text>
              <Steps steps={solution} testID="solution" />
            </View>
          ) : null}
          <TermsList terms={answered.explain.terms} />
        </View>
      ) : null}
      {footer}
      {onReport ? (
        <Pressable accessibilityRole="button" onPress={onReport} hitSlop={6} testID="report-open" style={{ minHeight: MIN_TARGET, justifyContent: "center", alignSelf: "flex-start" }}>
          <Text variant="caption" tone="text2" style={{ textDecorationLine: "underline" }}>
            {c.reportOpen}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

