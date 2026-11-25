// Полоса шагов «Учёба»: вид по умолчанию не изменился (его держат тесты «как раньше», они же прошли на коде до правки),
// а новые возможности включаются только явными свойствами: слова состояний, зона 44 pt, цельная полоса для длинных тестов.
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SegmentBar, answeredSegments, segmentA11yLabel, type SegmentState } from "@/features/learning/ui";
import { LangProvider } from "@/i18n/LangProvider";
import { lightTokens } from "@/theme/tokens.generated";
import { ThemeProvider } from "@/theme/ThemeProvider";

// `ui.tsx` берёт из expo-router только `useRouter` для «назад»; сам роутер в Jest не загружается.
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial="light">
        <LangProvider initial="ru">{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;
/** Первый вложенный элемент (сама цветная полоска сегмента или заливка цельной полосы). */
const firstChildStyle = (element: { children: unknown[] }) => flat((element.children[0] as { props: { style: unknown } }).props.style);

const FIVE: SegmentState[] = ["done", "ok", "bad", "current", "todo"];
const labels = FIVE.map((_, i) => `Задание ${i + 1} из 5`);

describe("SegmentBar по умолчанию: как раньше", () => {
  it("по сегменту на шаг, цвета по состояниям, высота 6, нажатие отдаёт номер шага", async () => {
    const onPress = jest.fn();
    await render(wrap(<SegmentBar testID="bar" states={FIVE} labels={labels} onPress={onPress} />));
    const segments = screen.getAllByRole("button");
    expect(segments).toHaveLength(5);
    const colors = segments.map((segment) => firstChildStyle(segment).backgroundColor);
    expect(colors).toEqual([lightTokens.ok, lightTokens.ok, lightTokens.error, lightTokens.accent, lightTokens.line]);
    for (const segment of segments) expect(firstChildStyle(segment)).toMatchObject({ height: 6, borderRadius: 3 });
    fireEvent.press(segments[2]);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(2);
  });

  it("подпись сегмента - ровно переданная, без слов состояний; у текущего нет состояния selected", async () => {
    await render(wrap(<SegmentBar states={FIVE} labels={labels} onPress={jest.fn()} />));
    const segments = screen.getAllByRole("button");
    segments.forEach((segment, i) => expect(segment).toHaveAccessibleName(labels[i]));
    expect(segments[3]).not.toBeSelected();
    expect(segments[3].props.accessibilityState?.selected).toBeUndefined();
  });

  it("строка: ряд с зазором 3 и без полей; сегменты делят ширину, зона нажатия растёт на 12 pt вверх и вниз", async () => {
    await render(wrap(<SegmentBar testID="bar" states={FIVE} onPress={jest.fn()} />));
    expect(flat(screen.getByTestId("bar").props.style)).toEqual({ flexDirection: "row", gap: 3 });
    for (const segment of screen.getAllByRole("button")) {
      expect(flat(segment.props.style)).toEqual({ flex: 1 });
      expect(segment.props.hitSlop).toEqual({ top: 12, bottom: 12 });
    }
  });

  it("без onPress полоса только показывает: «картинки» без перехода, нажатие ничего не вызывает", async () => {
    await render(wrap(<SegmentBar testID="bar" states={FIVE} labels={labels} />));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const images = screen.getAllByRole("image");
    expect(images).toHaveLength(5);
    expect(images[0]).toHaveAccessibleName(labels[0]);
    expect(images[0]).toBeDisabled();
  });

  it("без подписей читалка не получает названия (как раньше)", async () => {
    await render(wrap(<SegmentBar states={["todo", "todo"]} onPress={jest.fn()} />));
    for (const segment of screen.getAllByRole("button")) expect(segment.props.accessibilityLabel).toBeUndefined();
  });
});

describe("SegmentBar: слова состояний для читалки (G66)", () => {
  const words = { done: "отвечено", ok: "верно", bad: "неверно", current: "текущее", todo: "без ответа" };

  it("к подписи добавляется слово состояния через запятую, как в навигаторе веба", async () => {
    await render(wrap(<SegmentBar states={FIVE} labels={labels} stateWords={words} onPress={jest.fn()} />));
    const names = screen.getAllByRole("button").map((segment) => segment.props.accessibilityLabel);
    expect(names).toEqual([
      "Задание 1 из 5, отвечено",
      "Задание 2 из 5, верно",
      "Задание 3 из 5, неверно",
      "Задание 4 из 5, текущее",
      "Задание 5 из 5, без ответа",
    ]);
  });

  it("слово есть и у полосы без нажатий: «картинка» с вердиктом", async () => {
    await render(wrap(<SegmentBar states={["ok", "bad"]} labels={["Пример 1", "Пример 2"]} stateWords={words} />));
    expect(screen.getAllByRole("image").map((s) => s.props.accessibilityLabel)).toEqual(["Пример 1, верно", "Пример 2, неверно"]);
  });

  it("текущий шаг помечен как выбранный; остальные нет", async () => {
    await render(wrap(<SegmentBar states={FIVE} labels={labels} stateWords={words} onPress={jest.fn()} />));
    const segments = screen.getAllByRole("button");
    expect(segments[3]).toBeSelected();
    for (const i of [0, 1, 2, 4]) expect(segments[i]).not.toBeSelected();
  });

  it("слова без названий: читается одно слово; названия без слова для состояния: одно название", async () => {
    await render(wrap(<SegmentBar states={["ok", "todo"]} stateWords={{ ok: "верно" }} labels={undefined} onPress={jest.fn()} />));
    const [ok, todo] = screen.getAllByRole("button");
    expect(ok.props.accessibilityLabel).toBe("верно");
    expect(todo.props.accessibilityLabel).toBeUndefined();
  });

  it("segmentA11yLabel: без слов - название как есть, пустое слово не даёт висящей запятой", () => {
    expect(segmentA11yLabel("Задание 1", "ok")).toBe("Задание 1");
    expect(segmentA11yLabel(undefined, "ok")).toBeUndefined();
    expect(segmentA11yLabel("Задание 1", "ok", {})).toBe("Задание 1");
    expect(segmentA11yLabel("Задание 1", "ok", { ok: "  " })).toBe("Задание 1");
    expect(segmentA11yLabel("  Задание 1 ", "ok", { ok: " верно " })).toBe("Задание 1, верно");
    expect(segmentA11yLabel(undefined, "bad", { bad: "неверно" })).toBe("неверно");
    expect(segmentA11yLabel("", "bad", { bad: "неверно" })).toBe("неверно");
  });
});

describe("SegmentBar: зона нажатия 44 pt (G66)", () => {
  it("каждый сегмент высотой не меньше 44, полоса по центру; hitSlop не нужен", async () => {
    await render(wrap(<SegmentBar states={FIVE} labels={labels} onPress={jest.fn()} largeTarget />));
    for (const segment of screen.getAllByRole("button")) {
      expect(flat(segment.props.style)).toMatchObject({ flex: 1, minHeight: 44, justifyContent: "center" });
      expect(segment.props.hitSlop).toBeUndefined();
      expect(firstChildStyle(segment)).toMatchObject({ height: 6 });
    }
  });

  it("место на экране прежнее: строка в раскладке занимает те же 6 pt (44 минус поля)", async () => {
    await render(wrap(<SegmentBar testID="bar" states={FIVE} onPress={jest.fn()} largeTarget />));
    const row = flat(screen.getByTestId("bar").props.style);
    expect(row).toMatchObject({ flexDirection: "row", gap: 3 });
    expect(44 + 2 * (row.marginVertical as number)).toBe(6);
  });

  it("нажатие отдаёт номер шага и с большой зоной", async () => {
    const onPress = jest.fn();
    await render(wrap(<SegmentBar states={FIVE} onPress={onPress} largeTarget />));
    fireEvent.press(screen.getAllByRole("button")[4]);
    expect(onPress).toHaveBeenCalledWith(4);
  });

  it("слова и большая зона работают вместе", async () => {
    await render(wrap(<SegmentBar states={["ok", "current"]} labels={["Шаг 1", "Шаг 2"]} stateWords={{ ok: "верно", current: "текущее" }} onPress={jest.fn()} largeTarget />));
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveAccessibleName("Шаг 1, верно");
    expect(second).toHaveAccessibleName("Шаг 2, текущее");
    expect(second).toBeSelected();
    expect(flat(second.props.style).minHeight).toBe(44);
  });
});

describe("SegmentBar: цельная полоса для длинных тестов (G57)", () => {
  /** 92 утверждения, из них 23 отвечено: четверть. */
  const long: SegmentState[] = Array.from({ length: 92 }, (_, i) => (i < 23 ? "done" : i === 23 ? "current" : "todo"));

  it("один элемент для читалки вместо 92: полоса прогресса с названием и долей", async () => {
    await render(wrap(<SegmentBar testID="bar" variant="continuous" states={long} summaryLabel="Ответили на 23 из 92" />));
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAccessibleName("Ответили на 23 из 92");
    expect(bars[0]).toHaveAccessibilityValue({ min: 0, max: 92, now: 23 });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("image")).toHaveLength(0);
  });

  it("заливка - доля отвеченных, вид как `.pt-progress` веба: 8 pt, дорожка line, заливка accent", async () => {
    await render(wrap(<SegmentBar testID="bar" variant="continuous" states={long} summaryLabel="x" />));
    const track = flat(screen.getByTestId("bar").props.style);
    expect(track).toMatchObject({ height: 8, backgroundColor: lightTokens.line, overflow: "hidden" });
    expect(track.borderRadius).toBe(lightTokens.radiusChip);
    expect(firstChildStyle(screen.getByTestId("bar"))).toMatchObject({ width: "25%", height: 8, backgroundColor: lightTokens.accent });
  });

  it("в счёт идут верно, неверно и готово; текущий и ещё не начатый нет", async () => {
    const states: SegmentState[] = ["ok", "bad", "done", "current", "todo"];
    expect(answeredSegments(states)).toBe(3);
    expect(answeredSegments([])).toBe(0);
    await render(wrap(<SegmentBar testID="bar" variant="continuous" states={states} />));
    expect(screen.getByTestId("bar")).toHaveAccessibilityValue({ min: 0, max: 5, now: 3 });
    expect(firstChildStyle(screen.getByTestId("bar")).width).toBe("60%");
  });

  it("нажатия и подписи сегментов игнорируются: перехода по шагам у цельной полосы нет", async () => {
    const onPress = jest.fn();
    await render(wrap(<SegmentBar testID="bar" variant="continuous" states={long} labels={long.map((_, i) => `№${i}`)} stateWords={{ done: "отвечено" }} onPress={onPress} summaryLabel="Ответили" largeTarget />));
    const bar = screen.getByTestId("bar");
    // Не нажимаемый элемент: ни кнопок-сегментов, ни обработчиков касания у самой полосы. Настоящее касание доходит
    // только до такого обработчика (`fireEvent.press` поднялся бы до свойства `onPress` самого SegmentBar, это не касание).
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(bar.props.onStartShouldSetResponder).toBeUndefined();
    expect(bar.props.onResponderRelease).toBeUndefined();
    await userEvent.press(bar);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("№0, отвечено")).toBeNull();
    expect(bar).toHaveAccessibleName("Ответили");
  });

  it("всё отвечено - заливка на всю ширину; пустой список не ломает полосу", async () => {
    await render(
      wrap(
        <>
          <SegmentBar testID="full" variant="continuous" states={["done", "done"]} />
          <SegmentBar testID="none" variant="continuous" states={[]} />
        </>,
      ),
    );
    expect(firstChildStyle(screen.getByTestId("full")).width).toBe("100%");
    expect(screen.getByTestId("none")).toHaveAccessibilityValue({ min: 0, max: 1, now: 0 });
    expect(firstChildStyle(screen.getByTestId("none")).width).toBe("0%");
  });
});
