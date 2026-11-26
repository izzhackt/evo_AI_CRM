// Навигатор по заданиям теста на время (веб: `nav.cs-navigator` в TimedTestRunner.tsx): номера заданий всегда на виду над
// заданием, а не в окне по нажатию. Отвеченное закрашено, текущее в кольце цвета действия, отмеченное «Вернуться позже»
// с флажком на углу (раньше только рамка, хотя пояснение показывало флажок). Читалка слышит «Задание 5, отвечено, вернуться
// позже» и признак текущего; ячейка 44 pt, зона нажатия 48 pt.
//
// Сетка пробного теста на 48 заданий заняла бы на телефоне семь рядов (около 360 pt) над каждым заданием и сдвинула бы
// условие и «Назад»/«Далее» за край экрана. Поэтому сетка, которая не помещается в два ряда, заменяется лентой в один ряд:
// она сама встаёт на текущую ячейку, а кнопка «Все задания» раскрывает полную сетку. Выбор ячейки в сетке сворачивает её обратно.
// Короткие тесты (диагностика) остаются сеткой без кнопки. Часы идут и перерисовывают экран каждые полсекунды, а навигатор от
// них не меняется: он и его ячейки обёрнуты в `memo`, а вызывающий отдаёт ему устойчивые свойства.
import { ChevronDown, ChevronUp, Flag } from "lucide-react-native";
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";

import type { CscaTestAttempt } from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

import { useLang } from "@/i18n/LangProvider";
import { monoFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Ячейка на экране 44 pt; зона нажатия на 2 pt шире со всех сторон (48 pt, как советует Android), между зонами остаётся 4 pt. */
const CELL = MIN_TARGET;
const HIT_SLOP = 2;
const GAP = 8;
/** Сколько рядов сетки показываются сразу, дальше лента и кнопка «Все задания». */
export const GRID_ROWS_SHOWN = 2;
/** Поля вокруг ленты: кольцо текущей ячейки (4 pt) и значок флажка на углу (6 pt) не должны обрезаться краем прокрутки. */
const STRIP_PAD_X = 6;
const STRIP_PAD_Y = 8;
/** Поля экрана по бокам (`StackPage`): до первого замера ширину рамки оценивает окно за вычетом их. */
const SCREEN_PAD = 16;

/** Подпись ячейки для читалки: «Задание 5, отвечено, вернуться позже» (веб: `parts.join(", ")`). */
export function navCellLabel(index: number, answered: boolean, flagged: boolean, strings: PortalStrings<"csca">): string {
  return [formatPortalString(strings.navItem, { n: String(index + 1) }), answered ? strings.navAnswered : strings.navUnanswered, ...(flagged ? [strings.navFlagged] : [])].join(", ");
}

/** Сколько ячеек в ряду при такой ширине рамки. */
export function cellsPerRow(width: number): number {
  return Math.max(1, Math.floor((width + GAP) / (CELL + GAP)));
}

/** Не помещается ли сетка в два ряда: тогда вместо неё лента (пока ширина неизвестна, сетка). */
export function navigatorCompact(total: number, width: number): boolean {
  return width > 0 && total > cellsPerRow(width) * GRID_ROWS_SHOWN;
}

/** Куда прокрутить ленту, чтобы ячейка с этим номером встала по центру рамки (прокрутка за края ограничивается самой лентой). */
export function stripOffset(index: number, width: number): number {
  return Math.max(0, STRIP_PAD_X + index * (CELL + GAP) - (width - CELL) / 2);
}

type StripTarget = { scrollTo: (options: { x: number; animated?: boolean }) => void };

const NavCell = memo(function NavCell({ n, label, answered, flagged, current, disabled, onPick }: { n: number; label: string; answered: boolean; flagged: boolean; current: boolean; disabled: boolean; onPick: (index: number) => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current, disabled }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      onPress={() => onPick(n - 1)}
      testID={`nav-${n}`}
      style={{
        width: CELL,
        height: CELL,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: tokens.radiusControl,
        borderWidth: 1,
        borderColor: answered ? tokens.text : tokens.controlEdge,
        backgroundColor: answered ? tokens.text : tokens.surface,
        // Текущее в кольце цвета действия на подложке страницы, как `box-shadow` веба.
        boxShadow: current ? `0 0 0 2px ${tokens.bg}, 0 0 0 4px ${tokens.accent}` : undefined,
      }}
    >
      <Text variant="secondary" bold importantForAccessibility="no" style={{ fontFamily: monoFont("bold"), color: answered ? tokens.surface : tokens.text }}>
        {n}
      </Text>
      {flagged ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`nav-flag-${n}`}
          style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: tokens.warn, alignItems: "center", justifyContent: "center" }}
        >
          <Flag size={11} strokeWidth={2} color={tokens.surface} />
        </View>
      ) : null}
    </Pressable>
  );
});

