// Расстояние от верха экрана до экранов кабинета: отступ безопасной зоны + верхняя полоса + карточка сбоя опроса (она в потоке).
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { reportTopNoticeHeight, useTopChromeHeight } from "@/shell/top-chrome";
import { TOP_BAR_HEIGHT } from "@/shell/top-bar-metrics";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Probe() {
  return <Text testID="chrome">{String(useTopChromeHeight())}</Text>;
}
const shown = () => screen.getByTestId("chrome").props.children as string;

beforeEach(() => reportTopNoticeHeight(0));
afterEach(() => reportTopNoticeHeight(0));

describe("высота верха кабинета над экранами", () => {
  it("без карточки: отступ безопасной зоны и верхняя полоса", async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Probe />
      </SafeAreaProvider>,
    );
    expect(shown()).toBe(String(47 + TOP_BAR_HEIGHT));
  });

  it("карточка сообщила высоту: она прибавляется, пока стоит; ушла (0) - снова без неё", async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Probe />
      </SafeAreaProvider>,
    );
    await act(async () => reportTopNoticeHeight(60));
    expect(shown()).toBe(String(47 + TOP_BAR_HEIGHT + 60));
    await act(async () => reportTopNoticeHeight(0));
    expect(shown()).toBe(String(47 + TOP_BAR_HEIGHT));
  });

  it("нечисло, ноль и отрицательное считаются «карточки нет»; дробное округляется", async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Probe />
      </SafeAreaProvider>,
    );
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      await act(async () => reportTopNoticeHeight(bad));
      expect(shown()).toBe(String(47 + TOP_BAR_HEIGHT));
    }
    await act(async () => reportTopNoticeHeight(59.6));
    expect(shown()).toBe(String(47 + TOP_BAR_HEIGHT + 60));
  });
});
