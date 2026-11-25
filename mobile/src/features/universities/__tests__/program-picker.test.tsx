// Подбор программ на странице вуза (G40, веб #1447): поиск, четыре поля, «первые 4 + Показать все N», карточки направления и окно
// программы. Экран настоящий, транспорт поддельный.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking, StyleSheet } from "react-native";

import { UniversityScreen } from "@/features/universities/UniversityScreen";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { detailBody, program, twelvePrograms } from "@/test-fixtures/programs";
import { fakeTransport, uuidN } from "@/test-fixtures/universities";

const mockParams: { current: Record<string, string> } = { current: {} };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useNavigation: () => ({ getState: () => ({ routes: [{ name: "index" }] }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));

beforeEach(() => {
  mockParams.current = { id: uuidN(1) };
  (router.push as jest.Mock).mockClear();
});

async function openScreen(programs = twelvePrograms(), lang: "ru" | "ky" = "ru") {
  const t = fakeTransport({ student_university_detail_v1: detailBody(programs), student_university_favorites_v1: [] });
  await renderPortal(<UniversityScreen />, testApi(t.transport), lang);
  await screen.findByText(lang === "ru" ? "Программы вуза" : "Университеттин программалары");
  return t;
}

const cards = () => screen.queryAllByTestId(/^program-(?!found|reset|search|show|filter|cards|empty|dialog|open|add|error|refresh|unavailable)/);

describe("первые четыре и «Показать все»", () => {
  it("без выбора - четыре карточки, число всех программ и кнопка «Показать все 12»", async () => {
    await openScreen();
    expect(cards()).toHaveLength(4);
    expect(screen.getByTestId("program-found").props.children).toBe("12 программ");
    expect(screen.getByTestId("program-show-all")).toBeTruthy();
    expect(within(screen.getByTestId("program-show-all")).getByText("Показать все 12")).toBeTruthy();
    expect(screen.queryByTestId("program-reset")).toBeNull();
    await fireEvent.press(screen.getByTestId("program-show-all"));
    await waitFor(() => expect(cards()).toHaveLength(12));
    expect(screen.queryByTestId("program-show-all")).toBeNull();
  });

  it("меньше четырёх программ: подбора нет, все карточки, кнопки «Показать все» нет", async () => {
    await openScreen([program({ id: "a", title: "Bachelor of Law" }), program({ id: "b", title: "Bachelor of Computer Science" })]);
    expect(screen.queryByTestId("program-filter")).toBeNull();
    expect(cards()).toHaveLength(2);
    expect(screen.queryByTestId("program-show-all")).toBeNull();
  });

  it("карточка: направление, уровень, название, длительность и месяцы; читалке одна кнопка с подсказкой «Подробнее»", async () => {
    await openScreen();
    const card = screen.getByTestId("program-cs-b");
    expect(card.props.accessibilityRole).toBe("button");
    expect(card.props.accessibilityHint).toBe("Подробнее");
    expect(card.props.accessibilityLabel).toBe("Bachelor of Computer Science. Бакалавриат. IT и данные. 3 года. Февраль / сентябрь");
    expect(within(card).getByText("IT и данные")).toBeTruthy();
    expect(within(card).getByText("Бакалавриат")).toBeTruthy();
    expect(within(card).getByText("Bachelor of Computer Science")).toBeTruthy();
    expect(within(card).getByText("3 года")).toBeTruthy();
    expect(within(card).getByText("Февраль / сентябрь")).toBeTruthy();
    expect(within(card).getByText("Подробнее")).toBeTruthy();
  });
});

describe("поиск и поля", () => {
  it("запрос: «Подходит N из M», кнопка «Сбросить фильтр», все подходящие; сброс возвращает первые четыре", async () => {
    await openScreen();
    await fireEvent.changeText(screen.getByTestId("program-search"), "bachelor");
    await waitFor(() => expect(screen.getByTestId("program-found").props.children).toBe("Подходит 7 из 12"));
    expect(cards()).toHaveLength(7);
    expect(screen.queryByTestId("program-show-all")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("program-search"), "computer");
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByTestId("program-found").props.children).toBe("Подходит 1 из 12");
    await fireEvent.press(screen.getByTestId("program-reset"));
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(screen.getByTestId("program-found").props.children).toBe("12 программ");
    expect(screen.getByTestId("program-search").props.value).toBe("");
    expect(screen.queryByTestId("program-reset")).toBeNull();
  });

  it("запрос не длиннее 100 знаков, у поля название для читалки и крестик очистки", async () => {
    await openScreen();
    const field = screen.getByTestId("program-search");
    expect(field.props.maxLength).toBe(100);
    expect(field.props.accessibilityLabel).toBe("Поиск по программам");
    await fireEvent.changeText(field, "law");
    await fireEvent.press(await screen.findByTestId("program-search-clear"));
    expect(screen.getByTestId("program-search").props.value).toBe("");
  });

  it("поле открывает лист: у каждого варианта число программ с учётом остального, вариант без программ недоступен", async () => {
    await openScreen();
    expect(screen.getByTestId("facet-level").props.accessibilityLabel).toBe("Уровень: Все уровни");
    await fireEvent.press(screen.getByTestId("facet-level"));
    expect(within(screen.getByTestId("facet-level-bachelor")).getByText("Бакалавриат (7)")).toBeTruthy();
    expect(within(screen.getByTestId("facet-level-master")).getByText("Магистратура (3)")).toBeTruthy();
    expect(screen.getByTestId("facet-level-any").props.accessibilityState).toEqual({ checked: true, disabled: false });
    await fireEvent.press(screen.getByTestId("facet-level-master"));
    await waitFor(() => expect(screen.getByTestId("program-found").props.children).toBe("Подходит 3 из 12"));
    expect(cards().map((card) => card.props.testID)).toEqual(["program-ai-m", "program-mba", "program-edu-m"]);
    expect(screen.getByTestId("facet-level").props.accessibilityLabel).toBe("Уровень: Магистратура");

    // у «Права» среди магистерских программ ни одной: вариант недоступен и не выбирается
    await fireEvent.press(screen.getByTestId("facet-field"));
    const law = screen.getByTestId("facet-field-law");
    expect(within(law).getByText("Право (0)")).toBeTruthy();
    expect(law.props.accessibilityState).toEqual({ checked: false, disabled: true });
    await fireEvent.press(law);
    expect(screen.getByTestId("program-found").props.children).toBe("Подходит 3 из 12");
    // «Бизнес» один; выбор сужает выдачу и закрывает лист
    await fireEvent.press(screen.getByTestId("facet-field-business"));
    await waitFor(() => expect(screen.getByTestId("program-found").props.children).toBe("Подходит 1 из 12"));
    expect(cards().map((card) => card.props.testID)).toEqual(["program-mba"]);
  });

  it("месяц и длительность: неизвестные программе не мешают; названия месяцев по-русски с заглавной", async () => {
    await openScreen();
    await fireEvent.press(screen.getByTestId("facet-month"));
    expect(within(screen.getByTestId("facet-month-7")).getByText(/^Июль \(\d+\)$/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("facet-month-7"));
    // июль: «Июль 2027» (MBA, Foundation) и программа без известного месяца
    await waitFor(() => expect(screen.getByTestId("program-found").props.children).toBe("Подходит 3 из 12"));
    expect(cards().map((card) => card.props.testID).sort()).toEqual(["program-fdn", "program-mba", "program-unknown-b"]);
  });

  it("ничего не нашлось: сообщение и «Сбросить фильтр»", async () => {
    await openScreen();
    await fireEvent.changeText(screen.getByTestId("program-search"), "zzzz");
    expect(await screen.findByTestId("program-empty")).toBeTruthy();
    expect(within(screen.getByTestId("program-empty")).getByText("Ничего не нашлось")).toBeTruthy();
    expect(cards()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("program-empty-reset"));
    await waitFor(() => expect(cards()).toHaveLength(4));
  });

  it("поле с единственным вариантом не показывается", async () => {
    await openScreen([
      program({ id: "a", title: "Bachelor of Law", duration: "3 года" }),
      program({ id: "b", title: "Bachelor of Computer Science", duration: "3 года" }),
      program({ id: "c", title: "Bachelor of Finance", duration: "3 года" }),
      program({ id: "d", title: "Bachelor of Nursing", duration: "3 года" }),
    ]);
    expect(screen.queryByTestId("facet-level")).toBeNull(); // один уровень
    expect(screen.queryByTestId("facet-duration")).toBeNull(); // одна длительность
    expect(screen.getByTestId("facet-field")).toBeTruthy();
  });

  it("KY: подписи полей, кнопки и счёт из общего словаря", async () => {
    await openScreen(twelvePrograms(), "ky");
    expect(screen.getByTestId("facet-level").props.accessibilityLabel).toBe("Деңгээл: Бардык деңгээлдер");
    expect(within(screen.getByTestId("program-show-all")).getByText("Баарын көрсөтүү (12)")).toBeTruthy();
    expect(screen.getByTestId("program-found").props.children).toBe("12 программа");
  });
});

describe("окно программы", () => {
  it("нажатие по карточке открывает окно: уровень, название, длительность, язык, описание, страница программы, наборы", async () => {
    await openScreen();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    expect(await screen.findByTestId("program-dialog-title")).toBeTruthy();
    const dialog = screen.getByTestId("program-dialog");
    expect(within(dialog).getByText("Bachelor of Computer Science")).toBeTruthy();
    expect(within(dialog).getByText("Описание программы Bachelor of Computer Science.")).toBeTruthy();
    expect(within(dialog).getByText("Язык обучения:")).toBeTruthy();
    expect(within(dialog).getByText("Официальная страница программы")).toBeTruthy();
    expect(within(dialog).getAllByTestId("intake")).toHaveLength(1);
    expect(within(dialog).getByTestId("program-add")).toBeTruthy();
    expect(screen.getByTestId("program-dialog-close").props.accessibilityLabel).toBe("Закрыть");
    await fireEvent.press(screen.getByTestId("program-dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("program-dialog-title")).toBeNull());
  });

  it("кнопка «Назад» (onRequestClose) закрывает окно", async () => {
    await openScreen();
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    await screen.findByTestId("program-dialog-title");
    await fireEvent(screen.getByTestId("program-dialog"), "requestClose");
    await waitFor(() => expect(screen.queryByTestId("program-dialog-title")).toBeNull());
  });
});

describe("ссылки наружу", () => {
  it("цель нажатия не меньше 44 pt, открывает адрес из каталога (G44: прежняя была около 36 pt)", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openScreen();
    const site = screen.getByLabelText("Сайт учебного заведения");
    expect(site.props.accessibilityRole).toBe("link");
    expect(StyleSheet.flatten(site.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(site);
    expect(open).toHaveBeenCalledWith("https://uni.edu.my/");
    await fireEvent.press(screen.getByTestId("program-cs-b"));
    const page = await screen.findByLabelText("Официальная страница программы");
    expect(StyleSheet.flatten(page.props.style).minHeight).toBeGreaterThanOrEqual(44);
    open.mockRestore();
  });
});

describe("длинный список: UTM, 270 программ", () => {
  it("на странице четыре карточки; после «Показать все 270» они собираются порциями, а не одним куском", async () => {
    const many = Array.from({ length: 270 }, (_, i) => program({ id: `p-${i}`, title: `Bachelor of Computer Science ${i + 1}`, intakes: [{ label: "Сентябрь 2027", n: 100 + i }] }));
    await openScreen(many);
    expect(cards()).toHaveLength(4);
    expect(screen.getByTestId("program-found").props.children).toBe("270 программ");
    await fireEvent.press(screen.getByTestId("program-show-all"));
    expect(cards().length).toBeLessThan(270);
    expect(cards().length).toBeGreaterThanOrEqual(24);
    await waitFor(() => expect(cards()).toHaveLength(270), { timeout: 4000 });
  });
});
