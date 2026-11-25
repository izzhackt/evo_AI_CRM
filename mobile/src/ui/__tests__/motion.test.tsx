// Движение кабинета (веб: pt-enter, pt-fill-grow, переход значка и нажатия): значения - токены движения, всё один раз,
// при «Уменьшить движение» блоки стоят на месте сразу. В Jest нет нативного движка анимаций, кадры не идут, поэтому
// проверяются стартовое состояние и параметры запущенной анимации (длительность, задержка, конечное значение).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Animated, StyleSheet, Text as RNText } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { lightTokens } from "@/theme/tokens.generated";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Enter, GrowX, PressableScale, Turn, bezierOf, setReducedMotionForTests, useReducedMotion } from "@/ui/motion";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
const style = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
const transformOf = (testID: string, key: string) => ((style(testID).transform as Record<string, unknown>[]).find((item) => item[key] !== undefined)?.[key] ?? null);

/** `Animated.timing` без кадров: записывает параметры и считает запуски. */
function spyTiming() {
  const start = jest.fn();
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, "timing").mockImplementation(() => ({ start, stop, reset: jest.fn() }) as never);
  return { timing, start, stop, configs: () => timing.mock.calls.map((call) => call[1] as Animated.TimingAnimationConfig) };
}

afterEach(() => {
  jest.restoreAllMocks();
  setReducedMotionForTests(true); // как в jest.setup: по умолчанию движения в тестах нет
});

describe("«Уменьшить движение»", () => {
  it("блок стоит на месте сразу: непрозрачный, без сдвига, анимация не запускается", async () => {
    setReducedMotionForTests(true);
    const spy = spyTiming();
    await render(
      wrap(
        <Enter testID="block" index={3}>
          <RNText>готово</RNText>
        </Enter>,
      ),
    );
    expect(style("block").opacity).toBe(1);
    expect(transformOf("block", "translateY")).toBe(0);
    expect(spy.timing).not.toHaveBeenCalled();
  });

  it("настройка читается хуком и меняется на лету", async () => {
    setReducedMotionForTests(false);
    function Probe() {
      return <RNText testID="probe">{String(useReducedMotion())}</RNText>;
    }
    await render(wrap(<Probe />));
    expect(screen.getByTestId("probe")).toHaveTextContent("false");
    await act(async () => setReducedMotionForTests(true));
    expect(screen.getByTestId("probe")).toHaveTextContent("true");
  });
});

describe("вход блока (pt-enter)", () => {
  it("до своей очереди блок скрыт и опущен на `rise`; анимация: 0 -> 1 за motionBase по easeOut на нативном потоке", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    await render(
      wrap(
        <Enter testID="block" index={0}>
          <RNText>вход</RNText>
        </Enter>,
      ),
    );
    // первый кадр: прозрачно и ниже на 8 px (токен `rise`), как `animation-fill-mode: backwards`
    expect(style("block").opacity).toBe(0);
    expect(transformOf("block", "translateY")).toBe(lightTokens.rise);
    expect(spy.start).toHaveBeenCalledTimes(1);
    expect(spy.configs()[0]).toMatchObject({ toValue: 1, duration: lightTokens.motionBase, delay: 0, useNativeDriver: true });
    expect(typeof spy.configs()[0].easing).toBe("function");
  });

  it("очередь: блок под номером N стартует позже на N x `stagger` мс", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    await render(
      wrap(
        <>
          <Enter index={0}>
            <RNText>1</RNText>
          </Enter>
          <Enter index={4}>
            <RNText>5</RNText>
          </Enter>
        </>,
      ),
    );
    expect(spy.configs().map((config) => config.delay)).toEqual([0, lightTokens.stagger * 4]);
    expect(lightTokens.stagger * 4).toBe(120);
  });

  it("размонтирование останавливает анимацию", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    const view = await render(
      wrap(
        <Enter index={0}>
          <RNText>вход</RNText>
        </Enter>,
      ),
    );
    await view.unmount();
    expect(spy.stop).toHaveBeenCalled();
  });
});

describe("полоса, значок и нажатие", () => {
  it("полоса растёт слева направо из нуля один раз: scaleX 0 -> 1 за motionSlow после 2 x stagger", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    await render(
      wrap(
        <GrowX testID="meter">
          <RNText>полоса</RNText>
        </GrowX>,
      ),
    );
    expect(style("meter").transformOrigin).toBe("left center");
    expect(transformOf("meter", "scaleX")).toBe(0);
    expect(spy.configs()[0]).toMatchObject({ toValue: 1, duration: lightTokens.motionSlow, delay: lightTokens.stagger * 2, useNativeDriver: true });
  });

  it("полоса при «Уменьшить движение» сразу полная", async () => {
    setReducedMotionForTests(true);
    await render(
      wrap(
        <GrowX testID="meter">
          <RNText>полоса</RNText>
        </GrowX>,
      ),
    );
    expect(transformOf("meter", "scaleX")).toBe(1);
  });

  it("значок поворачивается плавно за motionFast: 0 -> 1 и обратно; при «Уменьшить движение» сразу", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    const view = await render(
      wrap(
        <Turn turned={false} testID="chevron">
          <RNText>v</RNText>
        </Turn>,
      ),
    );
    expect(transformOf("chevron", "rotate")).toBeTruthy();
    expect(spy.configs()[0]).toMatchObject({ toValue: 0, duration: lightTokens.motionFast, useNativeDriver: true });
    await view.rerender(
      wrap(
        <Turn turned testID="chevron">
          <RNText>v</RNText>
        </Turn>,
      ),
    );
    expect(spy.configs().at(-1)).toMatchObject({ toValue: 1, duration: lightTokens.motionFast });
  });

  it("карточка «садится» при нажатии на `pressScale` за motionPress и возвращается", async () => {
    setReducedMotionForTests(false);
    const spy = spyTiming();
    await render(
      wrap(
        <PressableScale testID="card" accessibilityRole="button" onPress={() => undefined}>
          <RNText>карточка</RNText>
        </PressableScale>,
      ),
    );
    await fireEvent(screen.getByTestId("card"), "pressIn");
    expect(spy.configs().at(-1)).toMatchObject({ toValue: lightTokens.pressScale, duration: lightTokens.motionPress, useNativeDriver: true });
    await fireEvent(screen.getByTestId("card"), "pressOut");
    expect(spy.configs().at(-1)).toMatchObject({ toValue: 1, duration: lightTokens.motionPress });
  });

  it("нажатие работает и без движения", async () => {
    setReducedMotionForTests(true);
    const onPress = jest.fn();
    await render(
      wrap(
        <PressableScale testID="card" accessibilityRole="button" onPress={onPress}>
          <RNText>карточка</RNText>
        </PressableScale>,
      ),
    );
    await fireEvent.press(screen.getByTestId("card"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("кривая из токена", () => {
  it("`cubic-bezier(0.22, 1, 0.36, 1)` даёт кривую от 0 до 1; чужая запись - обычное замедление", () => {
    const ease = bezierOf(lightTokens.easeOut);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.5); // ease-out: быстрый старт
    const fallback = bezierOf("ease");
    expect(fallback(0)).toBe(0);
    expect(fallback(1)).toBe(1);
  });
});
