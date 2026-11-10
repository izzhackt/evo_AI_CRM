import type { PickedFile } from "@/domain/documents-model";
import { MAX_UPLOAD_BYTES } from "@/domain/documents-model";
import {
  checkReceiptInput,
  minorToDecimal,
  normalizeDay,
  parseReceiptAck,
  ReceiptUploadController,
  receiptFailureKey,
  sendWithRefresh,
  todayInBishkek,
  type ReceiptAttempt,
  type ReceiptInput,
  type ReceiptResponse,
  type ReceiptState,
} from "@/features/payments/receipt-upload";

const OBLIGATION = "a1111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "e5555555-5555-4555-8555-555555555555";
// 2026-11-10 12:00 UTC: в Бишкеке уже 18:00 того же дня
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const jpg: PickedFile = { uri: "file:///cache/chek.jpg", name: "chek.jpg", size: 2000, mimeType: "image/jpeg", source: "photo" };
const input = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({ file: jpg, amount: "100,5", currency: "usd", paidOn: "2026-11-09", obligationId: OBLIGATION, ...over });
const ok: ReceiptResponse = { status: 201, body: { receipt_id: RECEIPT_ID, status: "pending" } };

function setup(responses: (ReceiptResponse | Error)[]) {
  const attempts: ReceiptAttempt[] = [];
  let keys = 0;
  let uploaded = 0;
  const send = jest.fn((attempt: ReceiptAttempt) => {
    attempts.push(attempt);
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? { status: 503, body: null });
  });
  const controller = new ReceiptUploadController(send, () => `key-${++keys}`, () => void (uploaded += 1), () => NOW);
  const states: ReceiptState[] = [];
  controller.subscribe(() => states.push(controller.getState()));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { controller, attempts, states, send, settle, uploaded: () => uploaded };
}

describe("поля и проверки до отправки", () => {
  it("день по Бишкеку и разбор даты", () => {
    expect(todayInBishkek(Date.UTC(2026, 10, 10, 20, 0, 0))).toBe("2026-11-11");
    expect(todayInBishkek(NOW)).toBe("2026-11-10");
    expect(normalizeDay("2026-02-28")).toBe("2026-02-28");
    expect(normalizeDay("5.3.2026")).toBe("2026-03-05");
    expect(normalizeDay(" 05.03.2026 ")).toBe("2026-03-05");
    for (const bad of ["2026-02-30", "2026-13-01", "", "завтра", "2026/01/01"]) expect(normalizeDay(bad)).toBeNull();
  });
  it("сумма превращается в десятичную строку с двумя знаками", () => {
    expect(minorToDecimal("10050")).toBe("100.50");
    expect(minorToDecimal("5")).toBe("0.05");
    expect(minorToDecimal("10000")).toBe("100.00");
  });
  it("годный ввод: поля как отправятся, валюта в верхнем регистре", () => {
    expect(checkReceiptInput(input(), NOW)).toMatchObject({ ok: true, mimeType: "image/jpeg", fields: { amount: "100.50", currency: "USD", paidOn: "2026-11-09", obligationId: OBLIGATION } });
    expect(checkReceiptInput(input({ paidOn: "10.11.2026", obligationId: null }), NOW)).toMatchObject({ ok: true, fields: { paidOn: "2026-11-10", obligationId: null } });
  });
  it.each([
    ["нет файла", { file: null }, "receiptErrorInvalid", "file"],
    ["больше 25 МБ", { file: { ...jpg, size: MAX_UPLOAD_BYTES + 1 } }, "receiptErrorTooLarge", "file"],
    ["пустой файл", { file: { ...jpg, size: 0 } }, "receiptErrorTooLarge", "file"],
    ["HEIC", { file: { ...jpg, name: "a.heic", mimeType: "image/heic" } }, "receiptErrorFileType", "file"],
    ["пустая сумма", { amount: "" }, "receiptErrorInvalid", "amount"],
    ["ноль", { amount: "0" }, "receiptErrorInvalid", "amount"],
    ["три знака после запятой", { amount: "1.234" }, "receiptErrorInvalid", "amount"],
    ["буквы в сумме", { amount: "сто" }, "receiptErrorInvalid", "amount"],
    ["валюта не из трёх букв", { currency: "US" }, "receiptErrorCurrency", "currency"],
    ["дата не дата", { paidOn: "вчера" }, "receiptErrorInvalid", "date"],
    ["дата в будущем (по Бишкеку)", { paidOn: "2026-11-11" }, "receiptErrorDate", "date"],
  ] as const)("отказ до отправки: %s", (_name, over, error, field) => {
    expect(checkReceiptInput(input(over as Partial<ReceiptInput>), NOW)).toEqual({ ok: false, error, field });
  });
  it("сегодняшняя дата по Бишкеку принимается, даже если в UTC ещё вчера", () => {
    const lateUtc = Date.UTC(2026, 10, 10, 20, 0, 0); // 11.11 02:00 в Бишкеке
    expect(checkReceiptInput(input({ paidOn: "2026-11-11" }), lateUtc).ok).toBe(true);
  });
});

