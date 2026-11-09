import { checkPickedFile, progressPercent, resolveMimeType, safeFileName, MAX_UPLOAD_BYTES, type PickedFile } from "@/domain/documents-model";
import { failureOf, parseUploadReceipt, UploadController, type UploadAttempt, type UploadResponse, type UploadState } from "@/features/documents/upload-controller";

const SLOT = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";

const pdf: PickedFile = { uri: "file:///cache/passport.pdf", name: "passport.pdf", size: 1000, mimeType: "application/pdf", source: "file" };
const receipt = (over: Record<string, unknown> = {}) => ({
  document: { documentSlotId: SLOT, documentVersionId: VERSION, versionNumber: 1, originalFilename: "passport.pdf", declaredMimeType: "application/pdf", byteSize: 1000, ...over },
});

function setup(responses: (UploadResponse | Error | "hang")[]) {
  const attempts: UploadAttempt[] = [];
  let keys = 0;
  let uploaded = 0;
  const send = jest.fn((attempt: UploadAttempt) => {
    attempts.push(attempt);
    const next = responses.shift();
    if (next === "hang") {
      return new Promise<UploadResponse>((_resolve, reject) => attempt.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? { status: 503, body: null });
  });
  const controller = new UploadController(SLOT, send, () => `key-${++keys}`, () => void (uploaded += 1));
  const states: UploadState[] = [];
  controller.subscribe(() => states.push(controller.getState()));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { controller, attempts, states, send, settle, uploaded: () => uploaded };
}

describe("проверка файла до отправки", () => {
  it("принимает PDF/JPEG/PNG, в том числе по расширению при общем типе", () => {
    expect(checkPickedFile(pdf)).toEqual({ ok: true, mimeType: "application/pdf" });
    expect(resolveMimeType({ name: "a.JPG", mimeType: "image/jpg" })).toBe("image/jpeg");
    expect(resolveMimeType({ name: "scan.png", mimeType: null })).toBe("image/png");
    expect(resolveMimeType({ name: "scan.pdf", mimeType: "application/octet-stream" })).toBe("application/pdf");
  });
  it.each([
    ["HEIC", { name: "IMG.HEIC", mimeType: "image/heic" }],
    ["GIF", { name: "a.gif", mimeType: "image/gif" }],
    ["Word", { name: "a.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
    ["без типа и расширения", { name: "file", mimeType: null }],
    ["чужой тип с верным расширением", { name: "a.pdf", mimeType: "text/html" }],
  ])("отклоняет тип: %s", (_name, file) => {
    expect(checkPickedFile({ ...pdf, ...file })).toEqual({ ok: false, reason: "type" });
  });
  it("предел 25 МБ включительно, 0 байт и пустой размер нет", () => {
    expect(checkPickedFile({ ...pdf, size: MAX_UPLOAD_BYTES }).ok).toBe(true);
    expect(checkPickedFile({ ...pdf, size: MAX_UPLOAD_BYTES + 1 })).toEqual({ ok: false, reason: "size" });
    expect(checkPickedFile({ ...pdf, size: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(checkPickedFile({ ...pdf, size: Number.NaN })).toEqual({ ok: false, reason: "empty" });
  });
  it("безопасное имя файла", () => {
    expect(safeFileName("a/b\\c.pdf", "application/pdf")).toBe("a_b_c.pdf");
    expect(safeFileName("", "image/jpeg")).toBe("document.jpg");
    expect(safeFileName("scan.jpeg", "image/jpeg")).toBe("scan.jpeg");
    expect(safeFileName("scan.png", "application/pdf")).toBe("scan.png.pdf");
  });
});

describe("процент загрузки", () => {
  it("считает и для чисел, и для BigInt (iOS отдаёт Int64)", () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(BigInt(50), BigInt(200))).toBe(25);
    expect(progressPercent(BigInt(200), BigInt(200))).toBe(100);
    expect(progressPercent(300, 200)).toBe(100);
    expect(progressPercent(0, 0)).toBeNull();
    expect(progressPercent(10, Number.NaN)).toBeNull();
  });
});

describe("квитанция и ошибки", () => {
  it("квитанция точная и для этого слота", () => {
    expect(parseUploadReceipt(receipt(), SLOT)).toBe(true);
    expect(parseUploadReceipt(receipt({ documentSlotId: VERSION }), SLOT)).toBe(false);
    expect(parseUploadReceipt(receipt({ extra: 1 }), SLOT)).toBe(false);
    expect(parseUploadReceipt(receipt({ byteSize: 0 }), SLOT)).toBe(false);
    expect(parseUploadReceipt(receipt({ declaredMimeType: "image/gif" }), SLOT)).toBe(false);
    expect(parseUploadReceipt({ document: receipt().document, x: 1 }, SLOT)).toBe(false);
    expect(parseUploadReceipt(null, SLOT)).toBe(false);
  });
  it("статусы в ключи строк веба", () => {
    expect(failureOf(400)).toEqual({ error: "errorBadFile", retryable: false });
    expect(failureOf(415).error).toBe("errorBadFile");
    expect(failureOf(413)).toEqual({ error: "errorTooLarge", retryable: false });
    expect(failureOf(422)).toEqual({ error: "errorScan", retryable: false });
    expect(failureOf(403).retryable).toBe(false);
    expect(failureOf(409)).toEqual({ error: "errorConflict", retryable: true });
    expect(failureOf(429)).toEqual({ error: "errorTooMany", retryable: true });
    expect(failureOf(401).error).toBe("docs.errorSession");
    expect(failureOf(500)).toEqual({ error: "errorUnavailable", retryable: true });
  });
});

describe("автомат загрузки", () => {
  it("успех: ключ создан один раз, дальше сброшен, список обновляется", async () => {
    const t = setup([{ status: 201, body: receipt() }]);
    t.controller.select(pdf);
    expect(t.controller.getState()).toMatchObject({ status: "uploading", progress: 0, fileName: "passport.pdf" });
    await t.settle();
    expect(t.controller.getState()).toEqual({ status: "success", fileName: "passport.pdf" });
    expect(t.attempts[0]).toMatchObject({ slotId: SLOT, idempotencyKey: "key-1", mimeType: "application/pdf" });
    expect(t.controller.currentKey()).toBeNull();
    expect(t.uploaded()).toBe(1);
  });

  it("повтор после обрыва шлёт тот же ключ и тот же файл", async () => {
    const t = setup([new TypeError("Network request failed"), { status: 503, body: null }, { status: 201, body: receipt() }]);
    t.controller.select(pdf);
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "errorNetwork", retryable: true });
    t.controller.retry();
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "errorUnavailable", retryable: true });
    t.controller.retry();
    await t.settle();
    expect(t.controller.getState().status).toBe("success");
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1", "key-1"]);
    expect(t.attempts.every((a) => a.file === pdf)).toBe(true);
  });

  it("другой файл получает другой ключ", async () => {
    const t = setup([{ status: 503, body: null }, { status: 201, body: receipt() }]);
    t.controller.select(pdf);
    await t.settle();
    t.controller.select({ ...pdf, uri: "file:///cache/other.pdf", name: "other.pdf" });
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });

  it("окончательный отказ (скан, тип) не повторяется без нового файла", async () => {
    const t = setup([{ status: 422, body: null }]);
    t.controller.select(pdf);
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "errorScan", retryable: false });
    t.controller.retry();
    await t.settle();
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("плохой файл не уходит на сервер и не получает ключ", () => {
    const t = setup([]);
    t.controller.select({ ...pdf, mimeType: "image/heic", name: "IMG.HEIC" });
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "docs.errorType", retryable: false });
    t.controller.select({ ...pdf, size: MAX_UPLOAD_BYTES + 1 });
    expect(t.controller.getState()).toMatchObject({ error: "errorTooLarge" });
    t.controller.select({ ...pdf, size: 0 });
    expect(t.controller.getState()).toMatchObject({ error: "docs.errorEmpty" });
    expect(t.send).not.toHaveBeenCalled();
    expect(t.controller.currentKey()).toBeNull();
  });

  it("отмена прерывает запрос; продолжение идёт с тем же ключом", async () => {
    const t = setup(["hang", { status: 201, body: receipt() }]);
    t.controller.select(pdf);
    await t.settle();
    t.controller.cancel();
    await t.settle();
    expect(t.attempts[0]?.signal.aborted).toBe(true);
    expect(t.controller.getState()).toEqual({ status: "cancelled", fileName: "passport.pdf" });
    t.controller.retry();
    await t.settle();
    expect(t.controller.getState().status).toBe("success");
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1"]);
    expect(t.attempts[1]?.signal.aborted).toBe(false);
  });

  it("прогресс: проценты, затем «подтверждаем» на 100", async () => {
    const t = setup(["hang"]);
    t.controller.select(pdf);
    t.attempts[0]?.onProgress(40.4);
    expect(t.controller.getState()).toMatchObject({ status: "uploading", progress: 40 });
    t.attempts[0]?.onProgress(100);
    expect(t.controller.getState()).toEqual({ status: "confirming", fileName: "passport.pdf" });
    t.controller.cancel();
    await t.settle();
  });

  it("повторный выбор или повтор во время загрузки игнорируются", async () => {
    const t = setup(["hang"]);
    t.controller.select(pdf);
    t.controller.select({ ...pdf, name: "x.pdf" });
    t.controller.retry();
    expect(t.send).toHaveBeenCalledTimes(1);
    t.controller.cancel();
    await t.settle();
  });

  it("201 с неточной квитанцией: ошибка, ключ сохранён для повтора", async () => {
    const t = setup([{ status: 201, body: { document: {} } }, { status: 201, body: receipt() }]);
    t.controller.select(pdf);
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ error: "errorReceipt", retryable: true });
    expect(t.uploaded()).toBe(0);
    t.controller.retry();
    await t.settle();
    expect(t.controller.getState().status).toBe("success");
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1"]);
  });

  it("устаревший ответ после отмены и нового выбора не портит состояние", async () => {
    const t = setup(["hang", { status: 201, body: receipt() }]);
    t.controller.select(pdf);
    t.controller.cancel();
    await t.settle();
    t.controller.select({ ...pdf, name: "second.pdf", uri: "file:///cache/second.pdf" });
    await t.settle();
    expect(t.controller.getState()).toEqual({ status: "success", fileName: "second.pdf" });
  });
});
