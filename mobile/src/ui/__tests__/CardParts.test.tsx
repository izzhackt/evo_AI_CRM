// Скелетон (G6): всегда ровный блок цветом токена, без пульсации, как на вебе (`portal/loading.tsx`, правило владельца «без
// бесконечных анимаций»). Системная настройка «Уменьшить движение» ему не нужна: пульсировать нечему ни при какой. Кадры в
// Jest не идут, поэтому проверяются отсутствие цикла и вид блоков. Блоки берутся из `CardSkeleton`: у самого `Skeleton`
// нет testID.
import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Animated, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { lightTokens } from "@/theme/tokens.generated";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { CardSkeleton } from "@/ui/CardParts";
import { setReducedMotionForTests } from "@/ui/motion";

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

/** Цикл пульсации без кадров: считает созданные и запущенные циклы. Скелетон не должен создавать ни одного. */
function spyLoop() {
  const start = jest.fn();
  const loop = jest.spyOn(Animated, "loop").mockImplementation(() => ({ start, stop: jest.fn(), reset: jest.fn() }) as never);
  return { loop, start };
}

type Host = { props: Record<string, unknown> };
/** Три блока карточки: заголовок и две строки. */
const blocks = () => (screen.getByTestId("card").children as unknown as Host[]).map((block) => ({ props: block.props, style: StyleSheet.flatten(block.props.style as never) as Record<string, unknown> }));

const FLAT = [
  [22, "55%", lightTokens.skeleton, 6],
  [14, "100%", lightTokens.skeleton, 6],
  [14, "70%", lightTokens.skeleton, 6],
];
const look = () => blocks().map(({ style }) => [style.height, style.width, style.backgroundColor, style.borderRadius]);

afterEach(() => {
  jest.restoreAllMocks();
  setReducedMotionForTests(true); // как в jest.setup: по умолчанию движения в тестах нет
});

describe.each([
  ["включена", true],
  ["выключена", false],
])("Skeleton: настройка «Уменьшить движение» %s", (_name, reduced) => {
  it("цикл пульсации не создаётся и не запускается", async () => {
    setReducedMotionForTests(reduced);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(blocks()).toHaveLength(3);
    expect(spy.loop).not.toHaveBeenCalled();
    expect(spy.start).not.toHaveBeenCalled();
  });

  it("блоки стоят ровным цветом токена: размер, цвет и скругление прежние, прозрачность не анимируется", async () => {
    setReducedMotionForTests(reduced);
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(look()).toEqual(FLAT);
    for (const { style } of blocks()) expect(style.opacity).toBeUndefined();
  });
});

describe("Skeleton: доступность и настройка на лету", () => {
  it("читалке блоки не видны: «загрузка» читается один раз, у родителя", async () => {
    await render(wrap(<CardSkeleton testID="card" label="Загрузка карточки" />));
    for (const { props } of blocks()) {
      expect(props.importantForAccessibility).toBe("no");
      expect(props.accessibilityElementsHidden).toBe(true);
    }
    expect(screen.getByTestId("card")).toHaveAccessibleName("Загрузка карточки");
    expect(screen.getByTestId("card").props.accessibilityRole).toBe("progressbar");
    expect(screen.getByTestId("card")).toBeBusy();
  });

  it("настройку меняют при открытом экране: блоки те же, циклов нет ни до, ни после", async () => {
    setReducedMotionForTests(false);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(look()).toEqual(FLAT);
    await act(async () => setReducedMotionForTests(true));
    expect(look()).toEqual(FLAT);
    await act(async () => setReducedMotionForTests(false));
    expect(look()).toEqual(FLAT);
    expect(spy.loop).not.toHaveBeenCalled();
  });

  it("число строк карточки: заголовок и заданное число строк", async () => {
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" lines={4} />));
    expect(blocks()).toHaveLength(5);
  });
});
