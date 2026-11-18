import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { readFileSync } from "node:fs";
import path from "node:path";
import { documentGuideSamples } from "@web/lib/portal/document-guides";

import type { DocumentsIo } from "@/features/documents/io";
import { decodeSvgText } from "@/features/documents/DocumentGuide";
import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import { DOCUMENT_SAMPLE_SVG } from "@/features/documents/document-samples.generated";
import { CASE_FILE_ROW, DOCUMENT_ROW_CORRECTION, DOCUMENT_ROW_EMPTY, FILE_ID, SLOT_ID, VERSION_ID } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

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
const SLOT_OWN = "44444444-4444-4444-8444-444444444460";
const SLOT_OK = "44444444-4444-4444-8444-444444444461";
const OWN = { ...DOCUMENT_ROW_EMPTY, document_slot_id: SLOT_OWN, requirement_key: null, requirement_label: "Особый пункт куратора", instructions: "Принесите оригинал" };
const APPROVED_PASSPORT = { ...DOCUMENT_ROW_CORRECTION, document_slot_id: SLOT_OK, slot_status: "approved", review_decision: "approved", rework_reason: null, instructions: null, deadline: null };

function makeIo(over: Partial<DocumentsIo> = {}) {
  const opened: string[] = [];
  const io: DocumentsIo = {
    pick: jest.fn(),
    createUploadSend: jest.fn(),
    createDownloadDeps: () => ({
      baseUrl: "https://portal.example.test",
      getToken: async () => "t",
      fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1]).buffer }),
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string) => void opened.push(uri)),
    ...over,
  };
  return { io, opened };
}

const docs = (rows: unknown[], files: unknown[] = []) => fakeTransport({ student_portal_documents: rows, student_portal_case_files_v1: files });

beforeEach(() => navigate.mockClear());

describe("Что это за документ: образцы", () => {
  it("у каждого образца каталога веба есть SVG в приложении, и он совпадает с файлом веба", () => {
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
});

describe("decodeSvgText", () => {
  it("раскодирует сущности в тексте; «<» не остаётся сырым", () => {
    const out = decodeSvgText('<text>P&lt;KGZ&lt;&lt; &amp; A</text><text fill="#fff">x</text>');
    expect(out).toBe('<text>P\uFF1CKGZ\uFF1C\uFF1C & A</text><text fill="#fff">x</text>');
    for (const xml of Object.values(DOCUMENT_SAMPLE_SVG)) expect(decodeSvgText(xml)).not.toMatch(/&(lt|gt|amp|quot|apos);/);
  });
});

describe("Что это за документ: кнопка «!» в «Документах»", () => {
  it("есть у паспорта, нет у своего пункта куратора; общая подсказка уходит в лист, своя инструкция остаётся", async () => {
    const { transport } = docs([DOCUMENT_ROW_EMPTY, OWN]);
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId(`guide-${SLOT_ID}-open`)).toBeTruthy();
    expect(screen.getByTestId(`guide-${SLOT_ID}-open`).props.accessibilityLabel).toBe("Что это за документ? Загранпаспорт");
    expect(screen.queryByTestId(`guide-${SLOT_OWN}-open`)).toBeNull();
    expect(screen.getByText("Принесите оригинал")).toBeTruthy();
  });

  it("лист: описание, «Где взять», требования, образец с метками, подсказка про ошибки; закрывается", async () => {
    const { transport } = docs([DOCUMENT_ROW_EMPTY]);
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(screen.queryByTestId(`guide-${SLOT_ID}-sheet`)).toBeNull();
    await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-open`));
    expect(await screen.findByTestId(`guide-${SLOT_ID}-description`)).toHaveTextContent(/Разворот с фото и данными/);
    expect(screen.getByText("Где взять")).toBeTruthy();
    expect(screen.getByText(/PDF, JPG или PNG · до 25 МБ/)).toBeTruthy();
    expect(screen.getByTestId("guide-sample", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("guide-legend")).toHaveTextContent(/Разворот с фото.*Срок действия.*Без бликов/);
    expect(screen.getByTestId(`guide-${SLOT_ID}-mistakes`)).toHaveTextContent(/обложку/);
    await fireEvent.press(screen.getByTestId(`guide-${SLOT_ID}-close`));
    await waitFor(() => expect(screen.queryByTestId(`guide-${SLOT_ID}-sheet`)).toBeNull());
  });

  it("образец открывается крупно и закрывается обратно в лист", async () => {
    const { transport } = docs([DOCUMENT_ROW_EMPTY]);
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-open`));
    await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-sample-open`));
    expect(await screen.findByTestId(`guide-${SLOT_ID}-lightbox`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`guide-${SLOT_ID}-lightbox-close`));
    expect(await screen.findByTestId(`guide-${SLOT_ID}-sheet`)).toBeTruthy();
  });

  it("«Спросить куратора» закрывает лист и ведёт в чат; «Мои программы» - во вкладку вузов", async () => {
    const { transport } = docs([DOCUMENT_ROW_EMPTY]);
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    jest.useFakeTimers();
    try {
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-open`));
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-ask`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(navigate).toHaveBeenCalledWith("/messages/chat");
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-open`));
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-programs`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(navigate).toHaveBeenCalledWith("/universities");
    } finally {
      jest.useRealTimers();
    }
  });

  it("действие в листе: у непринятого «Загрузить» открывает выбор файла, у принятого «Скачать» скачивает", async () => {
    const { transport } = docs([DOCUMENT_ROW_EMPTY, APPROVED_PASSPORT]);
    const { io, opened } = makeIo();
    await renderPortal(<DocumentsScreen io={io} />, testApi(transport));
    jest.useFakeTimers();
    try {
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_ID}-open`));
      await fireEvent.press(await screen.findByTestId(`guide-upload-${SLOT_ID}`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(await screen.findByTestId("source-sheet")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("pick-cancel"));
      await fireEvent.press(await screen.findByTestId(`guide-${SLOT_OK}-open`));
      expect(screen.queryByTestId(`guide-upload-${SLOT_OK}`)).toBeNull();
      await fireEvent.press(await screen.findByTestId(`guide-download-${SLOT_OK}`));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(VERSION_ID).toBeTruthy();
  });

  it("договор в «Договоре и чеках» тоже со справкой и скачиванием", async () => {
    const { transport } = docs([], [CASE_FILE_ROW]);
    const { io, opened } = makeIo();
    await renderPortal(<DocumentsScreen io={io} />, testApi(transport));
    jest.useFakeTimers();
    try {
      await fireEvent.press(await screen.findByTestId(`guide-contract-${FILE_ID}-open`));
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
