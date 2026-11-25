// «©» шапки «Главной»: строка подписи открывает страницу источника, только если адрес безопасен и (у фото мест) хост принадлежит
// названному источнику; иначе это просто текст. Прежде строка открывала `sourceUrl` без проверки.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { HeroCredit } from "@/features/home/HomeHero";
import type { PhotoCreditView } from "@/features/universities/photos";
import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const credit = (sourceUrl: string, sourceName: string | null = "Wikimedia Commons"): PhotoCreditView => ({
  kind: "author",
  author: "Автор Тестов",
  authorUrl: null,
  license: "CC BY 4.0",
  licenseUrl: null,
  sourceUrl,
  sourceName,
});

async function show(value: PhotoCreditView) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial="ru">
          <HeroCredit credit={value} />
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await fireEvent.press(screen.getByTestId("hero-credit"));
  return screen.getByTestId("hero-credit-text");
}

describe("HeroCredit: ссылка на источник", () => {
  it("безопасный адрес источника: строка - ссылка и открывает его", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const line = await show(credit("https://commons.wikimedia.org/wiki/File:Test.jpg"));
    expect(line.props.accessibilityRole).toBe("link");
    await fireEvent.press(line);
    expect(open).toHaveBeenCalledWith("https://commons.wikimedia.org/wiki/File:Test.jpg");
    open.mockRestore();
  });

  it.each([
    ["чужая схема", "javascript:alert(1)", "Wikimedia Commons"],
    ["http вместо https", "http://commons.wikimedia.org/wiki/File:Test.jpg", "Wikimedia Commons"],
    ["логин в адресе", "https://user:pw@commons.wikimedia.org/wiki/File:Test.jpg", "Wikimedia Commons"],
    ["хост не принадлежит названному источнику", "https://evil.example/wiki/File:Test.jpg", "Wikimedia Commons"],
    ["похожий хост", "https://commons.wikimedia.org.evil.example/wiki/File:Test.jpg", "Wikimedia Commons"],
  ])("%s: текст остаётся, ссылки нет и ничего не открывается", async (_name, url, source) => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const line = await show(credit(url, source));
    expect(screen.getByText("Фото: Автор Тестов, Wikimedia Commons, CC BY 4.0")).toBeTruthy();
    expect(line.props.accessibilityRole).toBeUndefined();
    await fireEvent.press(line);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
