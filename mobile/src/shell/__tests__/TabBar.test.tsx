import { fireEvent, render, within } from "@testing-library/react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { BADGE_MAX_FONT_SCALE } from "@/shell/badge";
import { TabBar } from "@/shell/TabBar";
import { reportTabBarHeight, useMeasuredTabBarHeight } from "@/shell/tab-bar-metrics";
import { TAB_BAR_CLEARANCE, useTabBarClearance } from "@/shell/useTabBarClearance";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { PortalApiProvider } from "@/api/PortalApi";
import { testApi } from "@/test-fixtures/render";
import { Text } from "react-native";

jest.mock("expo-router", () => ({ usePathname: () => "/home" }));
let mockUnread: number | null = null;
jest.mock("@/api/PortalPoll", () => ({ usePortalUnread: () => mockUnread }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const routes = ["home", "documents", "messages"].map((name) => ({ key: name, name }));
const props = { state: { index: 0, routes }, navigateToTab: jest.fn() } as unknown as BottomTabBarProps;

function Clearance() {
  return <Text testID="clearance">{String(useTabBarClearance())}</Text>;
}

async function renderWith(tier: "approved" | "assisted", ui: React.ReactElement) {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier })}>{ui}</PortalApiProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("панель вкладок и нижний запас: одно правило hasTabBar", () => {
  it("approved: панель не рисуется и запаса под неё нет", async () => {
    const bar = await renderWith("approved", <TabBar {...props} />);
    expect(bar.queryByTestId("tab-home")).toBeNull();
    expect(bar.queryByRole("tablist")).toBeNull();
    const clearance = await renderWith("approved", <Clearance />);
    expect(clearance.getByTestId("clearance")).toHaveTextContent("0");
  });
  it("assisted: панель есть и запас равен её высоте", async () => {
    const bar = await renderWith("assisted", <TabBar {...props} />);
    expect(bar.getByTestId("tab-home")).toBeTruthy();
    const clearance = await renderWith("assisted", <Clearance />);
    expect(clearance.getByTestId("clearance")).toHaveTextContent(String(TAB_BAR_CLEARANCE));
  });
});

describe("вкладка «Входящие»: число непрочитанного словами и открытая вкладка без плашки", () => {
  beforeEach(() => {
    mockUnread = null;
  });

  it("с числом: имя вкладки со словами веба, кружок читалке не виден, у больших 99+", async () => {
    mockUnread = 3;
    const bar = await renderWith("assisted", <TabBar {...props} />);
    const tab = bar.getByTestId("tab-messages");
    expect(tab.props.accessibilityLabel).toBe("Входящие, Новых уведомлений: 3");
    const badge = bar.getByTestId("tab-messages-badge", { includeHiddenElements: true });
    expect(badge.props.accessibilityElementsHidden).toBe(true);
    expect(badge).toHaveTextContent("3");
    mockUnread = 120;
    const big = await renderWith("assisted", <TabBar {...props} />);
    expect(big.getByTestId("tab-messages").props.accessibilityLabel).toBe("Входящие, Новых уведомлений: 120");
    expect(big.getByTestId("tab-messages-badge", { includeHiddenElements: true })).toHaveTextContent("99+");
  });

  it("без числа: подписи нет, кружка нет; у других вкладок подписи не бывает", async () => {
    const bar = await renderWith("assisted", <TabBar {...props} />);
    expect(bar.getByTestId("tab-messages").props.accessibilityLabel).toBeUndefined();
    expect(bar.queryByTestId("tab-messages-badge", { includeHiddenElements: true })).toBeNull();
    mockUnread = 5;
    const withCount = await renderWith("assisted", <TabBar {...props} />);
    expect(withCount.getByTestId("tab-home").props.accessibilityLabel).toBeUndefined();
  });

  it("открытая вкладка выделена цветом и весом, а не плашкой (веб, телефон: aria-current без фона)", async () => {
    const bar = await renderWith("assisted", <TabBar {...props} />);
    const flat = (node: ReturnType<typeof bar.getByTestId>) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    expect(flat(bar.getByTestId("tab-home")).backgroundColor).toBeUndefined();
    expect(bar.getByTestId("tab-home").props.accessibilityState).toMatchObject({ selected: true });
    expect(bar.getByTestId("tab-documents").props.accessibilityState).toMatchObject({ selected: false });
  });
});

describe("высота панели уходит кнопке «Написать EVO»", () => {
  afterEach(() => reportTabBarHeight(0));
  const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 366, height } } });
  function Height() {
    return <Text testID="measured">{String(useMeasuredTabBarHeight())}</Text>;
  }

  it("после раскладки панель сообщает высоту, при размонтировании снимает её", async () => {
    const view = await renderWith(
      "assisted",
      <>
        <TabBar {...props} />
        <Height />
      </>,
    );
    expect(view.getByTestId("measured")).toHaveTextContent("0");
    await fireEvent(view.getByTestId("tab-bar"), "layout", layout(88));
    expect(view.getByTestId("measured")).toHaveTextContent("88");
    await view.unmount();
    expect(() => reportTabBarHeight(0)).not.toThrow();
    const after = await renderWith("assisted", <Height />);
    expect(after.getByTestId("measured")).toHaveTextContent("0"); // размонтированная панель оставила 0
  });

  it("панели нет (approved): ничего не сообщается, измеренная высота 0", async () => {
    reportTabBarHeight(70); // осталось от прежней панели
    const view = await renderWith(
      "approved",
      <>
        <TabBar {...props} />
        <Height />
      </>,
    );
    expect(view.getByTestId("measured")).toHaveTextContent("0");
  });
});

describe("кружок «Входящих» при крупном шрифте", () => {
  beforeEach(() => {
    mockUnread = 12;
  });
  afterEach(() => {
    mockUnread = null;
  });

  it("цифра не обрезается и кружок не раздувается: высота минимальная, а не жёсткая, масштаб числа ограничен", async () => {
    const bar = await renderWith("assisted", <TabBar {...props} />);
    const badge = bar.getByTestId("tab-messages-badge", { includeHiddenElements: true });
    const style = Object.assign({}, ...[badge.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
    expect(style.minHeight).toBe(18);
    expect(style.height).toBeUndefined(); // раньше было height: 18, и цифра при крупном шрифте обрезалась
    const digits = within(badge).getByText("12", { includeHiddenElements: true });
    expect(digits.props.maxFontSizeMultiplier).toBe(BADGE_MAX_FONT_SCALE);
  });
});