function Legend() {
  const { t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 18, rowGap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: tokens.text }} />
        <Text variant="caption" tone="text2">
          {c.legendAnswered}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Flag size={14} strokeWidth={2} color={tokens.warn} />
        <Text variant="caption" tone="text2">
          {c.legendFlagged}
        </Text>
      </View>
    </View>
  );
}

export type TestNavigatorProps = {
  attempt: Pick<CscaTestAttempt, "items">;
  answers: Readonly<Record<string, string>>;
  flags: readonly string[];
  index: number;
  disabled: boolean;
  onPick: (index: number) => void;
};

export const TestNavigator = memo(function TestNavigator({ attempt, answers, flags, index, disabled, onPick }: TestNavigatorProps) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const c = t("csca");
  const windowWidth = useWindowDimensions().width;
  const [measured, setMeasured] = useState(0);
  const width = measured > 0 ? measured : Math.max(0, windowWidth - 2 * SCREEN_PAD);
  const [expanded, setExpanded] = useState(false);
  const total = attempt.items.length;
  const compact = navigatorCompact(total, width);
  const strip = compact && !expanded;

  // Лента встаёт на текущую ячейку: сразу при показе, плавно при переходе к соседнему заданию. Пока лента не измерена, прокрутка
  // упёрлась бы в нулевой размер содержимого, поэтому встаём и тогда, когда размер содержимого стал известен.
  const stripRef = useRef<StripTarget | null>(null);
  const placedFor = useRef<number | null>(null);
  const place = useCallback((animated: boolean) => stripRef.current?.scrollTo({ x: stripOffset(index, width), animated }), [index, width]);
  useEffect(() => {
    if (!strip) {
      placedFor.current = null;
      return;
    }
    if (width <= 0) return;
    place(placedFor.current !== null && placedFor.current !== index);
    placedFor.current = index;
  }, [strip, index, width, place]);

  const pick = useCallback(
    (next: number) => {
      setExpanded(false);
      onPick(next);
    },
    [onPick, setExpanded],
  );

  const cells = attempt.items.map((entry, i) => {
    const answered = entry.itemKey in answers;
    const flagged = flags.includes(entry.itemKey);
    return <NavCell key={entry.itemKey} n={i + 1} label={navCellLabel(i, answered, flagged, c)} answered={answered} flagged={flagged} current={i === index} disabled={disabled} onPick={pick} />;
  });

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={c.navigatorLabel}
      style={{ gap: strip ? 0 : 8 }}
      onLayout={(event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== measured) setMeasured(next);
      }}
      testID="test-navigator"
    >
      {strip ? (
        <ScrollView
          ref={stripRef as RefObject<never>}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => place(false)}
          contentContainerStyle={{ gap: GAP, paddingHorizontal: STRIP_PAD_X, paddingVertical: STRIP_PAD_Y }}
          testID="nav-strip"
        >
          {cells}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }} testID="nav-grid">
          {cells}
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: 18, minHeight: compact ? MIN_TARGET : undefined }}>
        <Legend />
        {compact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((open) => !open)}
            hitSlop={4}
            testID="nav-toggle"
            style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8 }}
          >
            <Text variant="secondary" tone="accent" bold>
              {expanded ? m("learn.navCollapse") : m("learn.navOpen")}
            </Text>
            {expanded ? <ChevronUp size={18} strokeWidth={2} color={tokens.accent} /> : <ChevronDown size={18} strokeWidth={2} color={tokens.accent} />}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});
