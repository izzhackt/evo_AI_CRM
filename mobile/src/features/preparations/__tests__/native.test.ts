// Нативные части документов программы с подставленными модулями устройства (expo-file-system, expo-crypto): что именно уходит на сервер.
// Настоящая загрузка и настоящие файлы на устройстве не проверялись (запуск на устройстве запрещён заданием).
import { createHash } from "node:crypto";

import type { ApplicationDocumentUploadIntent } from "@web/lib/portal/application-documents";

import type { PickedFile } from "@/domain/documents-model";
import { createProgramUploader, fingerprintFile, toHex } from "@/features/preparations/native";
import { encodeUploadHeader, freezeUploadIntent } from "@/features/preparations/upload-protocol";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, slotId, uploadId, versionId } from "@/test-fixtures/preparations";

type Task = { fileUri: string; url: string; options: { uploadType: string; fieldName: string; mimeType: string; headers: Record<string, string>; onProgress: (event: { bytesSent: number; totalBytes: number }) => void } };
const mockState = {
  bytes: new TextEncoder().encode("%PDF-1.7 синтетический файл"),
  tasks: [] as Task[],
  copies: [] as [string, string][],
  created: [] as string[],
  deleted: [] as string[],
  results: [] as ({ status: number; body: string } | Error)[],
  progress: [] as { bytesSent: number; totalBytes: number }[],
  /** Размер файла по файловой системе; `null` - столько же, сколько байтов. */
  size: null as number | null,
  /** Сбои до начала отправки. */
  createError: null as Error | null,
  copyError: null as Error | null,
};

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-0000-4000-8000-0000000000aa",
  getRandomBytes: (size: number) => new Uint8Array(size),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algorithm: string, data: ArrayBuffer) => {
    const out = jest.requireActual<typeof import("node:crypto")>("node:crypto").createHash("sha256").update(Buffer.from(data)).digest();
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
}));
jest.mock("expo-file-system", () => {
  const name = (uri: string) => uri.split("/").pop() ?? "";
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
    }
    create() {
      if (mockState.createError) throw mockState.createError;
      mockState.created.push(this.uri);
    }
    get exists() {
      return mockState.created.includes(this.uri) && !mockState.deleted.includes(this.uri);
    }
    delete() {
      mockState.deleted.push(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
    }
    get name() {
      return name(this.uri);
    }
    get size() {
      return mockState.size ?? mockState.bytes.byteLength;
    }
    copy(destination: { uri: string }) {
      if (mockState.copyError) throw mockState.copyError;
      mockState.copies.push([this.uri, destination.uri]);
    }
    async arrayBuffer() {
      return mockState.bytes.buffer.slice(mockState.bytes.byteOffset, mockState.bytes.byteOffset + mockState.bytes.byteLength);
    }
    createUploadTask(url: string, options: Task["options"]) {
      const task = { fileUri: this.uri, url, options };
      mockState.tasks.push(task);
      return {
        uploadAsync: async () => {
          for (const event of mockState.progress) options.onProgress(event);
          const next = mockState.results.shift();
          if (next === undefined) throw new Error("no more");
          if (next instanceof Error) throw next;
          return next;
        },
      };
    }
  }
  return { Directory, File, Paths: { cache: "cache" }, UploadType: { MULTIPART: "MULTIPART" } };
});

const BASE = "https://portal.example.test";
const target = { studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID, requirementsRevisionId: REVISION_ID, requirementItemId: itemId(0), documentSlotId: slotId(0) };
const REQUEST = "99999999-0000-4000-8000-000000000001";
const picked: PickedFile = { uri: "file:///cache/picker/Скан.pdf", name: "Скан.pdf", size: mockState.bytes.byteLength, mimeType: "application/pdf", source: "file" };
const digest = createHash("sha256").update(mockState.bytes).digest("hex");

async function intent(): Promise<ApplicationDocumentUploadIntent> {
  const value = await freezeUploadIntent({ target, file: picked, requestId: REQUEST, fingerprint: fingerprintFile });
  if (value.status !== "frozen") throw new Error(`не заморозился: ${value.status}`);
  return value.intent;
}
const receiptBody = (value: ApplicationDocumentUploadIntent) =>
  JSON.stringify({ upload: { protocolVersion: 1, ...target, requestId: value.requestId, uploadContextId: uploadId(1), documentVersionId: versionId(1), versionNo: "1", file: value.file, finalizedAt: "2026-10-07T10:00:00+00:00", publishedToLegacySlot: false } });

