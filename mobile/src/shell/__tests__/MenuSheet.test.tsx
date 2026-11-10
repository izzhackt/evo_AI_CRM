import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { MenuSheet } from "@/shell/MenuSheet";
import { ThemeProvider } from "@/theme/ThemeProvider";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function renderMenu(tier: "approved" | "assisted", lang: "ru" | "ky" = "ru", onSignOut: () => void = () => undefined) {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <MenuSheet visible tier={tier} active="home" onSelect={() => undefined} onSignOut={onSignOut} onClose={() => undefined} />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("MenuSheet", () => {
  it("assisted: все разделы и подписи групп на русском", async () => {
    await renderMenu("assisted");
    for (const label of ["Главная", "Документы", "Оплата", "Входящие", "Университеты", "Профессии", "Английский", "CSCA", "Тесты", "Профиль", "Выбор", "Учёба"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
  it("«Поступления» в меню нет: одна «Главная»", async () => {
    await renderMenu("assisted");
    expect(screen.queryByText("Поступление")).toBeNull();
    expect(screen.queryByTestId("menu-overview")).toBeNull();
  });
  it("«Выйти» внизу меню у обоих уровней (#1360)", async () => {
    const onSignOut = jest.fn();
    await renderMenu("approved", "ru", onSignOut);
    await fireEvent.press(screen.getByTestId("menu-sign-out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Выйти")).toBeTruthy();
  });
  it("«Чыгуу» на кыргызском", async () => {
    await renderMenu("assisted", "ky");
    expect(screen.getByText("Чыгуу")).toBeTruthy();
  });
  it("approved: без Документов, Оплаты и Входящих", async () => {
    await renderMenu("approved");
    expect(screen.getByText("Университеты")).toBeTruthy();
    for (const label of ["Документы", "Оплата", "Входящие"]) expect(screen.queryByText(label)).toBeNull();
  });
  it("кыргызский язык", async () => {
    await renderMenu("assisted", "ky");
    expect(screen.getByText("Башкы бет")).toBeTruthy();
    expect(screen.getByText("Тандоо")).toBeTruthy();
  });
});
