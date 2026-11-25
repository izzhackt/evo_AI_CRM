// Скелетон (G6): при включённом в системе «Уменьшить движение» блок стоит ровным цветом и ничего не зацикливает; без него
// пульсирует, как раньше, и останавливает цикл при уходе с экрана. Кадры в Jest не идут, поэтому проверяются запуск и
// остановка цикла и стартовое состояние блоков, а не плавность. Блоки берутся из `CardSkeleton`: у самого `Skeleton` нет testID.
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

/** Цикл пульсации без кадров: считает созданные, запущенные и остановленные циклы. */
function spyLoop() {
  const start = jest.fn();
  const stop = jest.fn();
  const loop = jest.spyOn(Animated, "loop").mockImplementation(() => ({ start, stop, reset: jest.fn() }) as never);
  return { loop, start, stop };
}

type Host = { props: Record<string, unknown> };
/** Три блока карточки: заголовок и две строки. */
const blocks = () => (screen.getByTestId("card").children as unknown as Host[]).map((block) => ({ props: block.props, style: StyleSheet.flatten(block.props.style as never) as Record<string, unknown> }));

afterEach(() => {
  jest.restoreAllMocks();
  setReducedMotionForTests(true); // как в jest.setup: по умолчанию движения в тестах нет
});

describe("Skeleton при «Уменьшить движение»", () => {
  it("цикл пульсации не создаётся и не запускается", async () => {
    setReducedMotionForTests(true);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(blocks()).toHaveLength(3);
    expect(spy.loop).not.toHaveBeenCalled();
    expect(spy.start).not.toHaveBeenCalled();
  });

  it("блоки стоят ровным цветом токена: размер и цвет прежние, прозрачность не анимируется", async () => {
    setReducedMotionForTests(true);
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(blocks().map(({ style }) => [style.height, style.width, style.backgroundColor, style.borderRadius])).toEqual([
      [22, "55%", lightTokens.skeleton, 6],
      [14, "100%", lightTokens.skeleton, 6],
      [14, "70%", lightTokens.skeleton, 6],
    ]);
    for (const { style } of blocks()) expect(style.opacity).toBeUndefined();
  });

  it("читалке блоки не видны: «загрузка» читается один раз, у родителя", async () => {
    setReducedMotionForTests(true);
    await render(wrap(<CardSkeleton testID="card" label="Загрузка карточки" />));
    for (const { props } of blocks()) {
      expect(props.importantForAccessibility).toBe("no");
      expect(props.accessibilityElementsHidden).toBe(true);
    }
    expect(screen.getByTestId("card")).toHaveAccessibleName("Загрузка карточки");
    expect(screen.getByTestId("card").props.accessibilityRole).toBe("progressbar");
    expect(screen.getByTestId("card")).toBeBusy();
  });
});

describe("Skeleton без «Уменьшить движение»: пульсирует, как раньше", () => {
  it("каждый блок запускает свой цикл пульсации", async () => {
    setReducedMotionForTests(false);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(spy.loop).toHaveBeenCalledTimes(3);
    expect(spy.start).toHaveBeenCalledTimes(3);
    expect(spy.stop).not.toHaveBeenCalled();
  });

  it("первый кадр: прозрачность 0,55, размер и цвет те же, что у статичного блока", async () => {
    setReducedMotionForTests(false);
    spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(blocks().map(({ style }) => [style.height, style.width, style.backgroundColor, style.borderRadius, style.opacity])).toEqual([
      [22, "55%", lightTokens.skeleton, 6, 0.55],
      [14, "100%", lightTokens.skeleton, 6, 0.55],
      [14, "70%", lightTokens.skeleton, 6, 0.55],
    ]);
  });

  it("уход с экрана останавливает циклы", async () => {
    setReducedMotionForTests(false);
    const spy = spyLoop();
    const view = await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    await view.unmount();
    expect(spy.stop).toHaveBeenCalledTimes(3);
  });
});

describe("Skeleton: настройку меняют на лету", () => {
  it("включили «Уменьшить движение» при открытом экране: циклы остановлены, блоки стоят ровно, новых циклов нет", async () => {
    setReducedMotionForTests(false);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(spy.loop).toHaveBeenCalledTimes(3);
    await act(async () => setReducedMotionForTests(true));
    expect(spy.stop).toHaveBeenCalledTimes(3);
    expect(spy.loop).toHaveBeenCalledTimes(3);
    for (const { style } of blocks()) expect(style.opacity).toBeUndefined();
  });

  it("выключили «Уменьшить движение»: пульсация начинается", async () => {
    setReducedMotionForTests(true);
    const spy = spyLoop();
    await render(wrap(<CardSkeleton testID="card" label="Загрузка" />));
    expect(spy.loop).not.toHaveBeenCalled();
    await act(async () => setReducedMotionForTests(false));
    expect(spy.loop).toHaveBeenCalledTimes(3);
    expect(spy.start).toHaveBeenCalledTimes(3);
  });
});