beforeEach(() => {
  mockState.tasks.length = 0;
  mockState.copies.length = 0;
  mockState.created.length = 0;
  mockState.deleted.length = 0;
  mockState.results.length = 0;
  mockState.progress.length = 0;
  mockState.size = null;
  mockState.createError = null;
  mockState.copyError = null;
});

describe("отпечаток файла", () => {
  it("toHex: два знака на байт", () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
    expect(toHex(new Uint8Array())).toBe("");
  });

  it("размер и SHA-256 по байтам файла", async () => {
    expect(await fingerprintFile(picked)).toEqual({ byteSize: mockState.bytes.byteLength, sha256Hex: digest });
  });

  it("размер берётся из прочитанных байтов, а не из ответа выбора файла", async () => {
    expect(await fingerprintFile({ ...picked, size: 999 })).toEqual({ byteSize: mockState.bytes.byteLength, sha256Hex: digest });
  });

  it("файл менялся во время чтения (размер по файловой системе не равен числу прочитанных байтов): отпечатка нет", async () => {
    for (const size of [mockState.bytes.byteLength + 1, mockState.bytes.byteLength - 1, 0]) {
      mockState.size = size;
      await expect(fingerprintFile(picked)).rejects.toThrow("file_changed_while_reading");
    }
  });

  it("такой файл не замораживается: «не прочитался», а не «не годится»", async () => {
    mockState.size = mockState.bytes.byteLength + 5;
    expect((await freezeUploadIntent({ target, file: picked, requestId: REQUEST, fingerprint: fingerprintFile })).status).toBe("unreadable");
  });
});

