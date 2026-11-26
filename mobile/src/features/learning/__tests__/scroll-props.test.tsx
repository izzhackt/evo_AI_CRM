// Страницы «Учёбы» (`StackPage` и `RunnerPage`) сообщают положение прокрутки только экрану, который о нём просит (`onScrollY`, QA 24,
// N2). `StackPage` стоит под многими экранами, и тем, кто положения не просит, `ScrollView` остаётся прежним: ни обработчика
// прокрутки, ни частоты событий (иначе каждый такой экран получал бы события прокрутки в JS каждые 16 мс). Так же проверена общая
// страница `Screen` (`ui/__tests__/Screen.test.tsx`).
import { fireEvent, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { RunnerPage } from "@/features/learning/tests/RunnerPage";
import { StackPage } from "@/features/learning/ui";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

async function render(ui: React.ReactElement) {
  await renderPortal(ui, testApi(fakeTransport({}).transport, { tier: "assisted" }));
}

describe.each([
  ["StackPage", StackPage, "stack"],
  ["RunnerPage", RunnerPage, "runner"],
] as const)("%s: положение прокрутки сообщается только экрану, который о нём просит", (_name, Page, id) => {
  it("без onScrollY у ScrollView нет обработчика прокрутки и частоты событий", async () => {
    await render(
      <Page header={null} testID={id}>
        <Text>x</Text>
      </Page>,
    );
    const scroll = screen.getByTestId(`${id}-scroll`);
    expect(scroll.props.onScroll).toBeUndefined();
    expect(scroll.props.scrollEventThrottle).toBeUndefined();
  });

  it("с onScrollY: событие каждые 16 мс, обработчик получает сдвиг по вертикали (в том числе отрицательный)", async () => {
    const seen: number[] = [];
    await render(
      <Page header={null} testID={id} onScrollY={(y: number) => seen.push(y)}>
        <Text>x</Text>
      </Page>,
    );
    const scroll = screen.getByTestId(`${id}-scroll`);
    expect(scroll.props.scrollEventThrottle).toBe(16);
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 7, y: 42 } } });
    await fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: -30 } } });
    expect(seen).toEqual([42, -30]);
  });
});
