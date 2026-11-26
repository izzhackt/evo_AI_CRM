// Карточка задания CSCA (веб: components/portal/csca/ItemCard.tsx): состояния ответа словами и значками, «Без ответа» вместо
// «Неверно» у пропущенного, «Верный ответ: X» только при неверном, варианты и условие для читалки, язык озвучки.
import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, screen, within } from "@testing-library/react-native";

import { parseCscaLessonView, type CscaExplain } from "@web/lib/portal/csca";

import { ItemCard, verdictAnnouncement, type ItemState } from "@/features/learning/csca/ItemCard";
import { MathText } from "@/features/learning/math/MathText";
import { speakMathText } from "@/features/learning/math/speak";
import { formatPortalString, getPortalStrings } from "@/i18n";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const fx = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "../../../test-fixtures/csca", `${name}.json`), "utf8"));
const view = parseCscaLessonView(fx("csca_lesson_m2-exp-log-l1"));
const item = view.lesson.exercises[0];
const explain: CscaExplain = fx("csca_lesson_save_1").explain;

async function show(state: ItemState, lang: "ru" | "ky" = "ru", extra: Partial<Parameters<typeof ItemCard>[0]> = {}) {
  const { transport } = fakeTransport({});
  await renderPortal(<ItemCard item={item} figure={null} state={state} counter="Задание 1 из 4" {...extra} />, testApi(transport), lang);
}

describe("карточка задания: после ответа", () => {
  it("неверный выбор: вердикт сразу под условием, «Верный ответ: B» только здесь, значки у выбранного и верного", async () => {
    await show({ kind: "answered", selected: "a", correct: false, explain });
    expect(screen.getByTestId("verdict")).toHaveTextContent("Неверно · Верный ответ: B");
    expect(screen.getByTestId("option-a-tags")).toHaveTextContent("Ваш ответ");
    expect(screen.getByTestId("option-b-tags")).toHaveTextContent("Верный ответ");
    expect(screen.queryByTestId("option-c-tags")).toBeNull();
    expect(screen.queryByTestId("option-d-tags")).toBeNull();
  });

  it("верный выбор: «Верно» без строки с верным ответом; у варианта обе подписи через точку", async () => {
    await show({ kind: "answered", selected: "b", correct: true, explain });
    expect(screen.getByTestId("verdict")).toHaveTextContent(/^Верно$/u);
    expect(screen.queryByText(/Верный ответ: /)).toBeNull();
    expect(screen.getByTestId("option-b-tags")).toHaveTextContent("Ваш ответ · Верный ответ");
  });

  it("вердикт не живая область: после ответа его читает `announce` экрана, область сказала бы то же второй раз", async () => {
    for (const state of [{ kind: "answered", selected: "a", correct: false, explain }, { kind: "answered", selected: "b", correct: true, explain }, { kind: "answered", selected: null, correct: false, explain }] as const) {
      await show(state);
      expect(screen.getByTestId("verdict").props.accessibilityLiveRegion).toBe("none");
    }
  });

  it("пропущенный вопрос теста: «Без ответа · Верный ответ: B», слов «Неверно» нет", async () => {
    await show({ kind: "answered", selected: null, correct: false, explain });
    const verdict = screen.getByTestId("verdict");
    expect(verdict).toHaveTextContent("Без ответа · Верный ответ: B");
    expect(verdict).not.toHaveTextContent("Неверно");
    // Выбранного нет, подпись «Ваш ответ» не нужна.
    expect(screen.queryByText("Ваш ответ")).toBeNull();
    expect(screen.getByTestId("option-b-tags")).toHaveTextContent("Верный ответ");
  });

  it("разбор каждого варианта на языке студента: RU и KY", async () => {
    await show({ kind: "answered", selected: "a", correct: false, explain }, "ky");
    const kyExplain = explain.options.find((entry) => entry.id === "b")?.explainKy ?? "";
    const ruExplain = explain.options.find((entry) => entry.id === "b")?.explainRu ?? "";
    const row = within(screen.getByTestId("option-b"));
    expect(row.getByLabelText(speakMathText(kyExplain))).toBeTruthy();
    expect(row.queryByLabelText(speakMathText(ruExplain))).toBeNull();
  });

  it("варианты после ответа читаются как «A. слова» английским голосом, не сырым TeX", async () => {
    await show({ kind: "answered", selected: "a", correct: false, explain });
    const row = screen.getByTestId("option-a");
    const spoken = within(row).getByLabelText(new RegExp(`^A\\. `, "u"));
    expect(spoken.props.accessibilityLabel).toBe(`A. ${speakMathText(item.options[0].label)}`);
    expect(spoken.props.accessibilityLanguage).toBe("en");
    expect(spoken.props.accessibilityLabel).not.toMatch(/[$\\]/u);
  });

  it("условие на английском: читается английским голосом; сложность тремя полосками со словами для читалки", async () => {
    await show({ kind: "answered", selected: "a", correct: false, explain });
    expect(screen.getByTestId("item-stem").props.accessibilityLanguage).toBe("en");
    expect(screen.getByTestId("item-difficulty").props.accessibilityLabel).toBe(`Сложность ${item.difficulty} из 3`);
  });
});

