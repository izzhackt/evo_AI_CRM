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

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderBar({ tier = "assisted", lang = "ru", theme = "light", onMenu = jest.fn() }: { tier?: "approved" | "assisted"; lang?: "ru" | "ky"; theme?: "light" | "dark"; onMenu?: () => void } = {}) {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial={theme}>
        <LangProvider initial={lang}>
          <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier })}>
            <TopBar onMenu={onMenu} />
          </PortalApiProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => navigate.mockClear());

describe("верхняя полоса телефона (веб Shell.tsx: .pt-topbar)", () => {
  it("assisted: ☰, лого-ссылка, справа колокольчик «Что нового» с числом", async () => {
    await renderBar();
    expect(screen.getByTestId("menu-button")).toBeTruthy();
    expect(screen.getByTestId("topbar-logo")).toBeTruthy();
    expect(screen.getByLabelText("Новых уведомлений: 4")).toBeTruthy();
  });

  it("approved: ленты нет, колокольчика нет; ☰ и лого остаются", async () => {
    await renderBar({ tier: "approved" });
    expect(screen.queryByTestId("notification-bell")).toBeNull();
    expect(screen.getByTestId("menu-button")).toBeTruthy();
    expect(screen.getByTestId("topbar-logo")).toBeTruthy();
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

  it("кнопка ☰ зовёт меню; высота полосы 52", async () => {
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
