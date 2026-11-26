// Блок пути на «Главной» (веб #1489, #1512): строка текущего шага, завершённое дело, свёрнутость по умолчанию, шапка с
// фото и без, путь Китая по руководству куратора из общего файла контента.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { selectCountryTimeline, timelineStepProgress } from "@web/lib/portal/country-timeline";

import { JourneySection } from "@/features/admission/JourneySection";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

// Раскрытые шаги и свёрнутость пути помнит приложение: между тестами память чистится.
beforeEach(async () => {
  await AsyncStorage.clear();
});

const view = (country: string, locale: "ru" | "ky" = "ru") => selectCountryTimeline(country, { locale, today: "2026-11-25" })!;
const api = () => testApi(fakeTransport({}).transport);
const plain = { urls: { sized: "https://example.test/sized.jpg", original: "https://example.test/original.jpg" }, credit: { kind: "official" as const, sourceUrl: "https://example.test/source" } };

describe("строка под шапкой", () => {
  it("все шаги пройдены: «Поступление завершено» и вся полоса зелёная", async () => {
    const malaysia = view("MY");
    const done = Object.fromEntries(malaysia.steps.map((step) => [step.id, step.optional ? "optional" : "done"] as const));
    await renderPortal(<JourneySection view={malaysia} progress={done} source="saved" readFailed={false} assisted hero={() => null} />, api());
    expect(within(screen.getByTestId("journey-complete")).getByText("Поступление завершено")).toBeTruthy();
    expect(screen.getAllByTestId("meter-done", { includeHiddenElements: true })).toHaveLength(malaysia.steps.length);
    expect(screen.queryByTestId("journey-now")).toBeNull();
    // «Все шаги» стоят в конце полосы, а не рядом со «Сменить страну»
    expect(within(screen.getByTestId("journey-now-row")).getByTestId("journey-fold")).toBeTruthy();
  });

  it("дело закрыто (`closed`): «Поступление завершено» без полосы и без отметок шагов", async () => {
    const malaysia = view("MY");
    await renderPortal(<JourneySection view={malaysia} progress={timelineStepProgress(malaysia.steps, "closed")} stage="closed" source="saved" readFailed={false} assisted hero={() => null} />, api());
    expect(screen.getByTestId("journey-complete")).toBeTruthy();
    expect(screen.queryByTestId("meter-done", { includeHiddenElements: true })).toBeNull();
    expect(screen.getAllByTestId("journey-fold")).toHaveLength(1);
  });

  it("нет прогресса: строки нет, «Все шаги» стоят в шапке рядом со «Сменить страну»; путь свёрнут", async () => {
    await renderPortal(<JourneySection view={view("MY")} progress={null} source="saved" readFailed={false} assisted={false} hero={() => null} />, api());
    expect(screen.queryByTestId("journey-now-row")).toBeNull();
    const hero = screen.getByTestId("home-hero");
    expect(within(hero).getByTestId("journey-fold")).toBeTruthy();
    expect(within(hero).getByTestId("change-country")).toBeTruthy();
    expect(screen.queryByTestId("journey-body")).toBeNull();
  });

  it("раскрытый путь начинается с пояснения срока набора (в шапке-приветствии ему нет места)", async () => {
    const malaysia = view("MY");
    await renderPortal(<JourneySection view={malaysia} progress={null} source="saved" readFailed={false} assisted={false} hero={() => null} initiallyUnfolded />, api());
    await screen.findByTestId("journey-body");
    if (malaysia.intake.note) expect(screen.getByTestId("journey-intake-note")).toHaveTextContent(malaysia.intake.note);
    else expect(screen.queryByTestId("journey-intake-note")).toBeNull();
  });
});

describe("шапка с фото и без", () => {
  it("с фото шапка получает onPhoto=true и «©»; не загрузилось - onPhoto=false и плашка", async () => {
    const seen: boolean[] = [];
    await renderPortal(
      <JourneySection view={view("MY")} progress={null} source="saved" readFailed={false} assisted={false} photo={plain} hero={(onPhoto) => { seen.push(onPhoto); return null; }} />,
      api(),
    );
    const photo = screen.getByTestId("hero-photo", { includeHiddenElements: true });
    expect(screen.getByTestId("hero-credit")).toBeTruthy();
    expect(seen.at(-1)).toBe(true);
    await fireEvent(photo, "error", { nativeEvent: { error: "x" } }); // копия -> оригинал
    await fireEvent(screen.getByTestId("hero-photo", { includeHiddenElements: true }), "error", { nativeEvent: { error: "x" } }); // оригинал -> плашка
    expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId("hero-credit")).toBeNull();
    expect(seen.at(-1)).toBe(false);
  });

  it("без фото шапка сразу плашка: onPhoto=false", async () => {
    const seen: boolean[] = [];
    await renderPortal(<JourneySection view={view("MY")} progress={null} source="saved" readFailed={false} assisted={false} hero={(onPhoto) => { seen.push(onPhoto); return null; }} />, api());
    expect(seen.every((value) => value === false)).toBe(true);
    expect(screen.queryByTestId("hero-photo", { includeHiddenElements: true })).toBeNull();
  });

  it("сменить страну: подсказка выбора начинается с подписи источника страны", async () => {
    await renderPortal(<JourneySection view={view("MY")} progress={null} source="case" readFailed={false} assisted hero={() => null} />, api());
    expect(screen.queryByText(/Страна из вашего дела/)).toBeNull();
    await fireEvent.press(screen.getByTestId("change-country"));
    expect(screen.getByText("Страна из вашего дела. Путь обновится сразу после выбора.")).toBeTruthy();
  });
});

describe("путь Китая по руководству куратора (веб #1512, contentVersion 4)", () => {
  it("общий файл cn.json версии 4: приложение показывает тот же путь, что веб", () => {
    const china = view("CN");
    expect(china.contentVersion).toBe(4);
    expect(china.steps).toHaveLength(8);
  });

  it.each([
    ["ru", [
      "Начните готовиться к экзаменам уже в октябре.",
      "Стипендия CSC покрывает обучение, общежитие и медицинскую страховку, а также даёт ежемесячную выплату.",
      "Возьмите справку прямо перед подачей заявок, не раньше.",
      "После письма о зачислении подайте на визу X1, обычно в июле или августе.",
      "Паспорт должен действовать ещё не меньше 6 месяцев, в нём нужны минимум 2 чистые страницы. Проверьте тип визы и срок её действия.",
    ]],
    ["ky", [
      "Экзамендерге октябрда эле даярдана баштаңыз.",
      "CSC стипендиясы окуу акысын, жатакананы жана медициналык камсыздандырууну жабат, ошондой эле ай сайын стипендия төлөнөт.",
      "Маалымкатты арыздарды тапшырар алдында гана алыңыз, эртерээк албаңыз.",
    ]],
  ] as const)("%s: новые пункты руководства видны в раскрытых шагах", async (locale, texts) => {
    const china = view("CN", locale);
    await renderPortal(<JourneySection view={china} progress={null} source="saved" readFailed={false} assisted={false} hero={() => null} initiallyUnfolded />, api(), locale);
    await screen.findByTestId("journey-body");
    for (const step of china.steps) await fireEvent.press(screen.getByTestId(`step-toggle-${step.id}`));
    for (const text of texts) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });
});
