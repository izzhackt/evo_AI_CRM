// Общая страница (`Screen`): положение прокрутки сообщается только тому экрану, который о нём просит (`onScrollY`, «Главная»:
// «Свернуть» возвращает к карточке пути, только если экран ниже неё). У остальных экранов ScrollView остаётся прежним: без
// обработчика прокрутки и без повышенной частоты событий (иначе каждый экран приложения получал бы событие каждые 16 мс).
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LangProvider } from "@/i18n/LangProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function wrap(ui: ReactElement) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider initial="light">
        <LangProvider initial="ru">{ui}</LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe("Screen: положение прокрутки", () => {
  it("без onScrollY у ScrollView нет обработчика прокрутки и частоты событий", async () => {
    await render(
      wrap(
        <Screen>
          <Text>Содержимое</Text>
        </Screen>,
      ),
    );
    const scroll = screen.getByTestId("screen-scroll");
    expect(scroll.props.onScroll).toBeUndefined();
    expect(scroll.props.scrollEventThrottle).toBeUndefined();
  });

  it("с onScrollY: событие каждые 16 мс, обработчик получает сдвиг по вертикали (в том числе отрицательный)", async () => {
    const seen: number[] = [];
    await render(
      wrap(
        <Screen onScrollY={(y) => seen.push(y)}>
          <Text>Содержимое</Text>
        </Screen>,
      ),
    );
    const scroll = screen.getByTestId("screen-scroll");
    expect(scroll.props.scrollEventThrottle).toBe(16);
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 7, y: 42 } } });
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: -30 } } });
    expect(seen).toEqual([42, -30]);
  });
});
