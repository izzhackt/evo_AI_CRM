import { render } from "@testing-library/react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { TabBar } from "@/shell/TabBar";
import { TAB_BAR_CLEARANCE, useTabBarClearance } from "@/shell/useTabBarClearance";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { PortalApiProvider } from "@/api/PortalApi";
import { testApi } from "@/test-fixtures/render";
import { Text } from "react-native";

jest.mock("expo-router", () => ({ usePathname: () => "/home" }));
jest.mock("@/api/PortalPoll", () => ({ usePortalUnread: () => null }));

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
