// Карточка задания CSCA (контракт §5..§7; веб: components/portal/csca/ItemCard.tsx): условие (английский, формулы), рисунок,
// четыре варианта, вердикт и разбор каждого варианта, решение по шагам, термины, «Сообщить об ошибке». Ключ ответа до ответа
// клиенту не приходит никогда (контракт §5): верный вариант виден только из `explain`.
// После ответа варианты становятся разбором: у верного и выбранного неверного значок и слова «Ваш ответ» и «Верный ответ»
// (состояние не одним цветом), вердикт стоит сразу под условием, «Верный ответ: X» только при неверном ответе, а ответ без
// выбора называется «Без ответа». Читалка получает варианты и формулы словами (`speakMathText`), а не сырым TeX.
import { type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import type { CscaExplain, CscaFigure, CscaItem, CscaOptionId } from "@web/lib/portal/csca";

import { StepReveal } from "@/features/learning/csca/StepReveal";
import { tint } from "@/features/learning/csca/tint";
import { FigureView } from "@/features/learning/figure/FigureView";
import { MathText } from "@/features/learning/math/MathText";
import { speakMathText } from "@/features/learning/math/speak";
import { useLang } from "@/i18n/LangProvider";
import { monoFont, sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type ItemState =
  | { kind: "open"; selected: CscaOptionId | null; busy?: boolean }
  | { kind: "answered"; selected: CscaOptionId | null; correct: boolean; explain: CscaExplain }
  /** Тест на время: выбор без вердикта. */
  | { kind: "test"; selected: CscaOptionId | null };

const LETTER: Readonly<Record<CscaOptionId, string>> = { a: "A", b: "B", c: "C", d: "D" };

type MarkKind = "ok" | "bad" | "skipped";

/** Значок результата (веб: `Mark` и `SkipMark`): круг с галочкой, крестом или чертой. Слово рядом, значок подкрепляет. */
function Mark({ kind, size = 20 }: { kind: MarkKind; size?: number }) {
  const { tokens } = useTheme();
  const color = kind === "ok" ? tokens.ok : kind === "bad" ? tokens.error : tokens.text2;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
        {kind === "skipped" ? (
          <>
            <Circle cx={10} cy={10} r={8.25} stroke={color} strokeWidth={1.5} />
            <Path d="M6.5 10h7" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          </>
        ) : (
          <>
            <Circle cx={10} cy={10} r={9} fill={color} />
            {kind === "ok" ? (
              <Path d="m6 10.2 2.6 2.6L14 7.4" stroke={tokens.surface} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <Path d="m7 7 6 6M13 7l-6 6" stroke={tokens.surface} strokeWidth={2} strokeLinecap="round" />
            )}
          </>
        )}
      </Svg>
    </View>
  );
}

/** Сложность тремя полосками (веб `.cs-difficulty`); читалка слышит «Сложность N из 3». */
function Difficulty({ level }: { level: number }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={format(t("csca").difficulty, { n: String(level) })} style={{ flexDirection: "row", gap: 3 }} testID="item-difficulty">
      {[1, 2, 3].map((dot) => (
        <View key={dot} style={{ width: 6, height: 14, borderRadius: 2, backgroundColor: dot <= level ? tokens.text2 : tokens.line }} />
      ))}
    </View>
  );
}

/** Буква варианта в круге: выбранный закрашен цветом действия, разобранный верный и неверный своим цветом. */
function Letter({ id, tone }: { id: CscaOptionId; tone: "plain" | "selected" | "ok" | "bad" }) {
  const { tokens } = useTheme();
  const fill = tone === "selected" ? tokens.accent : tone === "ok" ? tokens.ok : tone === "bad" ? tokens.error : "transparent";
  const edge = tone === "plain" ? tokens.controlEdge : fill;
  return (
    <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: edge, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
      <Text variant="caption" bold style={{ fontFamily: monoFont("bold"), color: tone === "plain" ? tokens.text2 : tone === "selected" ? tokens.onAccent : tokens.surface }}>
        {LETTER[id]}
      </Text>
    </View>
  );
}

