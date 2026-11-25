// Навигатор по заданиям теста на время (веб: `nav.cs-navigator`): у короткого теста сетка, у длинного (пробный тест на 48
// заданий) лента в один ряд с кнопкой «Все задания» вместо семи рядов над каждым заданием; ячейка 44 pt, зона нажатия 48 pt;
// часы перерисовывают экран каждые полсекунды, а навигатор от них не перерисовывается.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, ScrollView } from "react-native";

import {
  GRID_ROWS_SHOWN,
  TestNavigator,
  cellsPerRow,
  navigatorCompact,
  stripOffset,
  type TestNavigatorProps,
} from "@/features/learning/test-runner/TestNavigator";
import { PortalShell, testApi, testClient } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";
import { monoFont } from "@/theme/fonts";

// Номер в ячейке берёт жирный шрифт чисел один раз за отрисовку ячейки (остальные тексты зовут `monoFont()` без веса): по числу
// таких вызовов видно, сколько ячеек перерисовалось.
jest.mock("@/theme/fonts", () => {
  const actual = jest.requireActual<typeof import("@/theme/fonts")>("@/theme/fonts");
  return { ...actual, monoFont: jest.fn(actual.monoFont) };
});
const mono = monoFont as unknown as jest.Mock;
const cellRenders = () => mono.mock.calls.filter(([weight]) => weight === "bold").length;

const attemptOf = (count: number) => ({ items: Array.from({ length: count }, (_, i) => ({ itemKey: `item-${i + 1}` })) }) as unknown as TestNavigatorProps["attempt"];
const PHONE = 358; // ширина рамки на экране 390 pt при полях 16

async function show(overrides: Partial<TestNavigatorProps> = {}, lang: "ru" | "ky" = "ru") {
  const api = testApi(fakeTransport({}).transport);
  const client = testClient();
  const base: TestNavigatorProps = { attempt: attemptOf(48), answers: {}, flags: [], index: 0, disabled: false, onPick: jest.fn() };
  const tree = (props: TestNavigatorProps) => (
    <PortalShell api={api} client={client} lang={lang}>
      <TestNavigator {...props} />
    </PortalShell>
  );
  const props = { ...base, ...overrides };
  const view = await render(tree(props));
  return { props, rerender: (next: Partial<TestNavigatorProps>) => view.rerender(tree({ ...props, ...next })) };
}

const measure = (width: number) => fireEvent(screen.getByTestId("test-navigator"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } } });
const scrollTo = () => ScrollView.prototype.scrollTo as unknown as jest.Mock;

describe("раскладка: сетка или лента", () => {
  it("ячеек в ряду по ширине рамки: 7 на телефоне в 390 pt, 6 на узком, не меньше одной", () => {
    expect(cellsPerRow(PHONE)).toBe(7);
    expect(cellsPerRow(326)).toBe(6);
    expect(cellsPerRow(0)).toBe(1);
  });

  it("лента нужна, когда сетка не помещается в два ряда; пока ширина неизвестна, сетка", () => {
    expect(GRID_ROWS_SHOWN).toBe(2);
    expect(navigatorCompact(3, PHONE)).toBe(false);
    expect(navigatorCompact(14, PHONE)).toBe(false); // два полных ряда
    expect(navigatorCompact(15, PHONE)).toBe(true);
    expect(navigatorCompact(48, PHONE)).toBe(true);
    expect(navigatorCompact(48, 0)).toBe(false);
  });

  it("лента встаёт так, чтобы текущая ячейка была по центру, но не левее начала", () => {
    expect(stripOffset(0, PHONE)).toBe(0);
    expect(stripOffset(2, PHONE)).toBe(0);
    expect(stripOffset(10, PHONE)).toBe(6 + 10 * 52 - (PHONE - 44) / 2);
  });
});

