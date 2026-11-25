// Нативные части документов программы с подставленными модулями устройства (expo-file-system, expo-crypto): что именно уходит на сервер.
// Настоящая загрузка и настоящие файлы на устройстве не проверялись (запуск на устройстве запрещён заданием).
import { createHash } from "node:crypto";

import type { ApplicationDocumentUploadIntent } from "@web/lib/portal/application-documents";

import type { PickedFile } from "@/domain/documents-model";
import { UPLOAD_INACTIVITY_MS, createProgramUploader, fingerprintFile, toHex } from "@/features/preparations/native";
import { encodeUploadHeader, freezeUploadIntent } from "@/features/preparations/upload-protocol";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, slotId, uploadId, versionId } from "@/test-fixtures/preparations";

type UploadResultLike = { status: number; body: string };
type Task = {
  fileUri: string;
  url: string;
  options: { uploadType: string; fieldName: string; mimeType: string; headers: Record<string, string>; sessionType?: string; signal?: AbortSignal; onProgress: (event: { bytesSent: number; totalBytes: number }) => void };
  /** Сколько раз задачу отменили (`cancel()` или `signal`). */
  cancels: number;
  /** Только при `mockState.hang`: завершить задачу так, как её завершил бы сервер или сеть. */
  resolve: (result: UploadResultLike) => void;
  reject: (error: Error) => void;
};
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
  /** С какой по счёту задачи (с нуля) обещание не отвечает, пока его не завершат (`task.resolve/reject`) или не отменят; `null` - все отвечают. */
  hangFrom: null as number | null,
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
      const task: Task = { fileUri: this.uri, url, options, cancels: 0, resolve: () => undefined, reject: () => undefined };
      mockState.tasks.push(task);
      const cancel = () => {
        task.cancels += 1;
        task.reject(Object.assign(new Error("The upload was cancelled."), { name: "UploadCancelledException" }));
      };
      return {
        cancel,
        // Как настоящая задача: отмена сигналом (и до начала, и во время) - `AbortError`; отмена `cancel()` отклоняет обещание;
        // после завершения подписка на сигнал снимается (после ответа отмена уже ничего не значит).
        uploadAsync: async () => {
          if (options.signal?.aborted) throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
          options.signal?.addEventListener("abort", cancel, { once: true });
          try {
            for (const event of mockState.progress) options.onProgress(event);
            if (mockState.hangFrom !== null && mockState.tasks.indexOf(task) >= mockState.hangFrom) return await new Promise<UploadResultLike>((resolve, reject) => ((task.resolve = resolve), (task.reject = reject)));
            const next = mockState.results.shift();
            if (next === undefined) throw new Error("no more");
            if (next instanceof Error) throw next;
            return next;
          } finally {
            options.signal?.removeEventListener("abort", cancel);
          }
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
  mockState.hangFrom = null;
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

// QA 25.11.2026 (D5): при остановленном портале кнопка стояла «Загружаем…» около четырёх минут. Причина: задача загрузки по
// умолчанию идёт в фоновой сессии iOS, которая ждёт связи сколько угодно. Здесь проверено поведение приложения вокруг задачи
// (подставленной): сессия, тишина, отмена. Настоящая сеть и настоящая фоновая/обычная сессия iOS без устройства не проверялись.
describe("отправка не ждёт вечно: обычная сессия, тишина и отмена студента", () => {
  const NOT_SENT = { ok: false, reason: "not_sent", resolution: "not_written" };
  const UNKNOWN = { ok: false, reason: "unavailable", resolution: "retain" };

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Запустить загрузку, которую не завершит никто, и дождаться, пока создастся задача. */
  async function startHanging(over: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}) {
    const value = await intent();
    mockState.hangFrom = 0;
    const promise = createProgramUploader(BASE, async () => "t")({ intent: value, file: picked, ...over });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockState.tasks).toHaveLength(1);
    return { promise, task: mockState.tasks[0]!, value };
  }
  const sent = (bytesSent: number, totalBytes = 1000) => ({ bytesSent, totalBytes });

  it("срок тишины: от минуты до полутора (решение владельца: «около 60-90 секунд без прироста»)", () => {
    expect(UPLOAD_INACTIVITY_MS).toBeGreaterThanOrEqual(60_000);
    expect(UPLOAD_INACTIVITY_MS).toBeLessThanOrEqual(90_000);
  });

  it("задача идёт в обычной (не фоновой) сессии: фоновая ждала бы связи, и отказ в соединении не приходил бы минутами", async () => {
    const value = await intent();
    mockState.results.push({ status: 201, body: receiptBody(value) });
    await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked });
    expect(mockState.tasks[0]!.options.sessionType).toBe("foreground");
  });

  it("отказ в соединении (портал остановлен): сбой сразу, исход неизвестен, запрос остаётся; ожидание за собой ничего не оставляет", async () => {
    const value = await intent();
    mockState.results.push(new Error("Could not connect to the server."));
    expect(await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked })).toEqual(UNKNOWN);
    // ни один таймер не остался: через полторы минуты задачу никто не отменит и не «оживит»
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS * 2);
    expect(mockState.tasks[0]!.cancels).toBe(0);
  });

  it("тишина: ни одного байта за UPLOAD_INACTIVITY_MS - задача отменяется, исход неизвестен, запрос остаётся", async () => {
    const { promise, task } = await startHanging();
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS - 1);
    expect(task.cancels).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(task.cancels).toBe(1);
    expect(await promise).toEqual(UNKNOWN);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("пока байты уходят, загрузка не обрывается: большой файл на медленной связи идёт сколько нужно", async () => {
    const { promise, task, value } = await startHanging();
    // двадцать минут: каждые 60 секунд прибавляется ещё немного, пауз длиннее срока нет
    for (let step = 1; step <= 20; step++) {
      await jest.advanceTimersByTimeAsync(60_000);
      task.options.onProgress(sent(step * 10));
    }
    expect(task.cancels).toBe(0);
    task.resolve({ status: 201, body: receiptBody(value) });
    expect(await promise).toMatchObject({ ok: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("тишина считается от последнего прироста: после последнего байта срок идёт заново", async () => {
    const { promise, task } = await startHanging();
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS - 1_000);
    task.options.onProgress(sent(500));
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS - 1);
    expect(task.cancels).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(task.cancels).toBe(1);
    expect(await promise).toEqual(UNKNOWN);
  });

  it("события без прироста байтов ходом не считаются: повтор того же числа срок не продлевает", async () => {
    const { promise, task } = await startHanging();
    task.options.onProgress(sent(300));
    await jest.advanceTimersByTimeAsync(60_000);
    task.options.onProgress(sent(300));
    task.options.onProgress(sent(200));
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS - 60_000 - 1);
    expect(task.cancels).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(task.cancels).toBe(1);
    expect(await promise).toEqual(UNKNOWN);
  });

  it("после обновления сессии (401) вторая отправка получает свой срок, а у первой таймера уже нет", async () => {
    const value = await intent();
    // первая задача отвечает 401 и закончена, вторая не отвечает
    mockState.results.push({ status: 401, body: "" });
    mockState.hangFrom = 1;
    const promise = createProgramUploader(BASE, async () => "old", async () => "new")({ intent: value, file: picked });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockState.tasks).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS);
    expect(mockState.tasks.map((task) => task.cancels)).toEqual([0, 1]);
    expect(await promise).toEqual(UNKNOWN);
  });

  it("студент нажал «Отменить» во время отправки: задача отменена тем же сигналом, исход неизвестен, запрос остаётся", async () => {
    const stop = new AbortController();
    const { promise, task } = await startHanging({ signal: stop.signal });
    expect(task.options.signal).toBe(stop.signal);
    stop.abort();
    expect(task.cancels).toBe(1);
    expect(await promise).toEqual(UNKNOWN);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("студент нажал «Отменить», пока брался токен: в сеть ничего не ушло, `not_sent`, задача и копия не создаются", async () => {
    const value = await intent();
    const stop = new AbortController();
    let giveToken: (token: string) => void = () => undefined;
    const promise = createProgramUploader(BASE, () => new Promise<string>((resolve) => (giveToken = resolve)))({ intent: value, file: picked, signal: stop.signal });
    await jest.advanceTimersByTimeAsync(0);
    stop.abort();
    giveToken("t");
    expect(await promise).toEqual(NOT_SENT);
    expect(mockState.tasks).toHaveLength(0);
    expect(mockState.copies).toHaveLength(0);
    expect(mockState.created).toHaveLength(0);
  });

  it("сигнал уже отменён к началу: ничего не делается, `not_sent`", async () => {
    const value = await intent();
    const stop = new AbortController();
    stop.abort();
    const token = jest.fn(async () => "t");
    expect(await createProgramUploader(BASE, token)({ intent: value, file: picked, signal: stop.signal })).toEqual(NOT_SENT);
    expect(token).not.toHaveBeenCalled();
    expect(mockState.tasks).toHaveLength(0);
  });

  it("отмена после ответа ничего не меняет: квитанция остаётся квитанцией, таймер снят и позже ничего не отменяет", async () => {
    const value = await intent();
    const stop = new AbortController();
    mockState.results.push({ status: 201, body: receiptBody(value) });
    const result = await createProgramUploader(BASE, async () => "t")({ intent: value, file: picked, signal: stop.signal });
    stop.abort();
    await jest.advanceTimersByTimeAsync(UPLOAD_INACTIVITY_MS * 2);
    expect(result).toMatchObject({ ok: true });
    expect(mockState.tasks[0]!.cancels).toBe(0);
  });
});
