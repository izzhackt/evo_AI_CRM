import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AccessibilityInfo } from "react-native";
import { documentGuideSamples, documentGuideView } from "@web/lib/portal/document-guides";

import type { DocumentsIo } from "@/features/documents/io";
import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import { DOCUMENT_SAMPLE_SVG } from "@/features/documents/document-samples.generated";
import { decodeSvgText } from "@/features/documents/GuideScheme";
import { PAGE_SHADOW } from "@/features/documents/GuideImages";
import { pageAspect } from "@/features/documents/guide-model";
import { fitContain } from "@/features/documents/zoom-math";
import { getPortalStrings } from "@/i18n";
import { CASE_FILE_ROW, CASE_ID, DOCUMENT_ROW_CORRECTION, DOCUMENT_ROW_EMPTY, FILE_ID, SLOT_ID } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("@/features/documents/native", () => ({
  pickFromFiles: jest.fn(),
  pickFromPhotos: jest.fn(),
  pickFromCamera: jest.fn(),
  createUploadSend: jest.fn(),
  createDownloadDeps: jest.fn(),
  openLocalFile: jest.fn(),
}));

const navigate = router.navigate as jest.Mock;
const BASE = "https://portal.example.test";
const SAMPLES = `${BASE}/portal/document-samples`;
const CASE_B = "99999999-9999-4999-8999-999999999999";
const ru = getPortalStrings("admission", "ru");
const ky = getPortalStrings("admission", "ky");
const slot = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;
const S_PASSPORT = SLOT_ID;
const S_ATTESTAT = slot(61);
const S_IELTS = slot(62);
const S_HSK = slot(63);
const S_BOTH = slot(64);
const S_TOEFL = slot(65);
const S_MEDICAL = slot(66);
const S_PHOTO = slot(67);
const S_FORM = slot(68);
const S_OWN = slot(69);
const S_APPROVED = slot(70);
const S_MEDICAL_B = slot(71);

const row = (id: string, label: string, over: Record<string, unknown> = {}) => ({ ...DOCUMENT_ROW_EMPTY, document_slot_id: id, requirement_key: null, requirement_label: label, ...over });
const ATTESTAT = row(S_ATTESTAT, "Аттестат", { requirement_key: "attestat" });
const IELTS = row(S_IELTS, "Сертификат IELTS");
const HSK = row(S_HSK, "Сертификат HSK");
const BOTH = row(S_BOTH, "Сертификат по языку (HSK, IELTS или TOEFL)");
const TOEFL = row(S_TOEFL, "TOEFL");
const MEDICAL = row(S_MEDICAL, "Медицинская справка");
const PHOTO = row(S_PHOTO, "Фото");
const FORM = row(S_FORM, "Анкета");
const OWN = row(S_OWN, "Особый пункт куратора", { instructions: "Принесите оригинал" });
const APPROVED_PASSPORT = { ...DOCUMENT_ROW_CORRECTION, document_slot_id: S_APPROVED, slot_status: "approved", review_decision: "approved", rework_reason: null, instructions: null, deadline: null };

const directions = (...pairs: [string, string | null][]) => pairs.map(([caseId, direction]) => ({ student_case_id: caseId, direction }));
const choice = (country: string) => ({ country, source: "saved", savedAt: "2026-11-01T08:00:00+00:00" });
const PDF = { status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };

type Fetched = { url: string; headers: Record<string, string> };
function makeIo(over: Partial<DocumentsIo> = {}) {
  const opened: { uri: string; mime: string }[] = [];
  const fetched: Fetched[] = [];
  let respond: () => unknown = () => PDF;
  const io: DocumentsIo = {
    pick: jest.fn(),
    createUploadSend: jest.fn(),
    createDownloadDeps: () => ({
      baseUrl: BASE,
      getToken: async () => "t",
      fetchImpl: async (url, init) => {
        fetched.push({ url, headers: init.headers });
        return (await respond()) as Awaited<ReturnType<ReturnType<DocumentsIo["createDownloadDeps"]>["fetchImpl"]>>;
      },
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string, mime: string) => void opened.push({ uri, mime })),
    ...over,
  };
  return { io, opened, fetched, respondWith: (next: () => unknown) => void (respond = next) };
}

async function renderDocs(rows: unknown[], extra: Record<string, unknown> = {}, files: unknown[] = [], lang: "ru" | "ky" = "ru") {
  const { transport, calls } = fakeTransport({ student_portal_documents: rows, student_portal_case_files_v1: files, ...extra });
  const io = makeIo();
  const view = await renderPortal(<DocumentsScreen io={io.io} />, testApi(transport), lang);
  return { ...io, calls, ...view };
}
const openGuide = async (id: string) => fireEvent.press(await screen.findByTestId(`guide-${id}-open`));
const uriOf = (testID: string): string => (screen.getByTestId(testID).props.source as { uri: string }[])[0]!.uri;
const placeholderOf = (testID: string): string => (screen.getByTestId(testID).props.placeholder as { uri: string }[])[0]!.uri;
const failImage = async (testID: string) => fireEvent(screen.getByTestId(testID), "error", { nativeEvent: { error: "offline" } });
/** Касание рамки просмотра: точки относительно рамки (`locationX/Y`), время в мс. */
const touch = (x: number, y: number) => ({ locationX: x, locationY: y });
async function drag(testID: string, from: [number, number], to: [number, number], at = 1000, duration = 120) {
  const zoom = screen.getByTestId(testID);
  await fireEvent(zoom, "responderGrant", { nativeEvent: { touches: [touch(...from)], timestamp: at } });
  await fireEvent(zoom, "responderMove", { nativeEvent: { touches: [touch(...to)], timestamp: at + duration / 2 } });
  await fireEvent(zoom, "responderRelease", { nativeEvent: { touches: [], timestamp: at + duration } });
}
async function tap(testID: string, at: [number, number], time: number) {
  const zoom = screen.getByTestId(testID);
  await fireEvent(zoom, "responderGrant", { nativeEvent: { touches: [touch(...at)], timestamp: time } });
  await fireEvent(zoom, "responderRelease", { nativeEvent: { touches: [], timestamp: time + 40 } });
}