/** Вариант до ответа: выбор одним нажатием. Читалка слышит «A. текст словами», выбранный отмечен. */
function OptionOpen({ id, label, selected, disabled, onPress, testID }: { id: CscaOptionId; label: string; selected: boolean; disabled: boolean; onPress?: () => void; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${LETTER[id]}. ${speakMathText(label)}`}
      accessibilityLanguage="en"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        // Рамка выбранного толще на пиксель, поля меньше на пиксель: строка не прыгает при нажатии.
        paddingHorizontal: selected ? 15 : 16,
        paddingVertical: selected ? 10 : 11,
        borderRadius: tokens.radiusItem,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tokens.accent : tokens.line,
        backgroundColor: selected ? tint(tokens.accent, 7) : tokens.surface,
      }}
    >
      <Letter id={id} tone={selected ? "selected" : "plain"} />
      <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MathText source={label} variant="body" lang="en" />
      </View>
    </Pressable>
  );
}

/**
 * Вариант после ответа: верный и выбранный неверный с рамкой, значком и словами «Верный ответ» и «Ваш ответ», у каждого
 * разбор. Строка не нажимается; для читалки это три отдельных элемента (вариант на английском, слова, разбор на языке студента).
 */
function OptionAnswered({ id, label, chosen, correct, explain, testID }: { id: CscaOptionId; label: string; chosen: boolean; correct: boolean; explain: string | undefined; testID?: string }) {
  const { t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const mark: "ok" | "bad" | null = correct ? "ok" : chosen ? "bad" : null;
  const color = mark === "ok" ? tokens.ok : mark === "bad" ? tokens.error : tokens.line;
  const tags: string[] = [];
  if (chosen) tags.push(c.yourChoice);
  if (correct) tags.push(c.correctChoice);
  return (
    <View testID={testID} style={{ gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: color, backgroundColor: mark ? tint(color, 9) : tokens.surface }}>
      <View accessible accessibilityLabel={`${LETTER[id]}. ${speakMathText(label)}`} accessibilityLanguage="en" style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 34 }}>
        <Letter id={id} tone={mark ?? "plain"} />
        <View style={{ flex: 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MathText source={label} variant="body" lang="en" />
        </View>
        {mark ? <Mark kind={mark} /> : null}
      </View>
      {tags.length > 0 ? (
        <Text variant="caption" tone="text2" bold style={{ marginLeft: 48 }} testID={testID ? `${testID}-tags` : undefined}>
          {tags.join(" · ")}
        </Text>
      ) : null}
      {explain ? (
        <View style={{ marginLeft: 48 }}>
          <MathText source={explain} variant="secondary" tone={mark ? "text" : "text2"} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Вердикт сразу под условием, пока взгляд ещё там: «Верно», «Неверно · Верный ответ: B» или «Без ответа · Верный ответ: B».
 * Живой области у него нет: после ответа его читает `announce` самого экрана (урок, «Ошибки»), а живая область на Android
 * сказала бы то же ещё раз. Вердикт, который открыт заново (возврат к отвеченному заданию), читалке не объявляется.
 */
function Verdict({ selected, correct, correctOption }: { selected: CscaOptionId | null; correct: boolean; correctOption: CscaOptionId }) {
  const { t, format } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const kind: MarkKind = selected === null ? "skipped" : correct ? "ok" : "bad";
  const color = kind === "ok" ? tokens.ok : kind === "bad" ? tokens.error : tokens.text2;
  const word = kind === "skipped" ? c.notAnswered : correct ? c.verdictCorrect : c.verdictWrong;
  return (
    <View
      accessibilityLiveRegion="none"
      testID="verdict"
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: tokens.radiusItem, backgroundColor: kind === "ok" ? tint(tokens.ok, 9) : kind === "bad" ? tint(tokens.error, 8) : tokens.bg }}
    >
      <Mark kind={kind} />
      <Text variant="body" bold style={{ color, flex: 1 }}>
        {word}
        {!correct ? <Text variant="body" style={{ fontFamily: sansFont("medium"), color: tokens.text }}>{` · ${format(c.verdictCorrectIs, { option: LETTER[correctOption] })}`}</Text> : null}
      </Text>
    </View>
  );
}

/** Термины разбора пилюлями: английский жирно, перевод рядом (веб `.cs-item-terms`). */
function ItemTerms({ terms }: { terms: readonly { en: string; ru: string; ky: string }[] }) {
  const { lang, t } = useLang();
  const { tokens } = useTheme();
  if (terms.length === 0) return null;
  return (
    <View accessibilityRole="list" accessibilityLabel={t("csca").itemTerms} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} testID="item-terms">
      {terms.map((term) => (
        <View key={term.en} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: tokens.radiusChip, borderWidth: 1, borderColor: tokens.line }}>
          <Text variant="caption" bold accessibilityLanguage="en">
            {term.en}
          </Text>
          <Text variant="caption" tone="text2">
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
  const { tokens, scheme } = useTheme();
  const c = t("csca");
  const answered = state.kind === "answered" ? state : null;
  const explainById = answered ? Object.fromEntries(answered.explain.options.map((o) => [o.id, lang === "ky" ? o.explainKy : o.explainRu])) : {};
  const solution = answered ? (lang === "ky" ? answered.explain.solutionKy : answered.explain.solutionRu) : [];
  return (
    <View
      testID={testID}
      style={{ gap: 16, padding: 16, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface, boxShadow: scheme === "dark" ? undefined : tokens.shadowCard }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 16, rowGap: 6 }}>
        {counter ? (
          <Text variant="secondary" tone="text2" bold accessibilityRole="header">
            {counter}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Difficulty level={item.difficulty} />
          <Text variant="caption" tone="text2">
            {format(c.estSeconds, { n: String(item.estSeconds) })}
          </Text>
        </View>
      </View>
      <MathText source={item.stemEn} variant="body" lang="en" style={{ fontFamily: sansFont("medium") }} testID="item-stem" />
      {figure ? <FigureView figure={figure} /> : null}
      {answered ? <Verdict selected={answered.selected} correct={answered.correct} correctOption={answered.explain.correctOptionId} /> : null}
      {answered ? (
        <View accessibilityRole="list" accessibilityLabel={c.optionsLabel} style={{ gap: 10 }}>
          {item.options.map((option) => (
            <OptionAnswered
              key={option.id}
              id={option.id}
              label={option.label}
              chosen={answered.selected === option.id}
              correct={answered.explain.correctOptionId === option.id}
              explain={explainById[option.id]}
              testID={`option-${option.id}`}
            />
          ))}
        </View>
      ) : (
        <View accessibilityRole="radiogroup" accessibilityLabel={c.optionsLabel} style={{ gap: 10 }}>
          {item.options.map((option) => (
            <OptionOpen
              key={option.id}
              id={option.id}
              label={option.label}
              selected={state.selected === option.id}
              disabled={state.kind === "open" && state.busy === true}
              onPress={() => onSelect?.(option.id)}
              testID={`option-${option.id}`}
            />
          ))}
        </View>
      )}
      {answered && solution.length > 0 ? (
        <View style={{ gap: 12, padding: 16, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }} testID="solution-block">
          <Text variant="secondary" bold accessibilityRole="header">
            {c.solutionHeading}
          </Text>
          <StepReveal steps={solution} testID="solution" />
        </View>
      ) : null}
      {answered ? <ItemTerms terms={answered.explain.terms} /> : null}
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
