import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import type { DocumentsIo } from "@/features/documents/io";
import type { UploadAttempt, UploadResponse } from "@/features/documents/upload-controller";
import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import { CASE_FILE_ROW, DOCUMENT_ROW_CORRECTION, DOCUMENT_ROW_EMPTY, FILE_ID, SLOT_ID, VERSION_ID } from "@/test-fixtures/rpc-rows";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
// Нативные модули не нужны: экран получает io аргументом, но io.ts импортирует native.ts.
jest.mock("@/features/documents/native", () => ({
  pickFromFiles: jest.fn(),
  pickFromPhotos: jest.fn(),
  pickFromCamera: jest.fn(),
  createUploadSend: jest.fn(),
  createDownloadDeps: jest.fn(),
  openLocalFile: jest.fn(),
}));

const navigate = router.navigate as jest.Mock;
const SLOT_2 = "44444444-4444-4444-8444-444444444445";
const APPROVED = { ...DOCUMENT_ROW_CORRECTION, document_slot_id: SLOT_2, requirement_label: "Фото", slot_status: "approved", review_decision: "approved", rework_reason: null, instructions: null, deadline: null };
const receipt = { document: { documentSlotId: SLOT_ID, documentVersionId: VERSION_ID, versionNumber: 3, originalFilename: "new.pdf", declaredMimeType: "application/pdf", byteSize: 1000 } };

function makeIo(over: Partial<DocumentsIo> = {}, responses: UploadResponse[] = [{ status: 201, body: receipt }]) {
  const attempts: UploadAttempt[] = [];
  const opened: string[] = [];
  const io: DocumentsIo = {
    pick: jest.fn(async () => ({ kind: "picked" as const, file: { uri: "file:///cache/new.pdf", name: "new.pdf", size: 1000, mimeType: "application/pdf", source: "file" as const } })),
    createUploadSend: () => async (attempt) => {
      attempts.push(attempt);
      return responses.shift() ?? { status: 503, body: null };
    },
    createDownloadDeps: () => ({
      baseUrl: "https://portal.example.test",
      getToken: async () => "t",
      fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1]).buffer }),
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string) => void opened.push(uri)),
    ...over,
  };
  return { io, attempts, opened };
}

const handlers = (docs: unknown[], files: unknown[] = []) => ({ student_portal_documents: docs, student_portal_case_files_v1: files });

beforeEach(() => navigate.mockClear());