beforeEach(() => {
  navigate.mockClear();
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
});

describe("Пример: рисунки схем", () => {
  it("у каждой схемы каталога веба есть SVG в приложении, и он совпадает с файлом веба (запасной вид без сети)", () => {
    const samples = documentGuideSamples();
    expect(samples.length).toBeGreaterThan(10);
    for (const sample of samples) {
      const name = sample.sampleSrc.split("/").pop() as string;
      expect(DOCUMENT_SAMPLE_SVG[name]).toBeDefined();
      const original = readFileSync(path.resolve(__dirname, "../../../../../public/portal/document-samples", name), "utf8").trim();
      expect(DOCUMENT_SAMPLE_SVG[name]).toBe(original);
      // вымышленный образец: подпись на самом рисунке
      expect(original).toMatch(/ОБРАЗЕЦ|Вымышленн|Diagram only|SAMPLE/i);
    }
  });

  it("decodeSvgText раскодирует сущности в тексте; «<» не остаётся сырым", () => {
    const out = decodeSvgText('<text>P&lt;KGZ&lt;&lt; &amp; A</text><text fill="#fff">x</text>');
    expect(out).toBe('<text>P＜KGZ＜＜ & A</text><text fill="#fff">x</text>');
    for (const xml of Object.values(DOCUMENT_SAMPLE_SVG)) expect(decodeSvgText(xml)).not.toMatch(/&(lt|gt|amp|quot|apos);/);
  });
});

describe("Пример: подбор по названию пункта (общий documentGuideView веба)", () => {
  const sets = (label: string, country: string | null) => documentGuideView({ requirementKey: null, label }, "ru", country)?.sampleSets.map((set) => set.id);

  it("«Сертификат IELTS» - только IELTS, «Сертификат HSK» - только HSK (и для Малайзии: пункт назван прямо), список тестов - вкладки каждого", () => {
    expect(sets("Сертификат IELTS", "CN")).toEqual(["ielts"]);
    expect(sets("Сертификат HSK", "CN")).toEqual(["hsk"]);
    expect(sets("Сертификат HSK", "MY")).toEqual(["hsk"]);
    expect(sets("Сертификат по языку (HSK, IELTS или TOEFL)", "CN")).toEqual(["ielts", "hsk"]);
    expect(sets("Сертификат по языку (HSK, IELTS или TOEFL)", null)).toEqual(["ielts", "hsk"]);
    expect(sets("Сертификат по языку (IELTS, TOEFL), если есть", "CN")).toEqual(["ielts"]);
    expect(sets("TOEFL", "CN")).toEqual([]);
    // без названия теста - по стране дела
    expect(sets("Сертификат о знании языка", "CN")).toEqual(["ielts", "hsk"]);
    expect(sets("Сертификат о знании языка", "MY")).toEqual(["ielts"]);
  });

  it("бланк и пример заполнения медсправки - только у Китая", () => {
    expect(sets("Медицинская справка", "CN")).toEqual(["medical-blank", "medical-filled"]);
    expect(sets("Медицинская справка", "MY")).toEqual([]);
    expect(sets("Медицинская справка", null)).toEqual([]);
  });
});

describe("Пример: кнопка в «Документах»", () => {
  it("вместо значка «!» - подпись «Пример», доступное имя «Пример: {название}»; у своего пункта куратора кнопки нет, его инструкция остаётся", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY, OWN]);
    const button = await screen.findByTestId(`guide-${S_PASSPORT}-open`);
    expect(button).toHaveTextContent("Пример");
    expect(button.props.accessibilityLabel).toBe("Пример: Загранпаспорт");
    expect(button.props.accessibilityRole).toBe("button");
    expect(screen.queryByTestId(`guide-${S_OWN}-open`)).toBeNull();
    expect(screen.getByText("Принесите оригинал")).toBeTruthy();
    // прежнее имя и значок убраны
    expect(screen.queryByLabelText(/Что это за документ/)).toBeNull();
  });

  it("кыргызский: «Үлгү» и «Үлгү: {название}»", async () => {
    await renderDocs([row(S_HSK, "Сертификат HSK")], {}, [], "ky");
    const button = await screen.findByTestId(`guide-${S_HSK}-open`);
    expect(button).toHaveTextContent("Үлгү");
    expect(button.props.accessibilityLabel).toBe("Үлгү: Сертификат HSK");
  });

  it("статус и «Пример» стоят одной строкой под названием; цель нажатия не меньше 44 pt", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    const button = await screen.findByTestId(`guide-${S_PASSPORT}-open`);
    expect(screen.getByTestId(`status-${S_PASSPORT}`)).toBeTruthy();
    const style = Object.assign({}, ...[button.props.style].flat(2).filter(Boolean));
    const slop = button.props.hitSlop as { top: number; bottom: number };
    expect(style.minHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });
});

