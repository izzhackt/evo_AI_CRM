// Закрепление строки «Шаг N из M» на НАСТОЯЩЕМ ScrollView React Native (не на заглушке Jest, которая закреплённые блоки не
// оборачивает): строка закреплена всегда, а «Свернуть» и «Все шаги» не пересоздают её. Ревью #1577: прежний вариант убирал строку из
// закреплённых при свёрнутом пути, и каждый переключатель пересоздавал блок (полоса шагов росла заново, стрелка не поворачивалась,
// кнопка с фокусом читалки пропадала). Здесь же настоящий `ScrollViewStickyHeader` с числами, снятыми на телефоне.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ComponentType, ReactNode } from "react";
import { Animated, Dimensions, View } from "react-native";

import { PIN_MAX_SHARE, ROW_SLACK } from "@/features/admission/JourneySection";
import { HomeScreen } from "@/features/home/HomeScreen";
import { lightTokens } from "@/theme/tokens.generated";
import { setReducedMotionForTests } from "@/ui/motion";
import { homeHandlers, restoreNow, setNow } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.unmock("react-native/Libraries/Components/ScrollView/ScrollView");
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());

const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
const layout = (height: number, y = 0) => ({ nativeEvent: { layout: { x: 0, y, width: 358, height } } });
type Config = { inputRange: number[]; outputRange: number[] };

beforeEach(async () => {
  jest.requireMock("expo-file-system").__files.clear();
  await AsyncStorage.clear();
  setNow("2026-09-08T05:00:00Z");
});
afterEach(() => {
  restoreNow();
  jest.restoreAllMocks();
  setReducedMotionForTests(true);
});

async function openHome() {
  const { transport } = fakeTransport(homeHandlers("MY"));
  await renderPortal(<HomeScreen />, testApi(transport));
  return screen.findByTestId("journey-now-row");
}
/** Обёртка закреплённого блока, которую рисует ScrollView: родитель корня блока. */
const wrapperOf = (testID: string) => screen.getByTestId(testID, { includeHiddenElements: true }).parent!;

describe("строка закреплена и при свёрнутом, и при раскрытом пути; переключатель её не пересоздаёт", () => {
  it("строка и нулевой блок лежат в обёртках закреплённых блоков в обоих состояниях", async () => {
    await openHome();
    for (const testID of ["journey-now-row", "journey-end"]) expect(wrapperOf(testID).type).toBe("View");
    // свёрнутый путь: обёртка есть, у строки запас под ней, нулевой блок сразу за ней
    expect(flat(wrapperOf("journey-now-row")).marginBottom).toBe(ROW_SLACK);
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    // раскрытый путь: обёртки те же, запаса нет (между строкой и нулевым блоком шаги)
    expect(wrapperOf("journey-now-row")).toBeTruthy();
    expect(wrapperOf("journey-end")).toBeTruthy();
    expect(flat(wrapperOf("journey-now-row")).marginBottom).toBeUndefined();
  });

  it("свернуть и раскрыть три раза: строка и кнопка остаются теми же узлами (читалка не теряет фокус), полоса шагов не перезапускается", async () => {
    setReducedMotionForTests(false);
    const timing = jest.spyOn(Animated, "timing").mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }) as never);
    const row = await openHome();
    const fold = screen.getByTestId("journey-fold");
    const meterGrowths = () => timing.mock.calls.filter((call) => (call[1] as Animated.TimingAnimationConfig).duration === lightTokens.motionSlow).length;
    const before = meterGrowths();
    expect(before).toBe(1); // полоса вырастает при первом показе
    for (let turn = 0; turn < 3; turn += 1) {
      await fireEvent.press(screen.getByTestId("journey-fold"));
      await waitFor(() => expect(screen.getByTestId("journey-fold").props.accessibilityLabel).toBe(turn % 2 === 0 ? "Свернуть" : "Все шаги"));
      expect(screen.getByTestId("journey-now-row")).toBe(row);
      expect(screen.getByTestId("journey-fold")).toBe(fold);
    }
    expect(meterGrowths()).toBe(before); // 1 -> 1 -> 1 -> 1, а не 1 -> 2 -> 3
  });

  it("кнопка «Все шаги» / «Свернуть» не пересоздаётся и у высокой строки (крупный шрифт): блоки лишь переставляются", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
    const row = await openHome();
    const fold = screen.getByTestId("journey-fold");
    await fireEvent.press(fold);
    await screen.findByTestId("journey-body");
    await fireEvent(row, "layout", layout(374)); // 43% окна: строка не держится
    await waitFor(() => expect(flat(wrapperOf("journey-now-row")).marginBottom).toBe(ROW_SLACK));
    expect(screen.getByTestId("journey-now-row")).toBe(row);
    expect(screen.getByTestId("journey-fold")).toBe(fold);
    await fireEvent(row, "layout", layout(120)); // шрифт уменьшили: строка снова держится
    await waitFor(() => expect(flat(wrapperOf("journey-now-row")).marginBottom).toBeUndefined());
    expect(screen.getByTestId("journey-now-row")).toBe(row);
    expect(screen.getByTestId("journey-fold")).toBe(fold);
  });
});

// ---- Настоящий ScrollViewStickyHeader ------------------------------------------------------------------------------------------
type StickyHeaderProps = { scrollAnimatedValue: Animated.Value; nextHeaderLayoutY: number | null; onLayout: () => void; inverted: boolean; scrollViewHeight: number | null; children?: ReactNode };
const StickyHeader = (jest.requireActual("react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader") as { default: ComponentType<StickyHeaderProps> }).default;