describe("вердикт для читалки: весь текст, а не одно слово", () => {
  const ru = getPortalStrings("csca", "ru");
  const ky = getPortalStrings("csca", "ky");

  it("верный ответ: одно слово, без верного варианта", () => {
    expect(verdictAnnouncement("b", true, "b", ru, formatPortalString)).toBe("Верно");
  });

  it("неверный: слово и верный вариант через точку (на экране между ними «·», читалке нужна пауза)", () => {
    expect(verdictAnnouncement("a", false, "b", ru, formatPortalString)).toBe("Неверно. Верный ответ: B");
    expect(verdictAnnouncement("c", false, "d", ru, formatPortalString)).toBe("Неверно. Верный ответ: D");
  });

  it("пропущенный вопрос: «Без ответа. Верный ответ: B», слова «Неверно» нет", () => {
    expect(verdictAnnouncement(null, false, "b", ru, formatPortalString)).toBe("Без ответа. Верный ответ: B");
  });

  it("на кыргызском слова кыргызские", () => {
    expect(verdictAnnouncement("b", true, "b", ky, formatPortalString)).toBe("Туура");
    expect(verdictAnnouncement("a", false, "c", ky, formatPortalString)).toBe("Туура эмес. Туура жооп: C");
  });

  it("то же, что видит глаз: текст вердикта на экране равен тексту для читалки с «·» вместо точки", async () => {
    for (const [selected, correct] of [["a", false], ["b", true], [null, false]] as const) {
      await show({ kind: "answered", selected, correct, explain });
      expect(screen.getByTestId("verdict")).toHaveTextContent(verdictAnnouncement(selected, correct, explain.correctOptionId, ru, formatPortalString).replace(". ", " · "));
    }
  });
});

describe("карточка задания: до ответа и в тесте на время", () => {
  it("до ответа вердикта и разбора нет, выбор нажатием, подпись «A. слова»", async () => {
    const picked: string[] = [];
    await show({ kind: "open", selected: null }, "ru", { onSelect: (id) => picked.push(id) });
    expect(screen.queryByTestId("verdict")).toBeNull();
    const option = screen.getByTestId("option-c");
    expect(option.props.accessibilityLabel).toBe(`C. ${speakMathText(item.options[2].label)}`);
    await fireEvent.press(option);
    expect(picked).toEqual(["c"]);
  });

  it("занятый запрос: варианты не нажимаются", async () => {
    await show({ kind: "open", selected: "a", busy: true });
    expect(screen.getByTestId("option-a").props.accessibilityState).toMatchObject({ checked: true, disabled: true });
  });

  it("тест на время: выбор без вердикта, как у задания до ответа", async () => {
    await show({ kind: "test", selected: "d" });
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("option-d").props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe("текст с формулами для читалки", () => {
  async function render(source: string, lang?: "en") {
    const { transport } = fakeTransport({});
    await renderPortal(<MathText source={source} testID="m" lang={lang} />, testApi(transport));
    return screen.getByTestId("m");
  }

  it("русский текст с формулой: слова формулы, язык не задан (русский голос читает кириллицу)", async () => {
    const node = await render("Найдите $x^2$ при $x = 3$.");
    expect(node.props.accessibilityLabel).toBe("Найдите x squared при x equals 3.");
    expect(node.props.accessibilityLanguage).toBeUndefined();
  });

  it("английское условие: английский голос и у текста с формулой, и у текста без неё", async () => {
    expect((await render("Find $x^2$.", "en")).props.accessibilityLanguage).toBe("en");
  });

  it("английский текст без формулы тоже помечен", async () => {
    expect((await render("Choose the correct option.", "en")).props.accessibilityLanguage).toBe("en");
  });

  it("одна формула без текста (вариант «$6$»): читается словами, язык по хозяину", async () => {
    const node = await render("$\\frac{1}{2}$", "en");
    expect(node.props.accessibilityLabel).toBe("1 over 2,");
    expect(node.props.accessibilityLanguage).toBe("en");
    expect((await render("$\\frac{1}{2}$")).props.accessibilityLanguage).toBeUndefined();
  });
});