describe("Пример: лист показывает только пример", () => {
  it("паспорт: заголовок, статус, настоящая страница; нет описания, «Где взять», формата, ошибок и «Мои программы»", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-sheet`)).toBeNull();
    await openGuide(S_PASSPORT);
    const sheet = await screen.findByTestId(`guide-${S_PASSPORT}-sheet`);
    expect(within(sheet).getByText("Загранпаспорт")).toBeTruthy();
    expect(within(sheet).getByText("Пример")).toBeTruthy();
    expect(uriOf(`guide-${S_PASSPORT}-hero-image`)).toBe(`${SAMPLES}/passport-1.jpg`);
    expect(screen.getByTestId(`guide-${S_PASSPORT}-caption`)).toHaveTextContent("Страница с данными");
    // советов нет
    expect(screen.queryByText(/Разворот с фото и данными/)).toBeNull();
    expect(screen.queryByText("Где взять")).toBeNull();
    expect(screen.queryByText(/PDF, JPG или PNG · до 25 МБ/)).toBeNull();
    expect(screen.queryByText(/Не загружайте только обложку/)).toBeNull();
    expect(screen.queryByText(/Требования конкретного вуза/)).toBeNull();
    expect(screen.queryByText("Мои программы")).toBeNull();
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-programs`)).toBeNull();
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-description`)).toBeNull();
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-mistakes`)).toBeNull();
    // одна страница одного набора: ни вкладок, ни ряда миниатюр, заголовок «Пример»
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-tabs`)).toBeNull();
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-pages`)).toBeNull();
    // действия: загрузить и спросить куратора
    expect(screen.getByTestId(`guide-upload-${S_PASSPORT}`)).toBeTruthy();
    expect(screen.getByTestId(`guide-${S_PASSPORT}-ask`)).toBeTruthy();
  });

  it("страница встаёт в рамку по пропорциям файла (manifest), листом с тенью и скруглением, ещё до загрузки", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    await openGuide(S_PASSPORT);
    await screen.findByTestId(`guide-${S_PASSPORT}-sheet`);
    const image = screen.getByTestId(`guide-${S_PASSPORT}-hero-image`);
    const style = Object.assign({}, ...[image.props.style].flat(2).filter(Boolean));
    const aspect = pageAspect("/portal/document-samples/passport-1.jpg")!;
    expect(aspect).toBeCloseTo(1300 / 926, 6);
    // окно теста 750 pt: «телефон» (< 768): стол 280 pt с полями 12, лист 640 - 32 = 608 pt без полей 2 * 12
    const expected = fitContain(aspect, { width: 608 - 24, height: 280 - 24 });
    expect(style.width).toBeCloseTo(expected.width, 6);
    expect(style.height).toBeCloseTo(expected.height, 6);
    expect(style.borderRadius).toBe(3);
    const frame = Object.assign({}, ...[image.parent!.props.style].flat(2).filter(Boolean));
    expect(frame.boxShadow).toBe(PAGE_SHADOW);
    expect([frame.width, frame.height]).toEqual([style.width, style.height]);
  });

  it("образцы берутся по адресу портала без входа, а не из сборки: страница крупно, миниатюра как заставка", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    await openGuide(S_PASSPORT);
    await screen.findByTestId(`guide-${S_PASSPORT}-sheet`);
    const hero = screen.getByTestId(`guide-${S_PASSPORT}-hero-image`);
    expect(uriOf(`guide-${S_PASSPORT}-hero-image`)).toBe("https://portal.example.test/portal/document-samples/passport-1.jpg");
    expect(placeholderOf(`guide-${S_PASSPORT}-hero-image`)).toBe("https://portal.example.test/portal/document-samples/passport-1-t.jpg");
    expect(hero.props.cachePolicy).toBe("disk");
    expect(JSON.stringify(hero.props.source)).not.toMatch(/Authorization|Bearer|token/i);
  });

  it("«Спросить куратора» закрывает лист и ведёт в чат", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    jest.useFakeTimers();
    try {
      await fireEvent.press(await screen.findByTestId(`guide-${S_PASSPORT}-open`));
      await fireEvent.press(await screen.findByTestId(`guide-${S_PASSPORT}-ask`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(navigate).toHaveBeenCalledWith("/messages/chat");
      expect(screen.queryByTestId(`guide-${S_PASSPORT}-sheet`)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("закрывается кнопкой «Закрыть»", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    await openGuide(S_PASSPORT);
    await fireEvent.press(await screen.findByTestId(`guide-${S_PASSPORT}-close`));
    await waitFor(() => expect(screen.queryByTestId(`guide-${S_PASSPORT}-sheet`)).toBeNull());
  });

  it("действие в листе: у непринятого «Загрузить» открывает выбор файла, у принятого «Скачать» скачивает", async () => {
    const { opened } = await renderDocs([DOCUMENT_ROW_EMPTY, APPROVED_PASSPORT]);
    jest.useFakeTimers();
    try {
      await fireEvent.press(await screen.findByTestId(`guide-${S_PASSPORT}-open`));
      await fireEvent.press(await screen.findByTestId(`guide-upload-${S_PASSPORT}`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(await screen.findByTestId("source-sheet")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("pick-cancel"));
      await fireEvent.press(await screen.findByTestId(`guide-${S_APPROVED}-open`));
      expect(screen.queryByTestId(`guide-upload-${S_APPROVED}`)).toBeNull();
      await fireEvent.press(await screen.findByTestId(`guide-download-${S_APPROVED}`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(opened).toHaveLength(1));
  });
});

describe("Пример: наборы, страницы и крупный просмотр", () => {
  const id = `guide-${S_ATTESTAT}`;

  it("аттестат: три вкладки набора, ряд из семи миниатюр `-t.jpg`, страница крупно с подписью и счётчиком", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await screen.findByTestId(`${id}-sheet`);
    expect(screen.getByTestId(`${id}-tabs`).props.accessibilityRole).toBe("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.props.accessibilityState)).toEqual([{ selected: true }, { selected: false }, { selected: false }]);
    expect(screen.getByRole("tab", { name: "Аттестат", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Диплом колледжа" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Табель" })).toBeTruthy();
    expect(within(screen.getByTestId(`${id}-sheet`)).getByText("Примеры")).toBeTruthy();
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Оригинал · 1 из 7");
    for (let index = 0; index < 7; index += 1) expect(uriOf(`${id}-thumb-${index}`)).toBe(`${SAMPLES}/attestat-${index + 1}-t.jpg`);
    // страница ряда: подпись, номер из общего и «выбрано»
    const second = screen.getByTestId(`${id}-page-1`);
    expect(second.props.accessibilityLabel).toBe("Оценки, 2 из 7");
    expect(screen.getByTestId(`${id}-page-0`).props.accessibilityState).toEqual({ selected: true });
    expect(second.props.accessibilityState).toEqual({ selected: false });
  });

  it("страница ряда меняет крупную страницу, подпись и счётчик; вкладка набора начинает с первой страницы", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await screen.findByTestId(`${id}-sheet`);
    await fireEvent.press(screen.getByTestId(`${id}-page-2`));
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Оценки на кыргызском · 3 из 7");
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/attestat-3.jpg`);
    expect(screen.getByTestId(`${id}-page-2`).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId(`${id}-tab-diploma`));
    expect(screen.getByRole("tab", { name: "Диплом колледжа", selected: true })).toBeTruthy();
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Оригинал · 1 из 5");
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/diploma-1.jpg`);
    expect(screen.queryByTestId(`${id}-page-5`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${id}-tab-grades`));
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/grades-1.jpg`);
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Табель, если ещё учитесь · 1 из 3");
  });

  it("крупный просмотр: карточка поверх листа, полный файл, «‹ ›» между страницами набора, озвучивание, возврат в лист на той же странице", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    // лист остаётся открытым под карточкой (как в вебе), но читалке не виден
    const layer = screen.getByTestId(`${id}-layer`, { includeHiddenElements: true });
    expect(layer.props.accessibilityElementsHidden).toBe(true);
    expect(layer.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.getByTestId(`${id}-sheet`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(`${id}-sheet`)).toBeNull();
    // заголовок окна «Пример: {документ}» читается первым; на экране его нет, как в вебе (sr-only)
    expect(screen.getByRole("header", { name: "Пример: Аттестат" })).toBeTruthy();
    expect(screen.queryByText("Пример: Аттестат")).toBeNull();
    const zoom = screen.getByTestId(`${id}-lightbox-zoom`);
    expect(zoom.props.accessibilityRole).toBe("image");
    expect(zoom.props.accessibilityLabel).toBe("Аттестат: Оригинал");
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    expect(screen.getByTestId(`${id}-lightbox-caption`).props.accessibilityLabel).toBe("Оригинал, 1 из 7");
    // на первой странице «назад» выключено, на последней выключено «вперёд»
    expect(screen.getByTestId(`${id}-pager-prev`)).toBeDisabled();
    expect(screen.getByTestId(`${id}-pager-next`)).not.toBeDisabled();
    // нажатие на выключенную кнопку страницу не меняет
    await fireEvent.press(screen.getByTestId(`${id}-pager-prev`));
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    expect(screen.getByTestId(`${id}-pager-prev`).props.accessibilityLabel).toBe(ru.guidePagePrev);
    expect(screen.getByTestId(`${id}-pager-next`).props.accessibilityLabel).toBe(ru.guidePageNext);
    await fireEvent.press(screen.getByTestId(`${id}-pager-next`));
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-2.jpg`);
    expect(screen.getByTestId(`${id}-lightbox-caption`).props.accessibilityLabel).toBe("Оценки, 2 из 7");
    expect(screen.getByTestId(`${id}-pager-prev`)).not.toBeDisabled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("Оценки, 2 из 7");
    for (let index = 0; index < 5; index += 1) await fireEvent.press(screen.getByTestId(`${id}-pager-next`));
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-7.jpg`);
    expect(screen.getByTestId(`${id}-pager-next`)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`${id}-pager-next`));
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-7.jpg`);
    await fireEvent.press(screen.getByTestId(`${id}-pager-prev`));
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-6.jpg`);
    // закрыть просмотр: лист на той же странице, снова виден читалке
    await fireEvent.press(screen.getByTestId(`${id}-lightbox-close`));
    expect(await screen.findByTestId(`${id}-sheet`)).toBeTruthy();
    expect(screen.queryByTestId(`${id}-lightbox`)).toBeNull();
    expect(screen.getByTestId(`${id}-layer`).props.accessibilityElementsHidden).toBe(false);
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Заверка нотариуса · 6 из 7");
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/attestat-6.jpg`);
  });

  it("жесты в просмотре: палец влево листает вперёд, вправо - назад, на краях и по вертикали страница остаётся", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    const zoom = `${id}-lightbox-zoom`;
    // на первой странице движение вправо - «назад» некуда
    await drag(zoom, [200, 300], [330, 300]);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // вертикальное движение не листает
    await drag(zoom, [200, 100], [210, 330]);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // короткий сдвиг не листает
    await drag(zoom, [200, 300], [180, 300], 2000, 600);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // влево - следующая, подпись и озвучивание те же, что у кнопок
    await drag(zoom, [330, 300], [190, 300], 3000);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-2.jpg`);
    expect(screen.getByTestId(`${id}-lightbox-caption`).props.accessibilityLabel).toBe("Оценки, 2 из 7");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith("Оценки, 2 из 7");
    // вправо - назад
    await drag(zoom, [190, 300], [340, 300], 4000);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
  });

  it("двойное касание приближает страницу, а не листает; рамка принимает касания и не отдаёт их выше", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    const zoom = screen.getByTestId(`${id}-lightbox-zoom`);
    expect(zoom.props.onStartShouldSetResponder()).toBe(true);
    expect(zoom.props.onMoveShouldSetResponder()).toBe(true);
    expect(zoom.props.onResponderTerminationRequest()).toBe(false);
    await tap(`${id}-lightbox-zoom`, [300, 200], 5000);
    await tap(`${id}-lightbox-zoom`, [302, 201], 5120);
    expect(uriOf(`${id}-lightbox-image`)).toBe(`${SAMPLES}/attestat-1.jpg`);
    // жест отобрали системой: просмотр цел
    await fireEvent(zoom, "responderGrant", { nativeEvent: { touches: [touch(100, 100), touch(200, 100)], timestamp: 6000 } });
    await fireEvent(zoom, "responderMove", { nativeEvent: { touches: [touch(50, 100), touch(250, 100)], timestamp: 6050 } });
    await fireEvent(zoom, "responderTerminate", { nativeEvent: { touches: [], timestamp: 6100 } });
    expect(screen.getByTestId(`${id}-lightbox`)).toBeTruthy();
  });

  it("просмотр закрывается затемнением и кнопкой «Назад» Android; сначала он, потом лист", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    // затемнение вокруг карточки
    await fireEvent.press(screen.getByTestId(`${id}-overlay-scrim`));
    await waitFor(() => expect(screen.queryByTestId(`${id}-lightbox`)).toBeNull());
    expect(screen.getByTestId(`${id}-sheet`)).toBeTruthy();
    // «Назад» при открытом просмотре закрывает просмотр, не лист
    await fireEvent.press(screen.getByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    await fireEvent(screen.getByTestId(`${id}-modal`, { includeHiddenElements: true }), "requestClose");
    await waitFor(() => expect(screen.queryByTestId(`${id}-lightbox`)).toBeNull());
    expect(screen.getByTestId(`${id}-sheet`)).toBeTruthy();
    // второе «Назад» закрывает лист
    await fireEvent(screen.getByTestId(`${id}-modal`, { includeHiddenElements: true }), "requestClose");
    await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
  });

  it("читалка: после закрытия просмотра фокус возвращается на страницу, после закрытия листа - на «Пример»", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    jest.useFakeTimers();
    try {
      (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
      await fireEvent.press(screen.getByTestId(`${id}-lightbox-close`));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      const afterLightbox = (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mock.calls;
      expect(afterLightbox).toHaveLength(1);
      expect(afterLightbox[0]![1]).toBe("focus");
      await fireEvent.press(await screen.findByTestId(`${id}-close`));
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect((AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mock.calls).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("просмотр одной страницы без «‹ ›»; фокус читалки уходит на заголовок окна", async () => {
    await renderDocs([DOCUMENT_ROW_EMPTY]);
    await openGuide(S_PASSPORT);
    await fireEvent.press(await screen.findByTestId(`guide-${S_PASSPORT}-sample-open`));
    await screen.findByTestId(`guide-${S_PASSPORT}-lightbox`);
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-pager-prev`)).toBeNull();
    expect(screen.queryByTestId(`guide-${S_PASSPORT}-pager-next`)).toBeNull();
    expect(screen.getByTestId(`guide-${S_PASSPORT}-lightbox-caption`).props.accessibilityLabel).toBe("Страница с данными");
    await waitFor(() => expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus"));
  });

  it("в листе и просмотре нет `accessibilityViewIsModal` внутри Modal: он ломал дерево доступности после закрытия (#1488)", async () => {
    await renderDocs([ATTESTAT]);
    await openGuide(S_ATTESTAT);
    expect((await screen.findByTestId(`${id}-sheet`)).props.accessibilityViewIsModal).toBeUndefined();
    await fireEvent.press(screen.getByTestId(`${id}-sample-open`));
    expect((await screen.findByTestId(`${id}-lightbox`)).props.accessibilityViewIsModal).toBeUndefined();
    // и ни в одном файле экрана «Документы» (комментарии не в счёт)
    const dir = path.resolve(__dirname, "..");
    const files = readdirSync(dir).filter((name) => name.endsWith(".tsx"));
    expect(files).toEqual(expect.arrayContaining(["DocumentGuide.tsx", "GuideSamples.tsx", "GuideLightbox.tsx", "ZoomableScan.tsx", "GuidePhotoRules.tsx", "SourceSheet.tsx"]));
    for (const name of files) {
      const code = readFileSync(path.join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect([name, code.includes("accessibilityViewIsModal")]).toEqual([name, false]);
    }
  });
});

describe("Пример: нарисованная схема вместо образца", () => {
  it("у документа без настоящих образцов (анкета, TOEFL) - схема с метками и легендой, без картинок и вкладок", async () => {
    await renderDocs([FORM, TOEFL]);
    for (const slotId of [S_FORM, S_TOEFL]) {
      await openGuide(slotId);
      await screen.findByTestId(`guide-${slotId}-sheet`);
      expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId("guide-legend")).toBeTruthy();
      expect(screen.queryByTestId(`guide-${slotId}-hero-image`)).toBeNull();
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getByTestId(`guide-${slotId}-sample-open`).props.accessibilityLabel).toBe("Открыть пример целиком");
      await fireEvent.press(screen.getByTestId(`guide-${slotId}-close`));
      await waitFor(() => expect(screen.queryByTestId(`guide-${slotId}-sheet`)).toBeNull());
    }
  });

  it("схема открывается крупно в той же карточке и закрывается обратно в лист", async () => {
    await renderDocs([FORM]);
    await openGuide(S_FORM);
    await fireEvent.press(await screen.findByTestId(`guide-${S_FORM}-sample-open`));
    const box = await screen.findByTestId(`guide-${S_FORM}-lightbox`);
    expect(screen.getByRole("header", { name: "Пример: Анкета" })).toBeTruthy();
    expect(within(box).getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    expect(within(box).getByTestId("guide-legend")).toBeTruthy();
    expect(screen.queryByTestId(`guide-${S_FORM}-pager-next`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`guide-${S_FORM}-lightbox-close`));
    expect(await screen.findByTestId(`guide-${S_FORM}-sheet`)).toBeTruthy();
  });

  it("не загрузилась страница (нет сети): вместо образцов схема, без вкладок и ряда; следующее открытие пробует картинки снова", async () => {
    await renderDocs([ATTESTAT]);
    const id = `guide-${S_ATTESTAT}`;
    await openGuide(S_ATTESTAT);
    await screen.findByTestId(`${id}-sheet`);
    await failImage(`${id}-hero-image`);
    expect(screen.queryByTestId(`${id}-hero-image`)).toBeNull();
    expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("guide-legend")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByTestId(`${id}-pages`)).toBeNull();
    expect(screen.getByTestId(`${id}-ask`)).toBeTruthy();
    // схема открывается крупно, листания нет
    await fireEvent.press(screen.getByTestId(`${id}-sample-open`));
    const box = await screen.findByTestId(`${id}-lightbox`);
    expect(within(box).getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(`${id}-pager-next`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`${id}-lightbox-close`));
    await fireEvent.press(await screen.findByTestId(`${id}-close`));
    await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
    await openGuide(S_ATTESTAT);
    expect(await screen.findByTestId(`${id}-hero-image`)).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("не загрузилась страница в крупном просмотре: схема на месте страницы, просмотр остаётся открытым", async () => {
    await renderDocs([ATTESTAT]);
    const id = `guide-${S_ATTESTAT}`;
    await openGuide(S_ATTESTAT);
    await fireEvent.press(await screen.findByTestId(`${id}-sample-open`));
    await screen.findByTestId(`${id}-lightbox`);
    await failImage(`${id}-lightbox-image`);
    expect(within(screen.getByTestId(`${id}-lightbox`)).getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(`${id}-lightbox-image`)).toBeNull();
    expect(screen.getByTestId(`${id}-lightbox`)).toBeTruthy();
  });

  it("не загрузилась миниатюра: в ряду номер страницы, образцы остаются", async () => {
    await renderDocs([ATTESTAT]);
    const id = `guide-${S_ATTESTAT}`;
    await openGuide(S_ATTESTAT);
    await screen.findByTestId(`${id}-sheet`);
    await failImage(`${id}-thumb-3`);
    expect(screen.queryByTestId(`${id}-thumb-3`)).toBeNull();
    expect(within(screen.getByTestId(`${id}-page-3`)).getByText("4")).toBeTruthy();
    expect(screen.getByTestId(`${id}-hero-image`)).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});

describe("Пример: IELTS и HSK в листе", () => {
  it("«Сертификат IELTS» показывает только IELTS", async () => {
    await renderDocs([IELTS], { student_portal_case_directions_v1: directions([CASE_ID, "CN"]) });
    await openGuide(S_IELTS);
    await screen.findByTestId(`guide-${S_IELTS}-sheet`);
    expect(uriOf(`guide-${S_IELTS}-hero-image`)).toBe(`${SAMPLES}/ielts-1.jpg`);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByTestId(`guide-${S_IELTS}-caption`)).toHaveTextContent("Пример, данные вымышлены");
    await waitFor(() => expect(screen.queryByTestId(`guide-${S_IELTS}-tab-hsk`)).toBeNull());
  });

  it("«Сертификат HSK» показывает только HSK; даже без страны дела", async () => {
    await renderDocs([HSK]);
    await openGuide(S_HSK);
    await screen.findByTestId(`guide-${S_HSK}-sheet`);
    expect(uriOf(`guide-${S_HSK}-hero-image`)).toBe(`${SAMPLES}/hsk-1.jpg`);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByTestId(`guide-${S_HSK}-tab-ielts`)).toBeNull();
  });

  it("«(HSK, IELTS или TOEFL)» - обе вкладки: IELTS, затем HSK", async () => {
    await renderDocs([BOTH], { student_portal_case_directions_v1: directions([CASE_ID, "CN"]) });
    await openGuide(S_BOTH);
    await screen.findByTestId(`guide-${S_BOTH}-sheet`);
    expect(screen.getAllByRole("tab").map((tab) => tab.props.accessibilityState.selected)).toEqual([true, false]);
    expect(screen.getByRole("tab", { name: "IELTS", selected: true })).toBeTruthy();
    expect(uriOf(`guide-${S_BOTH}-hero-image`)).toBe(`${SAMPLES}/ielts-1.jpg`);
    await fireEvent.press(screen.getByTestId(`guide-${S_BOTH}-tab-hsk`));
    expect(screen.getByRole("tab", { name: "HSK", selected: true })).toBeTruthy();
    expect(uriOf(`guide-${S_BOTH}-hero-image`)).toBe(`${SAMPLES}/hsk-1.jpg`);
  });

  it("кыргызский: «Үлгү», подпись образца и «Закрыть» из общего словаря", async () => {
    await renderDocs([HSK], {}, [], "ky");
    await openGuide(S_HSK);
    const sheet = await screen.findByTestId(`guide-${S_HSK}-sheet`);
    expect(within(sheet).getByText("Үлгү")).toBeTruthy();
    expect(screen.getByTestId(`guide-${S_HSK}-caption`)).toHaveTextContent("Үлгү, маалыматтар ойдон чыгарылган");
    expect(screen.getByTestId(`guide-${S_HSK}-close`).props.accessibilityLabel).toBe(ky.guideClose);
    expect(screen.getByTestId(`guide-${S_HSK}-ask`)).toHaveTextContent("Куратордон суроо");
  });
});

describe("Пример: страна дела (миграция 373)", () => {
  const id = `guide-${S_MEDICAL}`;

  it("страна дела читается RPC student_portal_case_directions_v1 (GET), выбор студента - запасной; ответы лежат в кэше", async () => {
    const { calls } = await renderDocs([MEDICAL], { student_portal_case_directions_v1: directions([CASE_ID, "CN"]), student_country_choice_v1: choice("MY") });
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`${id}-sheet`);
    // дело в Китае, хотя студент выбрал Малайзию: страна дела первая
    expect(await screen.findByTestId(`${id}-blank`)).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_portal_case_directions_v1")).toEqual([{ name: "student_portal_case_directions_v1", args: {}, get: true }]);
    // второе открытие листа не ходит в сеть за страной
    await fireEvent.press(screen.getByTestId(`${id}-close`));
    await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(`${id}-blank`)).toBeTruthy();
    expect(calls.filter((c) => c.name === "student_portal_case_directions_v1")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "student_country_choice_v1")).toHaveLength(1);
  });

  it("Китай: «Бланк» и «Пример заполнения» вкладками, кнопка «Скачать бланк»", async () => {
    await renderDocs([MEDICAL], { student_portal_case_directions_v1: directions([CASE_ID, "CN"]) });
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`${id}-blank`);
    expect(screen.getByRole("tab", { name: "Бланк", selected: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Пример заполнения" })).toBeTruthy();
    expect(screen.getByTestId(`${id}-blank`)).toHaveTextContent("Скачать бланк");
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/medical-blank-1.jpg`);
    expect(screen.getByTestId(`${id}-caption`)).toHaveTextContent("Страница 1 · 1 из 2");
    await fireEvent.press(screen.getByTestId(`${id}-tab-medical-filled`));
    expect(uriOf(`${id}-hero-image`)).toBe(`${SAMPLES}/medical-filled-1.jpg`);
    // бланк виден при любом выбранном наборе
    expect(screen.getByTestId(`${id}-blank`)).toBeTruthy();
  });

  it("Малайзия или страна неизвестна: у медсправки схема, бланка Китая нет", async () => {
    await renderDocs([MEDICAL], { student_portal_case_directions_v1: directions([CASE_ID, "MY"]) });
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`${id}-sheet`);
    await waitFor(() => expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy());
    expect(screen.queryByTestId(`${id}-blank`)).toBeNull();
    expect(screen.queryByTestId(`${id}-hero-image`)).toBeNull();
  });

  it("сбой чтения страны дела: берётся выбор студента", async () => {
    await renderDocs([MEDICAL], { student_portal_case_directions_v1: failure("42501", 403), student_country_choice_v1: choice("CN") });
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(`${id}-blank`)).toBeTruthy();
  });

  it("дело без страны (NULL) и выбор студента: берётся выбор", async () => {
    await renderDocs([MEDICAL], { student_portal_case_directions_v1: directions([CASE_ID, null]), student_country_choice_v1: choice("CN") });
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(`${id}-blank`)).toBeTruthy();
  });

  it("сбой обоих чтений: общая справка, как раньше (без бланка Китая)", async () => {
    const { calls } = await renderDocs([MEDICAL, PHOTO], { student_portal_case_directions_v1: failure(null, 500), student_country_choice_v1: failure("42501", 403) });
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`${id}-sheet`);
    await waitFor(() => expect(calls.some((c) => c.name === "student_country_choice_v1")).toBe(true));
    expect(screen.queryByTestId(`${id}-blank`)).toBeNull();
    expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`${id}-close`));
    await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
    await openGuide(S_PHOTO);
    expect(await screen.findByTestId(`guide-${S_PHOTO}-photo-spec`)).toHaveTextContent(ru.guidePhotoSpecAny);
  });

  it("студент «Пока не решил» (UNDECIDED) и нет страны дела: общая справка", async () => {
    await renderDocs([MEDICAL], { student_portal_case_directions_v1: [], student_country_choice_v1: choice("UNDECIDED") });
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`${id}-sheet`);
    expect(screen.queryByTestId(`${id}-blank`)).toBeNull();
    expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
  });

  it("два дела: каждая строка берёт страну своего дела", async () => {
    const rows = [{ ...PHOTO, case_id: CASE_ID }, { ...row(slot(72), "Фото"), case_id: CASE_B }];
    await renderDocs(rows, { student_portal_case_directions_v1: directions([CASE_ID, "CN"], [CASE_B, "MY"]), student_country_choice_v1: choice("MY") });
    await openGuide(S_PHOTO);
    expect(await screen.findByTestId(`guide-${S_PHOTO}-photo-spec`)).toHaveTextContent(ru.guidePhotoSpecCN);
    await fireEvent.press(screen.getByTestId(`guide-${S_PHOTO}-close`));
    await waitFor(() => expect(screen.queryByTestId(`guide-${S_PHOTO}-sheet`)).toBeNull());
    await openGuide(slot(72));
    expect(await screen.findByTestId(`guide-${slot(72)}-photo-spec`)).toHaveTextContent(ru.guidePhotoSpecMY);
  });

  it("два дела, одно название пункта: бланк Китая только у строки китайского дела", async () => {
    const rows = [{ ...MEDICAL, case_id: CASE_ID }, { ...row(S_MEDICAL_B, "Медицинская справка"), case_id: CASE_B }];
    await renderDocs(rows, { student_portal_case_directions_v1: directions([CASE_ID, "CN"], [CASE_B, "MY"]) });
    await openGuide(S_MEDICAL_B);
    await screen.findByTestId(`guide-${S_MEDICAL_B}-sheet`);
    expect(screen.queryByTestId(`guide-${S_MEDICAL_B}-blank`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`guide-${S_MEDICAL_B}-close`));
    await waitFor(() => expect(screen.queryByTestId(`guide-${S_MEDICAL_B}-sheet`)).toBeNull());
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(`${id}-blank`)).toBeTruthy();
  });
});