/**
 * Что настоящий `ScrollViewStickyHeader` делает со строкой при таких числах раскладки: «отпущена» - после точки столкновения с
 * блоком за ней перемещение перестаёт расти (последние два значения равны), `travel` - на сколько пунктов она успевает
 * закрепиться; «держится навсегда» - перемещение растёт вместе с прокруткой (последнее значение 1 на единицу входа).
 */
async function rowBehaviour(row: { y: number; height: number }, nextHeaderLayoutY: number) {
  const scrollY = new Animated.Value(0);
  const interpolate = jest.spyOn(scrollY, "interpolate");
  const view = await render(
    <StickyHeader scrollAnimatedValue={scrollY} nextHeaderLayoutY={nextHeaderLayoutY} onLayout={() => undefined} inverted={false} scrollViewHeight={null}>
      <View testID="sticky-child" />
    </StickyHeader>,
  );
  await fireEvent(screen.getByTestId("sticky-child").parent!, "layout", layout(row.height, row.y));
  const { outputRange } = interpolate.mock.calls.at(-1)![0] as Config;
  const released = outputRange.length >= 2 && outputRange.at(-1) === outputRange.at(-2);
  await view.unmount();
  return { released, travel: released ? outputRange.at(-1)! : Number.POSITIVE_INFINITY };
}

describe("настоящий ScrollViewStickyHeader отпускает строку при числах с телефона", () => {
  // Android-эмулятор, свёрнутый путь: строка и нулевой блок за ней, числа раскладки как есть
  const ROW = { y: 356.190491, height: 117.333336 };
  const END_Y = 473.523804;

  it("без запаса левая часть меньше правой на 2e-5: строка держится навсегда (дефект, из-за которого она закрывала карточки)", async () => {
    expect(END_Y - ROW.height).toBeLessThan(ROW.y);
    expect(ROW.y - (END_Y - ROW.height)).toBeLessThan(1e-4);
    expect((await rowBehaviour(ROW, END_Y)).released).toBe(false);
  });

  it("с запасом ROW_SLACK под строкой её отпускают, и закрепляется она не больше чем на этот запас", async () => {
    const behaviour = await rowBehaviour(ROW, END_Y + ROW_SLACK);
    expect(behaviour.released).toBe(true);
    expect(behaviour.travel).toBeCloseTo(ROW_SLACK, 3);
  });

  it("раскрытый путь: шаги между строкой и нулевым блоком отпускают строку и без запаса, ход равен их высоте", async () => {
    const behaviour = await rowBehaviour(ROW, END_Y + 700);
    expect(behaviour.released).toBe(true);
    expect(behaviour.travel).toBeGreaterThanOrEqual(700 - 1e-3);
  });

  it("триста раскладок с округлением float32: с запасом отпущены все, без запаса часть держится навсегда", async () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; // детерминированный генератор
    let stuckWithout = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const row = { y: Math.fround(100 + random() * 2000), height: Math.fround(40 + random() * 340) };
      const end = Math.fround(row.y + row.height); // как складывает раскладка: числа float32
      if (!(await rowBehaviour(row, end)).released) stuckWithout += 1;
      expect((await rowBehaviour(row, Math.fround(end + ROW_SLACK))).released).toBe(true);
    }
    expect(stuckWithout).toBeGreaterThan(0); // класс дефекта настоящий: на части раскладок равенство ломается в худшую сторону
  });

  it("на самом экране: обёртки строки и нулевого блока с настоящей раскладкой отпускают строку при свёрнутом и при раскрытом пути", async () => {
    const interpolate = jest.spyOn(Animated.Value.prototype, "interpolate");
    await openHome();
    const margin = () => (flat(wrapperOf("journey-now-row")).marginBottom as number | undefined) ?? 0;
    const settle = async (rowBox: { y: number; height: number }, endY: number) => {
      interpolate.mockClear();
      await fireEvent(wrapperOf("journey-now-row"), "layout", layout(rowBox.height, rowBox.y));
      await fireEvent(wrapperOf("journey-end"), "layout", layout(0, endY));
      const configs = interpolate.mock.calls.map((call) => call[0] as Config).filter((config) => config.inputRange.includes(rowBox.y));
      const { outputRange } = configs.at(-1)!;
      return { released: outputRange.at(-1) === outputRange.at(-2), travel: outputRange.at(-1)! };
    };
    // свёрнутый путь: блок за строкой стоит у нижнего края строки плюс её запас (отступ под обёрткой)
    const folded = await settle(ROW, Math.fround(ROW.y + ROW.height) + margin());
    expect(margin()).toBe(ROW_SLACK);
    expect(folded.released).toBe(true);
    expect(folded.travel).toBeCloseTo(ROW_SLACK, 3);
    // раскрытый путь: тело шагов между ними (700 pt), запаса нет
    await fireEvent.press(screen.getByTestId("journey-fold"));
    await screen.findByTestId("journey-body");
    expect(margin()).toBe(0);
    const unfolded = await settle(ROW, Math.fround(ROW.y + ROW.height) + 700);
    expect(unfolded.released).toBe(true);
    expect(unfolded.travel).toBeGreaterThanOrEqual(700 - 1e-3);
  });

  it("то же без запаса на экране: ровно у нижнего края строка не отпускается (порча: запас убран)", async () => {
    // страховка самого теста: при нулевом запасе настоящая раскладка телефона даёт «держится навсегда»
    expect(PIN_MAX_SHARE).toBe(0.4);
    expect((await rowBehaviour(ROW, END_Y)).released).toBe(false);
  });
});
