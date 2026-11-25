// Тема (G3 аудита паритета 25.11.2026, решение владельца D3): светлая по умолчанию, как на вебе; кнопка «солнце/луна» вверху
// переключает одним нажатием; три варианта остаются в «Профиле»; значки строки состояния ведёт тема приложения.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import * as ReactNative from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PortalApiProvider } from "@/api/PortalApi";
import { LangProvider } from "@/i18n/LangProvider";
import { TopBar } from "@/shell/TopBar";
import { DEFAULT_THEME_CHOICE, ThemeProvider, useTheme, type ThemeChoice } from "@/theme/ThemeProvider";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { useStatusBarStyle } from "@/theme/useStatusBarStyle";
import { testApi } from "@/test-fixtures/render";
import { Text } from "@/ui/Text";

// Верхняя полоса тянет «Назад на Главную» через expo-router; в этом тесте навигации нет.
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, usePathname: () => "/home" }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

let system: "light" | "dark" = "light";
beforeEach(async () => {
  await AsyncStorage.clear();
  system = "light";
  jest.spyOn(ReactNative, "useColorScheme").mockImplementation(() => system);
});
afterEach(() => jest.restoreAllMocks());

/** Показывает, что видит остальное приложение: выбор, действующую схему и стиль значков строки состояния. */
function Probe() {
  const { choice, scheme } = useTheme();
  const statusBar = useStatusBarStyle();
  return (
    <Text testID="probe">
      {choice}|{scheme}|{statusBar}
    </Text>
  );
}

async function renderThemed(ui: ReactElement, initial?: ThemeChoice, lang: "ru" | "ky" = "ru") {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial={initial}>
        <LangProvider initial={lang}>{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}
const probe = () => screen.getByTestId("probe").props.children.join("");

describe("тема по умолчанию", () => {
  it("светлая, как на вебе, даже если система тёмная; тема ОС не читается", async () => {
    system = "dark";
    expect(DEFAULT_THEME_CHOICE).toBe("light");
    await renderThemed(<Probe />);
    expect(probe()).toBe("light|light|dark");
  });

  it("выбор «Как в системе», сохранённый студентом раньше, следует за системой", async () => {
    system = "dark";
    await AsyncStorage.setItem("evo.theme", "system");
    await renderThemed(<Probe />);
    await waitFor(() => expect(probe()).toBe("system|dark|light"));
  });

  it("сохранённый выбор «Тёмная» сильнее светлой по умолчанию и системы", async () => {
    await AsyncStorage.setItem("evo.theme", "dark");
    await renderThemed(<Probe />);
    await waitFor(() => expect(probe()).toBe("dark|dark|light"));
  });
});

describe("кнопка «солнце/луна»", () => {
  it("называется «Тёмная тема» и сообщает состояние переключателя", async () => {
    await renderThemed(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Тёмная тема" });
    expect(toggle.props.accessibilityState).toEqual({ checked: false });
  });

  it("KY: имя из словаря веба", async () => {
    await renderThemed(<ThemeToggle />, undefined, "ky");
    expect(screen.getByRole("switch", { name: "Караңгы тема" })).toBeTruthy();
  });

  it("одно нажатие: светлая -> тёмная -> светлая; значки строки состояния и выбор на устройстве меняются вместе", async () => {
    await renderThemed(
      <>
        <ThemeToggle />
        <Probe />
      </>,
    );
    expect(probe()).toBe("light|light|dark");
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    expect(probe()).toBe("dark|dark|light");
    expect(screen.getByTestId("theme-toggle").props.accessibilityState).toEqual({ checked: true });
    expect(await AsyncStorage.getItem("evo.theme")).toBe("dark");
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    expect(probe()).toBe("light|light|dark");
    expect(await AsyncStorage.getItem("evo.theme")).toBe("light");
  });

  it("при выборе «Как в системе» кнопка ставит явно противоположную действующей схеме тему", async () => {
    system = "dark";
    await renderThemed(
      <>
        <ThemeToggle />
        <Probe />
      </>,
      "system",
    );
    expect(probe()).toBe("system|dark|light");
    expect(screen.getByTestId("theme-toggle").props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    // явная светлая: система больше не ведёт
    expect(probe()).toBe("light|light|dark");
    expect(await AsyncStorage.getItem("evo.theme")).toBe("light");
  });

  it("три варианта «Профиля» живут рядом: любой из них выставляется без кнопки", async () => {
    function Choose() {
      const { setChoice } = useTheme();
      return <ThemeChoiceButtons set={setChoice} />;
    }
    function ThemeChoiceButtons({ set }: { set: (c: ThemeChoice) => void }) {
      return (
        <>
          <Text testID="to-system" onPress={() => set("system")}>
            system
          </Text>
          <Text testID="to-dark" onPress={() => set("dark")}>
            dark
          </Text>
        </>
      );
    }
    system = "dark";
    await renderThemed(
      <>
        <Choose />
        <Probe />
      </>,
    );
    await fireEvent.press(screen.getByTestId("to-system"));
    expect(probe()).toBe("system|dark|light");
    await fireEvent.press(screen.getByTestId("to-dark"));
    expect(probe()).toBe("dark|dark|light");
  });
});

describe("верхняя полоса кабинета", () => {
  it("кнопка темы стоит в верхней полосе рядом с ☰ и лого, у каждого уровня доступа", async () => {
    for (const tier of ["assisted", "approved"] as const) {
      const view = await renderThemed(
        <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier })}>
          <TopBar onMenu={() => undefined} />
        </PortalApiProvider>,
      );
      expect(view.getByTestId("menu-button")).toBeTruthy();
      expect(view.getByTestId("topbar-logo")).toBeTruthy();
      expect(view.getByTestId("theme-toggle")).toBeTruthy();
      await view.unmount();
    }
  });

  it("нажатие на кнопку темы в верхней полосе переключает тему", async () => {
    await renderThemed(
      <PortalApiProvider api={testApi(async () => ({ data: null, error: null, status: 200 }), { tier: "approved" })}>
        <TopBar onMenu={() => undefined} />
        <Probe />
      </PortalApiProvider>,
    );
    expect(probe()).toBe("light|light|dark");
    await fireEvent.press(screen.getByTestId("theme-toggle"));
    expect(probe()).toBe("dark|dark|light");
  });
});
