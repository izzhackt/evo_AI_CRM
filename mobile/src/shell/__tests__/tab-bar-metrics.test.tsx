import { act, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import { reportTabBarHeight, useMeasuredTabBarHeight } from "@/shell/tab-bar-metrics";

function Probe() {
  return <Text testID="height">{String(useMeasuredTabBarHeight())}</Text>;
}

afterEach(() => reportTabBarHeight(0));

describe("измеренная высота панели вкладок", () => {
  it("до измерения 0; сообщённая высота доходит до читателя и обновляет его", async () => {
    await render(<Probe />);
    expect(screen.getByTestId("height")).toHaveTextContent("0");
    await act(async () => reportTabBarHeight(70.4));
    expect(screen.getByTestId("height")).toHaveTextContent("70"); // целые pt
    await act(async () => reportTabBarHeight(88));
    expect(screen.getByTestId("height")).toHaveTextContent("88");
  });

  it("нечисло, ноль и отрицательное значат «неизвестно»: 0", async () => {
    await render(<Probe />);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      await act(async () => reportTabBarHeight(80));
      await act(async () => reportTabBarHeight(bad));
      expect(screen.getByTestId("height")).toHaveTextContent("0");
    }
  });

  it("то же значение читателей не будит; после отписки (размонтирования) ничего не ломается", async () => {
    const commits = { count: 0 };
    function Counting() {
      const height = useMeasuredTabBarHeight();
      // число отрисовок считаем в эффекте: менять внешнюю переменную прямо в отрисовке нельзя
      useEffect(() => {
        commits.count += 1;
      });
      return <Text>{height}</Text>;
    }
    const view = await render(<Counting />);
    await act(async () => reportTabBarHeight(62));
    const after = commits.count;
    await act(async () => reportTabBarHeight(62));
    expect(commits.count).toBe(after);
    await view.unmount();
    expect(() => reportTabBarHeight(90)).not.toThrow();
  });
});