describe("навигатор на экране", () => {
  beforeEach(() => scrollTo().mockClear());

  it("короткий тест: сетка целиком, ни ленты, ни кнопки", async () => {
    await show({ attempt: attemptOf(3) });
    await measure(PHONE);
    expect(screen.getByTestId("nav-grid")).toBeTruthy();
    expect(screen.queryByTestId("nav-strip")).toBeNull();
    expect(screen.queryByTestId("nav-toggle")).toBeNull();
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`nav-${n}`)).toBeTruthy();
  });

  it("пробный тест на 48 заданий: лента в один ряд и «Все задания»; все 48 ячеек остаются в дереве для читалки", async () => {
    await show();
    await measure(PHONE);
    expect(screen.getByTestId("nav-strip")).toBeTruthy();
    expect(screen.queryByTestId("nav-grid")).toBeNull();
    expect(screen.getByTestId("nav-toggle")).toHaveTextContent("Все задания");
    expect(screen.getByTestId("nav-toggle").props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByTestId("nav-1")).toBeTruthy();
    expect(screen.getByTestId("nav-48")).toBeTruthy();
    expect(screen.getByTestId("nav-48").props.accessibilityLabel).toBe("Задание 48, без ответа");
  });

  it("до первого замера ширину берут по окну за вычетом полей экрана", async () => {
    await show();
    const expected = navigatorCompact(48, Dimensions.get("window").width - 32);
    expect(screen.queryByTestId("nav-strip") !== null).toBe(expected);
    expect(screen.queryByTestId("nav-grid") !== null).toBe(!expected);
  });

  it("лента встаёт на текущую ячейку сразу и плавно переходит при смене задания", async () => {
    const view = await show();
    await measure(PHONE);
    expect(scrollTo()).toHaveBeenLastCalledWith({ x: 0, animated: false });
    scrollTo().mockClear();
    await view.rerender({ index: 10 });
    expect(scrollTo()).toHaveBeenLastCalledWith({ x: stripOffset(10, PHONE), animated: true });
    // Ответ и флажок текущего задания ленту не двигают.
    scrollTo().mockClear();
    await view.rerender({ index: 10, answers: { "item-11": "a" }, flags: ["item-11"] });
    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it("когда размер ленты стал известен, она снова встаёт на текущую ячейку: первая прокрутка могла упереться в пустое содержимое", async () => {
    await show({ index: 20 });
    await measure(PHONE);
    scrollTo().mockClear();
    await fireEvent(screen.getByTestId("nav-strip"), "contentSizeChange", 2500, 60);
    expect(scrollTo()).toHaveBeenCalledWith({ x: stripOffset(20, PHONE), animated: false });
  });

  it("«Все задания» раскрывает полную сетку, «Свернуть» возвращает ленту", async () => {
    await show();
    await measure(PHONE);
    await fireEvent.press(screen.getByTestId("nav-toggle"));
    expect(screen.getByTestId("nav-grid")).toBeTruthy();
    expect(screen.queryByTestId("nav-strip")).toBeNull();
    expect(screen.getByTestId("nav-toggle")).toHaveTextContent("Свернуть");
    expect(screen.getByTestId("nav-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(screen.getByTestId("nav-toggle"));
    expect(screen.getByTestId("nav-strip")).toBeTruthy();
    expect(screen.getByTestId("nav-toggle")).toHaveTextContent("Все задания");
  });

  it("выбор ячейки в раскрытой сетке переходит к заданию и сворачивает сетку, чтобы условие было на виду", async () => {
    const { props } = await show();
    await measure(PHONE);
    await fireEvent.press(screen.getByTestId("nav-toggle"));
    await fireEvent.press(screen.getByTestId("nav-30"));
    expect(props.onPick).toHaveBeenCalledWith(29);
    expect(screen.getByTestId("nav-strip")).toBeTruthy();
    expect(screen.queryByTestId("nav-grid")).toBeNull();
  });

  it("выбор ячейки в ленте переходит к заданию, лента остаётся", async () => {
    const { props } = await show();
    await measure(PHONE);
    await fireEvent.press(screen.getByTestId("nav-5"));
    expect(props.onPick).toHaveBeenCalledWith(4);
    expect(screen.getByTestId("nav-strip")).toBeTruthy();
  });

  it("при завершении ячейки недоступны, а раскрыть и свернуть список можно", async () => {
    const { props } = await show({ disabled: true });
    await measure(PHONE);
    expect(screen.getByTestId("nav-1").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId("nav-1"));
    expect(props.onPick).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("nav-toggle"));
    expect(screen.getByTestId("nav-grid")).toBeTruthy();
  });

  it("отвеченное, отмеченное и текущее: подписи со словами, значок флажка, признак текущего", async () => {
    await show({ index: 1, answers: { "item-1": "a", "item-2": "b" }, flags: ["item-2"] });
    await measure(PHONE);
    expect(screen.getByTestId("nav-1").props.accessibilityLabel).toBe("Задание 1, отвечено");
    expect(screen.getByTestId("nav-2").props.accessibilityLabel).toBe("Задание 2, отвечено, вернуться позже");
    expect(screen.getByTestId("nav-2").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId("nav-flag-2", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("nav-flag-1", { includeHiddenElements: true })).toBeNull();
  });

  it("ячейка 44 pt, зона нажатия 48 pt", async () => {
    await show();
    await measure(PHONE);
    const cell = screen.getByTestId("nav-1");
    expect(cell.props.style).toMatchObject({ width: 44, height: 44 });
    expect(cell.props.hitSlop).toBe(2);
  });

  it("на кыргызском: кнопка раскрытия и сворачивания по-кыргызски", async () => {
    await show({}, "ky");
    await measure(PHONE);
    expect(screen.getByTestId("nav-toggle")).toHaveTextContent("Бардык тапшырмалар");
    await fireEvent.press(screen.getByTestId("nav-toggle"));
    expect(screen.getByTestId("nav-toggle")).toHaveTextContent("Жыйыштыруу");
  });
});

describe("перерисовки: часы идут, навигатор стоит", () => {
  it("те же свойства: ни навигатор, ни ячейки не перерисовываются (часы каждые полсекунды)", async () => {
    const view = await show();
    await measure(PHONE);
    mono.mockClear();
    await view.rerender({});
    await view.rerender({});
    expect(mono).not.toHaveBeenCalled(); // не перерисовалось вообще: ни ячейки, ни пояснение
  });

  it("ответ на задание перерисовывает только его ячейку", async () => {
    const view = await show();
    await measure(PHONE);
    mono.mockClear();
    await view.rerender({ answers: { "item-7": "b" } });
    expect(cellRenders()).toBe(1);
    expect(screen.getByTestId("nav-7").props.accessibilityLabel).toBe("Задание 7, отвечено");
  });

  it("переход к другому заданию перерисовывает две ячейки: ушедшую и текущую", async () => {
    const view = await show();
    await measure(PHONE);
    mono.mockClear();
    await view.rerender({ index: 3 });
    expect(cellRenders()).toBe(2);
  });
});