describe("отправка файла программы", () => {
  it("один multipart: часть `upload` в своём подкаталоге, поле file, тип файла, Bearer, ключ идемпотентности и заголовок запроса", async () => {
    const value = await intent();
    mockState.results.push({ status: 201, body: receiptBody(value) });
    const upload = createProgramUploader(BASE, async () => "synthetic-token");
    const result = await upload({ intent: value, file: picked });
    expect(result).toMatchObject({ ok: true, receipt: { requestId: REQUEST, documentVersionId: versionId(1) } });
    expect(mockState.tasks).toHaveLength(1);
    const task = mockState.tasks[0]!;
    // Адрес, поле, имена заголовков и имя файла в части записаны буквами: сверка с константами приложения не заметила бы в них опечатки
    // (сами константы сверены с вебом в `upload-protocol.test.ts`).
    expect(task.url).toBe(`${BASE}/api/portal/application-document-uploads`);
    expect(task.options).toMatchObject({ uploadType: "MULTIPART", fieldName: "file", mimeType: "application/pdf" });
    expect(task.options.headers).toEqual({
      Authorization: "Bearer synthetic-token",
      "Idempotency-Key": REQUEST,
      "X-EVO-Upload-Intent": encodeUploadHeader({ protocolVersion: 1, ...target, file: value.file }),
      Accept: "application/json",
    });
    // выбранный файл скопирован байт в байт под именем `upload` в свой подкаталог, и именно он отправлен
    expect(mockState.copies).toHaveLength(1);
    expect(mockState.copies[0]![0]).toBe(picked.uri);
    expect(mockState.copies[0]![1].endsWith("/upload")).toBe(true);
    expect(task.fileUri).toBe(mockState.copies[0]![1]);
    expect(task.fileUri.split("/").pop()).toBe("upload");
  });

  it("промежуточная копия удаляется при успехе, отказе и обрыве", async () => {
    const value = await intent();
    const upload = createProgramUploader(BASE, async () => "t");
    for (const next of [{ status: 201, body: receiptBody(value) }, { status: 503, body: "" }, new Error("offline")] as const) {
      mockState.deleted.length = 0;
      mockState.created.length = 0;
      mockState.results.push(next as never);
      await upload({ intent: value, file: picked });
      expect(mockState.created).toHaveLength(1);
      expect(mockState.deleted).toEqual(mockState.created);
    }
  });

  it("ход загрузки доходит до экрана в процентах", async () => {
    const value = await intent();
    mockState.results.push({ status: 201, body: receiptBody(value) });
    mockState.progress.push({ bytesSent: 10, totalBytes: 40 }, { bytesSent: 40, totalBytes: 40 }, { bytesSent: 0, totalBytes: 0 });
    const percents: number[] = [];
    await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked, onProgress: (p) => percents.push(p) });
    expect(percents).toEqual([25, 100]);
  });

  it("401: сессия обновляется один раз, тот же запрос уходит с новым токеном и теми же ключом и заголовком", async () => {
    const value = await intent();
    mockState.results.push({ status: 401, body: "" }, { status: 201, body: receiptBody(value) });
    let refreshed = 0;
    const result = await createProgramUploader(BASE, async () => "old", async () => ((refreshed += 1), "new"))({ intent: value, file: picked });
    expect(result.ok).toBe(true);
    expect(refreshed).toBe(1);
    expect(mockState.tasks).toHaveLength(2);
    expect(mockState.tasks[0]!.options.headers.Authorization).toBe("Bearer old");
    expect(mockState.tasks[1]!.options.headers.Authorization).toBe("Bearer new");
    expect({ ...mockState.tasks[1]!.options.headers, Authorization: "" }).toEqual({ ...mockState.tasks[0]!.options.headers, Authorization: "" });
  });

  it("401 и обновить сессию нельзя: результат неизвестен (запрос остаётся), вторая отправка не идёт", async () => {
    const value = await intent();
    mockState.results.push({ status: 401, body: "" });
    expect(await createProgramUploader(BASE, async () => "old", async () => null)({ intent: value, file: picked })).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    expect(mockState.tasks).toHaveLength(1);
    mockState.results.push({ status: 401, body: "" });
    expect(await createProgramUploader(BASE, async () => "old")({ intent: value, file: picked })).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });

  describe("сбой до начала отправки: ничего не ушло, запись о загрузке можно снять", () => {
    const NOT_SENT = { ok: false, reason: "not_sent", resolution: "not_written" };

    it("нет токена или его получение упало: ничего не отправляется", async () => {
      const value = await intent();
      expect(await createProgramUploader(BASE, async () => null)({ intent: value, file: picked })).toEqual(NOT_SENT);
      expect(await createProgramUploader(BASE, async () => { throw new Error("keychain"); })({ intent: value, file: picked })).toEqual(NOT_SENT);
      expect(mockState.tasks).toHaveLength(0);
      expect(mockState.copies).toHaveLength(0);
    });

    it("каталог для копии не создался или файл не скопировался: запрос не уходит, копия убрана", async () => {
      const value = await intent();
      mockState.createError = new Error("disk full");
      expect(await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked })).toEqual(NOT_SENT);
      mockState.createError = null;
      mockState.copyError = new Error("file vanished");
      expect(await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked })).toEqual(NOT_SENT);
      expect(mockState.tasks).toHaveLength(0);
      // каталог второй попытки создан, и он удалён
      expect(mockState.created).toHaveLength(1);
      expect(mockState.deleted).toEqual(mockState.created);
    });

    it("описание запроса не кодируется в заголовок: не отправляется, и повтор того же файла не нужен", async () => {
      const value = await intent();
      const broken = { ...value, file: { ...value.file, originalFilename: "а/б.pdf" } } as ApplicationDocumentUploadIntent;
      expect(await createProgramUploader(BASE, async () => "t")({ intent: broken, file: picked })).toEqual(NOT_SENT);
      expect(mockState.tasks).toHaveLength(0);
    });

    it("после начала отправки сбой связи снова «исход неизвестен»: запрос остаётся", async () => {
      const value = await intent();
      mockState.results.push(new Error("Network request failed"));
      expect(await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked })).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
      expect(mockState.tasks).toHaveLength(1);
    });
  });

  it("ответы сервера разбираются по правилам протокола: точный отказ, чужое тело, не JSON", async () => {
    const value = await intent();
    const upload = createProgramUploader(BASE, async () => "t");
    mockState.results.push({ status: 409, body: JSON.stringify({ error: { code: "stale_context", resolution: "not_written" } }) });
    expect(await upload({ intent: value, file: picked })).toEqual({ ok: false, reason: "stale_context", resolution: "not_written" });
    mockState.results.push({ status: 201, body: "<html>" });
    expect(await upload({ intent: value, file: picked })).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
    mockState.results.push({ status: 413, body: "" });
    expect(await upload({ intent: value, file: picked })).toEqual({ ok: false, reason: "file_too_large", resolution: "retain" });
  });

  it("обрыв связи посреди загрузки: исход неизвестен", async () => {
    const value = await intent();
    mockState.results.push(new Error("Network request failed"));
    expect(await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked })).toEqual({ ok: false, reason: "unavailable", resolution: "retain" });
  });

});