describe("Документы: чек-лист", () => {
  it("статусы, замечание проверяющего, счётчик и действия по статусу", async () => {
    const { transport, calls } = fakeTransport(handlers([DOCUMENT_ROW_CORRECTION, { ...DOCUMENT_ROW_EMPTY, document_slot_id: "44444444-4444-4444-8444-444444444446", requirement_label: "Аттестат" }, APPROVED]));
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Что нужно исправить")).toBeTruthy();
    expect(screen.getByText("Фото не видно")).toBeTruthy();
    expect(screen.getByTestId("checklist-share").props.accessibilityLabel).toBe("Принято 1 из 3");
    // загруженный слот: «Заменить» и «Скачать»; пустой: «Загрузить» без «Скачать»; принятый: замок вместо загрузки
    expect(screen.getByTestId(`upload-${SLOT_ID}`)).toBeTruthy();
    expect(screen.getByText("Заменить")).toBeTruthy();
    expect(screen.getByTestId(`download-${SLOT_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`upload-${SLOT_2}`)).toBeNull();
    expect(screen.getByText("Принятый документ доступен только для скачивания.")).toBeTruthy();
    expect(calls.find((c) => c.name === "student_portal_documents")?.get).toBe(true);
  });

  it("пустой список не тупик: объяснение и «Написать EVO» ведёт в чат", async () => {
    const { transport } = fakeTransport(handlers([]));
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Список документов пока пуст")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("documents-empty-action"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
  });

  it("сбой чтения: плашка с повтором, без текста сервера", async () => {
    const { transport } = fakeTransport({ student_portal_documents: failure(null, 503), student_portal_case_files_v1: [] });
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("documents-error")).toBeTruthy();
    expect(screen.getByText("Сервис временно недоступен. Повторите позже.")).toBeTruthy();
  });

  it("битая строка ответа отклоняется целиком", async () => {
    const { transport } = fakeTransport(handlers([{ ...DOCUMENT_ROW_EMPTY, slot_status: "weird" }]));
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("documents-error")).toBeTruthy();
  });
});

describe("Документы: загрузка из строки", () => {
  async function openSheet(io: DocumentsIo) {
    const { transport, calls } = fakeTransport(handlers([DOCUMENT_ROW_EMPTY]));
    await renderPortal(<DocumentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId(`upload-${SLOT_ID}`));
    return calls;
  }

  it("один вход: лист с тремя способами; выбор файла отправляет с Bearer-ключом идемпотентности и обновляет список", async () => {
    jest.useFakeTimers();
    try {
      const { io, attempts } = makeIo();
      const calls = await openSheet(io);
      for (const id of ["pick-file", "pick-photo", "pick-camera"]) expect(screen.getByTestId(id)).toBeTruthy();
      await fireEvent.press(screen.getByTestId("pick-file"));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      await waitFor(() => expect(attempts).toHaveLength(1));
      expect(io.pick).toHaveBeenCalledWith("file");
      expect(attempts[0]).toMatchObject({ slotId: SLOT_ID, mimeType: "application/pdf" });
      expect(attempts[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      await waitFor(() => expect(screen.getByText("Файл «new.pdf» загружен.")).toBeTruthy());
      // после успеха чек-лист читается заново
      await waitFor(() => expect(calls.filter((c) => c.name === "student_portal_documents").length).toBeGreaterThan(1));
    } finally {
      jest.useRealTimers();
    }
  });

  it("камера отказана: понятное сообщение и ссылка в настройки, загрузки нет", async () => {
    jest.useFakeTimers();
    try {
      const { io, attempts } = makeIo({ pick: jest.fn(async () => ({ kind: "denied" as const, canAskAgain: false })) });
      await openSheet(io);
      await fireEvent.press(screen.getByTestId("pick-camera"));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(await screen.findByText("Нет доступа к камере. Разрешите его в настройках телефона.")).toBeTruthy();
      expect(screen.getByTestId(`settings-${SLOT_ID}`)).toBeTruthy();
      expect(attempts).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("неподходящий файл (HEIC) не уходит на сервер", async () => {
    jest.useFakeTimers();
    try {
      const { io, attempts } = makeIo({ pick: jest.fn(async () => ({ kind: "picked" as const, file: { uri: "file:///c/a.heic", name: "a.heic", size: 10, mimeType: "image/heic", source: "photo" as const } })) });
      await openSheet(io);
      await fireEvent.press(screen.getByTestId("pick-photo"));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      expect(await screen.findByText("Подходят только PDF, JPG и PNG.")).toBeTruthy();
      expect(attempts).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("сбой сети: «Повторить загрузку» шлёт тот же ключ", async () => {
    jest.useFakeTimers();
    try {
      const { io, attempts } = makeIo({}, [{ status: 503, body: null }, { status: 201, body: receipt }]);
      await openSheet(io);
      await fireEvent.press(screen.getByTestId("pick-file"));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      await screen.findByText("Загрузка сейчас недоступна. Попробуйте позже.");
      await fireEvent.press(screen.getByTestId(`retry-${SLOT_ID}`));
      await waitFor(() => expect(attempts).toHaveLength(2));
      expect(attempts[1]?.idempotencyKey).toBe(attempts[0]?.idempotencyKey);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Документы: скачивание", () => {
  it("свой файл: bearer-скачивание и открытие", async () => {
    const { io, opened } = makeIo();
    const { transport } = fakeTransport(handlers([DOCUMENT_ROW_CORRECTION]));
    await renderPortal(<DocumentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId(`download-${SLOT_ID}`));
    await waitFor(() => expect(opened).toEqual(["file:///cache/passport.pdf"]));
  });
});

describe("Договор и чеки", () => {
  it("показываются, если есть, и скачиваются по виду файла", async () => {
    const { io, opened } = makeIo();
    const { transport } = fakeTransport(handlers([DOCUMENT_ROW_EMPTY], [CASE_FILE_ROW, { ...CASE_FILE_ROW, file_kind: "receipt", file_id: "77777777-7777-4777-8777-777777777778", original_filename: "receipt.pdf" }]));
    await renderPortal(<DocumentsScreen io={io} />, testApi(transport));
    expect(await screen.findByText("Договор и чеки")).toBeTruthy();
    expect(screen.getByText("Учтён в оплате")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`case-file-download-contract-${FILE_ID}`));
    await waitFor(() => expect(opened).toEqual(["file:///cache/contract.pdf"]));
  });
  it("нет файлов: блока нет; сбой чтения не роняет чек-лист", async () => {
    const { transport } = fakeTransport({ student_portal_documents: [DOCUMENT_ROW_EMPTY], student_portal_case_files_v1: failure(null, 503) });
    await renderPortal(<DocumentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByTestId(`upload-${SLOT_ID}`);
    expect(screen.queryByText("Договор и чеки")).toBeNull();
  });
});
