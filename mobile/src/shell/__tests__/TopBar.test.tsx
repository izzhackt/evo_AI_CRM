import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PortalApiProvider } from "@/api/PortalApi";
import { LangProvider } from "@/i18n/LangProvider";
import { TopBar } from "@/shell/TopBar";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { testApi } from "@/test-fixtures/render";

jest.mock("@/api/PortalPoll", () => ({ usePortalUnread: () => 4 }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => "/home" }));
const navigate = router.navigate as jest.Mock;
// Общая мера высоты верхней полосы читается через геттер: тест подменяет число и видит, что полоса берёт его оттуда, а не своим
// числом (настоящее значение сверяет тест карточки обновления, `shell/top-bar-metrics`).
let mockBarHeight = 52;
jest.mock("@/shell/top-bar-metrics", () => ({
  get TOP_BAR_HEIGHT() {
    return mockBarHeight;
  },
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderBar({ tier = "assisted", lang = "ru", theme = "light", onMenu = jest.fn(), provider = true }: { tier?: "approved" | "assisted"; lang?: "ru" | "ky"; theme?: "light" | "dark"; onMenu?: () => void; provider?: boolean } = {}) {
  const bar = <TopBar onMenu={onMenu} />;
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial={theme}>
        <LangProvider initial={lang}>
          {provider ? <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier })}>{bar}</PortalApiProvider> : bar}
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  mockBarHeight = 52;
});

describe("верхняя полоса телефона (веб Shell.tsx: .pt-topbar)", () => {
  it("assisted: ☰, лого-ссылка, справа колокольчик «Что нового» с числом, затем кнопка темы (порядок веба)", async () => {
    await renderBar();
    expect(screen.getByTestId("menu-button")).toBeTruthy();
    expect(screen.getByTestId("topbar-logo")).toBeTruthy();
    expect(screen.getByLabelText("Новых уведомлений: 4")).toBeTruthy();
    // колокольчик раньше кнопки темы: порядок в разметке справа налево читается как в вебе (Shell.tsx: колокольчик, тема)
    const order = screen.getAllByTestId(/^(notification-bell|theme-toggle)$/).map((node) => node.props.testID);
    expect(order).toEqual(["notification-bell", "theme-toggle"]);
  });

  it("approved: ленты нет, колокольчика нет; ☰, лого и кнопка темы остаются (тема нужна всем уровням)", async () => {
    await renderBar({ tier: "approved" });
    expect(screen.queryByTestId("notification-bell")).toBeNull();
    expect(screen.getByTestId("menu-button")).toBeTruthy();
    expect(screen.getByTestId("topbar-logo")).toBeTruthy();
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
  });

  it("без провайдера кабинета полоса не падает: ☰, лого и кнопка темы, колокольчика нет", async () => {
    await renderBar({ provider: false });
    expect(screen.getByTestId("menu-button")).toBeTruthy();
    expect(screen.getByTestId("topbar-logo")).toBeTruthy();
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
    expect(screen.queryByTestId("notification-bell")).toBeNull();
  });

  it("лого — ссылка на «Главную» с именем веба (home), в обоих языках", async () => {
    await renderBar();
    const logo = screen.getByTestId("topbar-logo");
    expect(logo.props.accessibilityRole).toBe("link");
    expect(logo.props.accessibilityLabel).toBe("EVO Admissions — кабинет студента");
    await fireEvent.press(logo);
    expect(navigate).toHaveBeenCalledWith("/home");
    await renderBar({ lang: "ky" });
    expect(screen.getByLabelText("EVO Admissions — студенттин кабинети")).toBeTruthy();
  });

  it("высота строки полосы - общая мера `TOP_BAR_HEIGHT`, а не число в самой полосе", async () => {
    mockBarHeight = 64;
    await renderBar();
    expect(screen.getByTestId("topbar-row").props.style).toMatchObject({ height: 64 });
  });

  it("кнопка ☰ зовёт меню", async () => {
    const onMenu = jest.fn();
    await renderBar({ onMenu });
    await fireEvent.press(screen.getByTestId("menu-button"));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("лого: полное лого веба 88 pt шириной; в тёмной теме тот же файл с белыми буквами", async () => {
    const lightView = await renderBar({ theme: "light" });
    const light = lightView.getByTestId("topbar-logo-image");
    expect(light.props.style).toMatchObject({ width: 88, height: 40 });
    const darkView = await renderBar({ theme: "dark" });
    const dark = darkView.getByTestId("topbar-logo-image");
    expect(dark.props.source).not.toEqual(light.props.source);
    expect(dark.props.style).toMatchObject({ width: 88, height: 40 });
  });
});
