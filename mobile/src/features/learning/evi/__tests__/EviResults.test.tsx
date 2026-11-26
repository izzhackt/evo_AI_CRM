// Три профессии от Эви: карточки с фото, номером красным кружком, названием, строкой «чем занимается» и «почему». Раскладка как у веба:
// лента с прокруткой вбок на телефоне (карточка 78 % ширины, листание с остановкой), три в ряд от 600 pt; вся карточка - одна ссылка.
import { fireEvent, screen } from "@testing-library/react-native";

import type { EviResult } from "@web/lib/portal/evi";

import { EviResults, RESULTS_ROW_MIN_WIDTH } from "@/features/learning/evi/EviResults";
import { PROFESSION_PHOTOS } from "@/features/learning/professions/photos";
import { getPortalStrings } from "@web/lib/portal/i18n";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const keys = ["nurse", "architect", "no-photo-yet"];
const results: EviResult[] = keys.map((cardKey, index) => ({ cardId: `card-${index + 1}`, cardKey, title: `Профессия ${index + 1}`, summary: index === 0 ? "Помогает людям" : null, why: `Причина ${index + 1}` }));
const strings = getPortalStrings("professions", "ru");

async function show(lang: "ru" | "ky" = "ru", onOpen = jest.fn()) {
  const view = await renderPortal(<EviResults results={results} strings={getPortalStrings("professions", lang)} onOpen={onOpen} />, testApi(fakeTransport({}).transport), lang);
  return { view, onOpen };
}
const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } });
const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe("итог Эви: карточки профессий", () => {
  it("заголовок «Твои профессии» и три карточки по порядку; у каждой номер, название, «чем занимается» (если есть) и «почему»; процентов нет", async () => {
    await show();
    expect(screen.getByText(strings["evi.resultsTitle"])).toBeTruthy();
    expect(screen.getByText("Твои профессии").props.accessibilityRole).toBe("header");
    for (const [index, result] of results.entries()) {
      expect(screen.getByTestId(`evi-result-number-${index + 1}`, { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByText(result.title)).toBeTruthy();
      expect(screen.getByText(result.why)).toBeTruthy();
    }
    expect(screen.getByText("Помогает людям")).toBeTruthy();
    expect(screen.queryByText(/%|балл/u)).toBeNull();
  });

  it("фото - по ключу карточки каталога; нет файла - серая подложка 16:9 с номером, без картинки (как в вебе)", async () => {
    await show();
    expect(screen.getByTestId("evi-result-photo-nurse", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("evi-result-photo-architect", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("evi-result-photo-no-photo-yet", { includeHiddenElements: true })).toBeNull();
    expect(PROFESSION_PHOTOS["no-photo-yet"]).toBeUndefined();
    // Подложка и номер на месте и у карточки без фото.
    expect(screen.getByTestId("evi-result-number-3", { includeHiddenElements: true })).toBeTruthy();
    const photo = screen.getByTestId("evi-result-photo-nurse", { includeHiddenElements: true });
    expect(flat(photo.props.style).aspectRatio).toBeCloseTo(16 / 9, 5);
  });

  it("вся карточка - одна ссылка с подписью «номер. название»; нажатие открывает профессию", async () => {
    const { onOpen } = await show();
    const card = screen.getByTestId("evi-result-architect");
    expect(card.props.accessibilityRole).toBe("link");
    expect(card.props.accessibilityLabel).toBe("2. Профессия 2");
    await fireEvent.press(card);
    expect(onOpen).toHaveBeenCalledWith(results[1]);
    // Фото и номер для читалки - украшение: название читается из подписи.
    expect(screen.getByTestId("evi-result-photo-nurse", { includeHiddenElements: true }).props.accessible).toBe(false);
  });

  it("телефон (уже 600 pt): лента с прокруткой вбок от края до края, карточка 78 % ширины, листание с остановкой на карточке", async () => {
    await show();
    await fireEvent(screen.getByTestId("evi-results"), "layout", layout(358));
    const rail = screen.getByTestId("evi-results-rail");
    expect(rail.props.horizontal).toBe(true);
    expect(rail.props.snapToInterval).toBe(Math.round(358 * 0.78) + 12);
    expect(flat(rail.props.style).marginHorizontal).toBe(-16);
    expect(flat(screen.getByTestId("evi-result-nurse").props.style).width).toBe(Math.round(358 * 0.78));
    expect(screen.queryByTestId("evi-results-row")).toBeNull();
  });

  it("шире 600 pt (планшет): три карточки в ряд поровну, без ленты", async () => {
    await show();
    await fireEvent(screen.getByTestId("evi-results"), "layout", layout(RESULTS_ROW_MIN_WIDTH));
    expect(screen.getByTestId("evi-results-row")).toBeTruthy();
    expect(screen.queryByTestId("evi-results-rail")).toBeNull();
    expect(flat(screen.getByTestId("evi-result-nurse").props.style).flex).toBe(1);
    await fireEvent(screen.getByTestId("evi-results"), "layout", layout(RESULTS_ROW_MIN_WIDTH - 1));
    expect(screen.getByTestId("evi-results-rail")).toBeTruthy();
  });

  it("кыргызский словарь: заголовок из общего словаря, не придуманный", async () => {
    await show("ky");
    expect(screen.getByText("Сенин кесиптериң")).toBeTruthy();
  });
});