describe("ответы сервера", () => {
  it("квитанция строго {receipt_id, status: pending}", () => {
    expect(parseReceiptAck({ receipt_id: RECEIPT_ID, status: "pending" })).toBe(true);
    expect(parseReceiptAck({ receipt_id: RECEIPT_ID, status: "pending", extra: 1 })).toBe(false);
    expect(parseReceiptAck({ receipt_id: "x", status: "pending" })).toBe(false);
    expect(parseReceiptAck({ receipt_id: RECEIPT_ID, status: "accepted" })).toBe(false);
    expect(parseReceiptAck(null)).toBe(false);
  });
  it("код сервера важнее статуса; неизвестное - «не получилось отправить»", () => {
    expect(receiptFailureKey({ status: 409, body: { error: "receipt_duplicate" } })).toBe("receiptErrorDuplicate");
    expect(receiptFailureKey({ status: 422, body: { error: "malware_detected" } })).toBe("receiptErrorScan");
    expect(receiptFailureKey({ status: 400, body: { error: "receipt_invalid_date" } })).toBe("receiptErrorDate");
    expect(receiptFailureKey({ status: 409, body: null })).toBe("receiptErrorDuplicate");
    expect(receiptFailureKey({ status: 413, body: null })).toBe("receiptErrorTooLarge");
    expect(receiptFailureKey({ status: 429, body: { error: "unknown_code" } })).toBe("receiptErrorTooMany");
    expect(receiptFailureKey({ status: 503, body: { error: "malware_scanner_unavailable" } })).toBe("receiptErrorUnavailable");
    expect(receiptFailureKey({ status: 500, body: "boom" })).toBe("receiptErrorUnavailable");
  });
});

