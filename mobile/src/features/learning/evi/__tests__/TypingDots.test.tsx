// Бегущие точки «Эви печатает»: волна идёт, пока точки на экране, и снимается с экраном; при «уменьшить движение» точки стоят ступенями
// яркости 1, 0,6 и 0,3 (portal.css, блок «Эви пишет ответ»).
import { Animated } from "react-native";

import { STILL_DOT_OPACITY, TypingDots } from "@/features/learning/evi/TypingDots";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

let mockReduce = false;
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => mockReduce }));

const mount = async (ui: React.ReactElement) => renderPortal(ui, testApi(fakeTransport({}).transport));
const dotStyles = (view: Awaited<ReturnType<typeof mount>>) => {
  const row = view.getByTestId("evi-dots", { includeHiddenElements: true });
  return row.children.map((child) => {
    const node = child as unknown as { props: { style: unknown } };
    return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
  });
};

describe("TypingDots", () => {
  beforeEach(() => {
    mockReduce = false;
  });
  afterEach(() => jest.restoreAllMocks());

  it("три точки заданного размера с зазором; для читалки скрыты (слово «печатает» читает строка рядом)", async () => {
    const view = await mount(<TypingDots size={8} gap={6} />);
    const row = view.getByTestId("evi-dots", { includeHiddenElements: true });
    expect(row.props.accessibilityElementsHidden).toBe(true);
    expect(row.props.importantForAccessibility).toBe("no-hide-descendants");
    const styles = dotStyles(view);
    expect(styles).toHaveLength(3);
    for (const style of styles) expect(style).toMatchObject({ width: 8, height: 8, borderRadius: 4 });
    const header = await mount(<TypingDots size={4} gap={3} testID="small" />);
    expect(Object.assign({}, ...[header.getByTestId("small", { includeHiddenElements: true }).props.style].flat())).toMatchObject({ gap: 3 });
  });

  it("волна идёт у каждой точки (бесконечный круг со сдвигом 150 мс) и снимается при уходе экрана", async () => {
    const waves: { start: jest.Mock; stop: jest.Mock }[] = [];
    const loop = jest.spyOn(Animated, "loop");
    jest.spyOn(Animated, "parallel").mockImplementation((() => {
      const wave = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
      waves.push(wave);
      return wave;
    }) as never);
    const view = await mount(<TypingDots />);
    // Три круга собраны вместе и запущены один раз.
    expect(loop).toHaveBeenCalledTimes(3);
    expect(waves).toHaveLength(1);
    expect(waves[0]?.start).toHaveBeenCalledTimes(1);
    expect(waves[0]?.stop).not.toHaveBeenCalled();
    await view.unmount();
    expect(waves[0]?.stop).toHaveBeenCalled();
  });

  it("«уменьшить движение»: волны нет, точки стоят ступенями яркости 1, 0,6 и 0,3", async () => {
    mockReduce = true;
    const loop = jest.spyOn(Animated, "loop");
    const view = await mount(<TypingDots />);
    expect(loop).not.toHaveBeenCalled();
    expect(dotStyles(view).map((style) => style.opacity)).toEqual([...STILL_DOT_OPACITY]);
    expect(STILL_DOT_OPACITY).toEqual([1, 0.6, 0.3]);
  });
});
