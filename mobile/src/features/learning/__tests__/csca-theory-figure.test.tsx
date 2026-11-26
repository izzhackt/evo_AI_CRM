// Теория урока и рисунки на узком экране: таблица шире экрана прокручивается вбок, а до трёх столбцов лежит поровну (U13
// аудита); подсказка «Рисунок прокручивается вбок» у рисунка шире рамки (веб: FigureFrame.tsx); английское условие примера
// читается английским голосом, объяснения языком устройства. Данные настоящего выпуска контента.
import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, screen } from "@testing-library/react-native";

import { parseCscaLessonView, type CscaTheoryBlock } from "@web/lib/portal/csca";

import { TheoryBlocks } from "@/features/learning/csca/TheoryBlocks";
import { FigureView } from "@/features/learning/figure/FigureView";
import { speakMathText } from "@/features/learning/math/speak";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const CONTENT = path.join(__dirname, "../../../../../docs/design/portal/content/csca/math/lessons");
const lesson = (name: string): { blocks: CscaTheoryBlock[] } => JSON.parse(readFileSync(path.join(CONTENT, name), "utf8"));
const tables = (name: string) => lesson(name).blocks.filter((block) => block.kind === "table");
const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 120 } } });

async function show(ui: React.ReactElement) {
  const { transport } = fakeTransport({});
  await renderPortal(ui, testApi(transport));
}

describe("таблица теории: прокрутка вбок на узком экране (U13)", () => {
  it("пять столбцов («Значения для особых углов») на телефоне в 360 pt: прокручивается вбок, все ячейки на месте", async () => {
    const [table] = tables("t11-trig-basics.json");
    await show(<TheoryBlocks blocks={[table]} figures={{}} />);
    // До замера ширины рамки таблица рисуется по содержимому и уже прокручивается.
    expect(screen.getByTestId("theory-table-0-scroll")).toBeTruthy();
    await fireEvent(screen.getByTestId("theory-table-0-frame"), "layout", layout(296));
    expect(screen.getByTestId("theory-table-0-scroll").props.horizontal).toBe(true);
    expect(screen.getByTestId("theory-table-0-scroll").props.accessibilityLabel).toBe("Значения для особых углов");
    // Шесть строк (заголовок и пять углов), названия столбцов на месте.
    expect(screen.getAllByTestId(/^theory-table-0-row-/)).toHaveLength(6);
    expect(screen.getByText("Градусы")).toBeTruthy();
  });

  it("та же таблица на широком экране (планшет, 900 pt): помещается и не прокручивается", async () => {
    const [table] = tables("t11-trig-basics.json");
    await show(<TheoryBlocks blocks={[table]} figures={{}} />);
    await fireEvent(screen.getByTestId("theory-table-0-frame"), "layout", layout(900));
    expect(screen.queryByTestId("theory-table-0-scroll")).toBeNull();
    expect(screen.getAllByTestId(/^theory-table-0-row-/)).toHaveLength(6);
  });

  it("таблица из двух и трёх столбцов: столбцы поровну, прокрутки нет и на телефоне", async () => {
    const small = lesson("t01-sets.json").blocks.filter((block) => block.kind === "table");
    const narrow = [...small, ...tables("t02-ineq-basics.json")].filter((block) => block.kind === "table" && block.header.length < 4);
    expect(narrow.length).toBeGreaterThan(0);
    await show(<TheoryBlocks blocks={[narrow[0]]} figures={{}} />);
    await fireEvent(screen.getByTestId("theory-table-0-frame"), "layout", layout(296));
    expect(screen.queryByTestId("theory-table-0-scroll")).toBeNull();
  });

  it("на кыргызском: подпись таблицы для читалки на кыргызском", async () => {
    const [table] = tables("t11-trig-basics.json");
    const { transport } = fakeTransport({});
    await renderPortal(<TheoryBlocks blocks={[table]} figures={{}} />, testApi(transport), "ky");
    expect(screen.getByTestId("theory-table-0-scroll").props.accessibilityLabel).toBe("Өзгөчө бурчтардын маанилери");
  });
});

describe("блоки теории: язык озвучки и спойлеры", () => {
  it("английское условие примера читается английским голосом, шаги языком устройства", async () => {
    const example = lesson("t11-trig-basics.json").blocks.find((block) => block.kind === "example");
    if (example?.kind !== "example") throw new Error("в уроке нет примера");
    await show(<TheoryBlocks blocks={[example]} figures={{}} />);
    const stem = screen.getByLabelText(speakMathText(example.stem_en));
    expect(stem.props.accessibilityLanguage).toBe("en");
    await fireEvent.press(screen.getByTestId("theory-example-0-steps-next"));
    const step = screen.getByLabelText(new RegExp(`^Шаг 1\\. `, "u"));
    expect(step.props.accessibilityLanguage).toBeUndefined();
    expect(screen.queryByTestId("theory-example-0-steps-answer")).toBeNull();
  });
});

describe("рисунок с длинной кривой графика", () => {
  const FIGURES = path.join(CONTENT, "../figures");

  it("«func-graphs-reflect» (кривые по 4690-5024 знака) рисуется, а не заменяется подписью", async () => {
    const svg = readFileSync(path.join(FIGURES, "func-graphs-reflect.svg"), "utf8");
    const figure = { svg, viewBox: "0 0 400 300", width: 400, height: 300, altRu: "График корня и его отражений", altKy: "Тамырдын графиги", altEn: "Graph of the root" };
    await show(<FigureView figure={figure} testID="fig" />);
    await fireEvent(screen.getByTestId("fig"), "layout", layout(320));
    expect(await screen.findByRole("imagebutton")).toBeTruthy();
    expect(screen.queryByText("График корня и его отражений")).toBeNull();
  });
});

describe("рисунок: подсказка о прокрутке", () => {
  const view = parseCscaLessonView(fx("csca_lesson_m2-exp-log-l1"));
  const figure = view.figures["exp-base"];

  it("рисунок шире рамки: под ним «Рисунок прокручивается вбок»", async () => {
    await show(<FigureView figure={figure} testID="fig" />);
    await fireEvent(screen.getByTestId("fig"), "layout", layout(120));
    expect(await screen.findByTestId("figure-scroll-hint")).toHaveTextContent("Рисунок прокручивается вбок");
    expect(screen.getByTestId("fig-scroll").props.showsHorizontalScrollIndicator).toBe(true);
  });

  it("рисунок помещается в рамку: подсказки нет, указатель прокрутки скрыт", async () => {
    await show(<FigureView figure={figure} testID="fig" />);
    await fireEvent(screen.getByTestId("fig"), "layout", layout(2000));
    expect(screen.queryByTestId("figure-scroll-hint")).toBeNull();
    expect(screen.getByTestId("fig-scroll").props.showsHorizontalScrollIndicator).toBe(false);
  });

  it("подсказка на кыргызском", async () => {
    const { transport } = fakeTransport({});
    await renderPortal(<FigureView figure={figure} testID="fig" />, testApi(transport), "ky");
    await fireEvent(screen.getByTestId("fig"), "layout", layout(120));
    expect(await screen.findByTestId("figure-scroll-hint")).toHaveTextContent("Сүрөттү капталга жылдырса болот");
  });
});