describe("ReceiptUploadController", () => {
  it("успех: поля, ключ, один вызов onUploaded; ключ освобождён", async () => {
    const t = setup([ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]).toMatchObject({ idempotencyKey: "key-1", mimeType: "image/jpeg", fields: { amount: "100.50", currency: "USD", paidOn: "2026-11-09", obligationId: OBLIGATION } });
    expect(t.controller.getState()).toEqual({ status: "success" });
    expect(t.uploaded()).toBe(1);
    expect(t.controller.currentKey()).toBeNull();
    expect(t.states[0]).toEqual({ status: "sending", progress: 0 });
  });
  it("200 (повтор с тем же ключом) тоже успех", async () => {
    const t = setup([{ status: 200, body: { receipt_id: RECEIPT_ID, status: "pending" } }]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toEqual({ status: "success" });
  });
  it("409 дубликат: понятная ошибка, ключ освобождён, следующая отправка с новым", async () => {
    const t = setup([{ status: 409, body: { error: "receipt_duplicate" } }, ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "receiptErrorDuplicate", retryable: false });
    expect(t.uploaded()).toBe(0);
    expect(t.controller.currentKey()).toBeNull();
    t.controller.submit(input());
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });
  it("обрыв сети: тот же ключ при повторе с теми же полями; новый при смене суммы или файла", async () => {
    const t = setup([new Error("net"), new Error("net"), ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "receiptErrorUnavailable", retryable: true });
    expect(t.controller.currentKey()).toBe("key-1");
    t.controller.submit(input());
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1"]);
    // поля поменялись: тот же ключ с иным телом нельзя
    t.controller.submit(input({ amount: "101" }));
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1", "key-2"]);
    expect(t.controller.getState()).toEqual({ status: "success" });
  });
  it("5xx: ключ сохраняется для повтора; 503 даёт «не получилось отправить»", async () => {
    const t = setup([{ status: 503, body: { error: "malware_scanner_unavailable" } }, ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "receiptErrorUnavailable", retryable: true });
    t.controller.submit(input());
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1"]);
    expect(t.controller.getState()).toEqual({ status: "success" });
  });
  it("определённый отказ 4xx: новый ключ на следующей отправке", async () => {
    const t = setup([{ status: 422, body: { error: "malware_detected" } }, ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", error: "receiptErrorScan" });
    t.controller.submit(input({ file: { ...jpg, uri: "file:///cache/other.jpg" } }));
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-2"]);
  });
  it("успех с негодной квитанцией: ошибка с повтором тем же ключом, onUploaded не вызван", async () => {
    const t = setup([{ status: 201, body: { receipt_id: "x" } }, ok]);
    t.controller.submit(input());
    await t.settle();
    expect(t.controller.getState()).toMatchObject({ status: "error", retryable: true });
    expect(t.uploaded()).toBe(0);
    t.controller.submit(input());
    await t.settle();
    expect(t.attempts.map((a) => a.idempotencyKey)).toEqual(["key-1", "key-1"]);
  });
  it("проверка до отправки не вызывает сеть и не создаёт ключ", () => {
    const t = setup([ok]);
    t.controller.submit(input({ file: null }));
    expect(t.send).not.toHaveBeenCalled();
    expect(t.controller.getState()).toEqual({ status: "error", error: "receiptErrorInvalid", field: "file", retryable: false });
    expect(t.controller.currentKey()).toBeNull();
    t.controller.submit(input({ paidOn: "2026-11-30" }));
    expect(t.controller.getState()).toMatchObject({ error: "receiptErrorDate", field: "date" });
  });
  it("во время отправки второй вызов игнорируется; прогресс обновляет состояние", async () => {
    let release: (value: ReceiptResponse) => void = () => undefined;
    let progress: (percent: number) => void = () => undefined;
    const send = jest.fn((attempt: ReceiptAttempt) => {
      progress = attempt.onProgress;
      return new Promise<ReceiptResponse>((resolve) => (release = resolve));
    });
    const controller = new ReceiptUploadController(send, () => "k", () => undefined, () => NOW);
    controller.submit(input());
    controller.submit(input());
    expect(send).toHaveBeenCalledTimes(1);
    progress(41.6);
    expect(controller.getState()).toEqual({ status: "sending", progress: 42 });
    release(ok);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getState()).toEqual({ status: "success" });
  });
});

describe("sendWithRefresh", () => {
  it("401: сессия обновляется один раз, повтор идёт с новым токеном", async () => {
    const post = jest.fn(async (token: string): Promise<ReceiptResponse> => (token === "old" ? { status: 401, body: null } : ok));
    const refresh = jest.fn(async () => "new");
    await expect(sendWithRefresh(post, async () => "old", refresh)).resolves.toEqual(ok);
    expect(post.mock.calls.map((c) => c[0])).toEqual(["old", "new"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("обновить не удалось: остаётся 401; без токена сети нет", async () => {
    const post = jest.fn(async (): Promise<ReceiptResponse> => ({ status: 401, body: null }));
    await expect(sendWithRefresh(post, async () => "old", async () => null)).resolves.toEqual({ status: 401, body: null });
    expect(post).toHaveBeenCalledTimes(1);
    const none = jest.fn();
    await expect(sendWithRefresh(none, async () => null)).resolves.toEqual({ status: 401, body: null });
    expect(none).not.toHaveBeenCalled();
  });
});