describe("Пример: бланк медсправки Китая", () => {
  const id = `guide-${S_MEDICAL}`;
  const china = { student_portal_case_directions_v1: directions([CASE_ID, "CN"]) };

  it("«Скачать бланк»: PDF по адресу портала без входа, затем системный просмотр", async () => {
    const { opened, fetched } = await renderDocs([MEDICAL], china);
    await openGuide(S_MEDICAL);
    const chip = await screen.findByTestId(`${id}-blank`);
    expect(chip.props.accessibilityRole).toBe("button");
    expect(chip.props.accessibilityLabel).toBe("Скачать бланк");
    jest.useFakeTimers();
    try {
      await fireEvent.press(chip);
      await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(opened).toEqual([{ uri: "file:///cache/medical-blank.pdf", mime: "application/pdf" }]));
    expect(fetched).toEqual([{ url: `${SAMPLES}/medical-blank.pdf`, headers: { Accept: "application/pdf" } }]);
  });

  it("пока файл качается, кнопка занята и повторное нажатие не шлёт второй запрос", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { fetched, respondWith } = await renderDocs([MEDICAL], china);
    respondWith(() => new Promise((resolve) => (release = resolve)));
    await openGuide(S_MEDICAL);
    const chip = await screen.findByTestId(`${id}-blank`);
    await fireEvent.press(chip);
    await waitFor(() => expect(screen.getByTestId(`${id}-blank`).props.accessibilityState).toEqual({ disabled: true, busy: true }));
    expect(screen.getByTestId(`${id}-blank`)).toHaveTextContent("Скачиваем…");
    await fireEvent.press(screen.getByTestId(`${id}-blank`));
    expect(fetched).toHaveLength(1);
    await act(async () => {
      release({ status: 404, ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) });
    });
    await waitFor(() => expect(screen.getByTestId(`${id}-blank`).props.accessibilityState).toEqual({ disabled: false, busy: false }));
  });

  it("файл недоступен: сообщение в листе, лист остаётся, просмотр не открывается; повтор после сбоя работает", async () => {
    const { opened, fetched, respondWith } = await renderDocs([MEDICAL], china);
    respondWith(() => ({ status: 404, ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }));
    await openGuide(S_MEDICAL);
    await fireEvent.press(await screen.findByTestId(`${id}-blank`));
    const message = await screen.findByTestId(`${id}-blank-error`);
    expect(message).toHaveTextContent("Файл сейчас недоступен. Попробуйте позже.");
    expect(message.props.accessibilityRole).toBe("alert");
    expect(screen.getByTestId(`${id}-sheet`)).toBeTruthy();
    expect(opened).toHaveLength(0);
    // связь вернулась: повтор берёт файл, сообщение уходит, лист закрывается и открывается просмотр
    respondWith(() => PDF);
    jest.useFakeTimers();
    try {
      await fireEvent.press(screen.getByTestId(`${id}-blank`));
      await waitFor(() => expect(screen.queryByTestId(`${id}-sheet`)).toBeNull());
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(fetched).toHaveLength(2);
  });

  it("нет сети: сообщение про соединение, а не про файл", async () => {
    const { opened, respondWith } = await renderDocs([MEDICAL], china);
    respondWith(() => {
      throw new TypeError("Network request failed");
    });
    await openGuide(S_MEDICAL);
    await fireEvent.press(await screen.findByTestId(`${id}-blank`));
    expect(await screen.findByTestId(`${id}-blank-error`)).toHaveTextContent(ru.errorNetwork);
    expect(opened).toHaveLength(0);
  });

  it("лист закрыли, пока файл качался: просмотр сам не всплывает", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { opened, respondWith } = await renderDocs([MEDICAL], china);
    respondWith(() => new Promise((resolve) => (release = resolve)));
    await openGuide(S_MEDICAL);
    await fireEvent.press(await screen.findByTestId(`${id}-blank`));
    await fireEvent.press(screen.getByTestId(`${id}-close`));
    await act(async () => {
      release(PDF);
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(opened).toHaveLength(0);
  });
});

describe("Пример: «Фото» - размер страны и «правильно / неправильно»", () => {
  const id = `guide-${S_PHOTO}`;

  it("Китай: 33×48 мм и 8+1, четыре картинки, значки по словам; нет картинки образца и нет ряда страниц", async () => {
    await renderDocs([PHOTO], { student_portal_case_directions_v1: directions([CASE_ID, "CN"]) });
    await openGuide(S_PHOTO);
    expect(await screen.findByTestId(`${id}-photo-spec`)).toHaveTextContent("33×48 мм · белый фон · 8 печатных и 1 электронное");
    const rules = screen.getByTestId(`${id}-photo-rules`);
    expect(within(rules).getByText("Каким должно быть фото")).toBeTruthy();
    expect(screen.getByTestId(`${id}-photo-ok`).props.accessibilityLabel).toBe("Правильно. Уши видны, без очков, тёмная одежда");
    expect(screen.getByTestId(`${id}-photo-glasses`).props.accessibilityLabel).toBe("Неправильно: Очки. Снимите очки");
    expect(screen.getByTestId(`${id}-photo-ears`).props.accessibilityLabel).toBe("Неправильно: Уши закрыты. Волосы, капюшон, наушники");
    expect(screen.getByTestId(`${id}-photo-clothes`).props.accessibilityLabel).toBe("Неправильно: Светлая одежда. Сливается с белым фоном");
    expect(within(rules).getByText(ru.guidePhotoNever)).toBeTruthy();
    expect(within(rules).queryByText(new RegExp(ru.guidePhotoNoScan))).toBeNull();
    expect(screen.queryByTestId(`${id}-hero-image`)).toBeNull();
    expect(screen.queryByTestId(`${id}-sample-open`)).toBeNull();
  });

  it("Малайзия: 35×45 мм, цифровой файл и «скан напечатанного фото не подойдёт»", async () => {
    await renderDocs([PHOTO], { student_portal_case_directions_v1: directions([CASE_ID, "MY"]) });
    await openGuide(S_PHOTO);
    await waitFor(() => expect(screen.getByTestId(`${id}-photo-spec`)).toHaveTextContent("35×45 мм · белый фон · цифровой файл JPG"));
    expect(within(screen.getByTestId(`${id}-photo-rules`)).getByText(new RegExp(ru.guidePhotoNoScan))).toBeTruthy();
  });

  it("страна неизвестна и кыргызский: общий размер, подписи KY", async () => {
    await renderDocs([PHOTO], {}, [], "ky");
    await openGuide(S_PHOTO);
    expect(await screen.findByTestId(`${id}-photo-spec`)).toHaveTextContent(ky.guidePhotoSpecAny);
    expect(screen.getByTestId(`${id}-photo-glasses`).props.accessibilityLabel).toBe(`${ky.guidePhotoWrong}: ${ky.guidePhotoGlasses}. ${ky.guidePhotoGlassesHint}`);
  });
});

describe("Пример: «Договор и чеки»", () => {
  it("у договора тоже «Пример»: схема, скачивание в листе; без страны дела", async () => {
    const { opened } = await renderDocs([], {}, [CASE_FILE_ROW]);
    const button = await screen.findByTestId(`guide-contract-${FILE_ID}-open`);
    expect(button).toHaveTextContent("Пример");
    expect(button.props.accessibilityLabel).toMatch(/^Пример: /);
    jest.useFakeTimers();
    try {
      await fireEvent.press(button);
      expect(await screen.findByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId(`guide-contract-${FILE_ID}-hero-image`)).toBeNull();
      await fireEvent.press(await screen.findByTestId(`guide-download-contract-${FILE_ID}`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(opened).toHaveLength(1));
  });
});
