import { ProofUploadController, type ProofAttempt, type ProofState } from "@/features/payments/proof-upload";
import type { ReceiptResponse } from "@/features/payments/receipt-upload";

const EVENT = "d4444444-4444-4444-8444-444444444450";
const FILE_ID = "c3333333-3333-4333-8333-333333333333";
const OK: ReceiptResponse = { status: 201, body: { payment_receipt_file_id: FILE_ID, original_filename: "chek.jpg" } };
const file = { uri: "file:///cache/chek.jpg", name: "chek.jpg", size: 2000, mimeType: "image/jpeg", source: "photo" as const };

function setup(responses: (ReceiptResponse | Error)[]) {
  const attempts: ProofAttempt[] = [];
  let n = 0;
  let uploaded = 0;
  const controller = new ProofUploadController(
    async (attempt) => {
      attempts.push(attempt);
      const next = responses.shift() ?? { status: 503, body: null };
      if (next instanceof Error) throw next;
      return next;
    },
    () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    () => void uploaded++,
  );
  const settle = async (): Promise<ProofState> => {
    for (let i = 0; i < 20 && controller.busy(); i++) await Promise.resolve();
    return controller.getState();
  };
  return { controller, attempts, settle, uploaded: () => uploaded };
}

describe("ProofUploadController", () => {
  it("успех: разбирает ответ, освобождает ключ, обновляет данные", async () => {
    const { controller, attempts, settle, uploaded } = setup([OK]);
    controller.submit(EVENT, file);
    const state = await settle();
    expect(state).toEqual({ status: "success", result: { fileId: FILE_ID, filename: "chek.jpg" } });
    expect(attempts[0]).toMatchObject({ paymentEventId: EVENT, mimeType: "image/jpeg" });
    expect(controller.currentKey()).toBeNull();
    expect(uploaded()).toBe(1);
  });

  it("ответ не той формы: файл считается сохранённым, ссылки нет", async () => {
    const { controller, settle } = setup([{ status: 200, body: { x: 1 } }]);
    controller.submit(EVENT, file);
    expect(await settle()).toEqual({ status: "success", result: null });
  });

  it("обрыв сети и 5xx: тот же ключ при повторе; другой файл - новый ключ", async () => {
    const { controller, attempts, settle } = setup([new Error("net"), { status: 503, body: null }, OK, OK]);
    controller.submit(EVENT, file);
    expect(await settle()).toMatchObject({ status: "error", error: "receiptErrorUnavailable", retryable: true });
    controller.submit(EVENT, file);
    await settle();
    controller.submit(EVENT, file);
    await settle();
    expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(1);
    controller.submit(EVENT, { ...file, uri: "file:///cache/other.jpg" });
    await settle();
    expect(new Set(attempts.map((a) => a.idempotencyKey)).size).toBe(2);
  });

  it("определённый отказ освобождает ключ и даёт строку по коду", async () => {
    const { controller, settle } = setup([{ status: 413, body: { error: "file_too_large" } }]);
    controller.submit(EVENT, file);
    const state = await settle();
    expect(state).toMatchObject({ status: "error", retryable: false });
    expect(controller.currentKey()).toBeNull();
  });

  it("409 proof_exists: не ошибка, данные обновляются", async () => {
    const { controller, settle, uploaded } = setup([{ status: 409, body: { error: "proof_exists" } }]);
    controller.submit(EVENT, file);
    expect(await settle()).toEqual({ status: "idle" });
    expect(uploaded()).toBe(1);
  });

  it("файл не выбран, не тот тип или пустой: ошибка до отправки", async () => {
    const { controller, attempts } = setup([OK]);
    controller.submit(EVENT, null);
    expect(controller.getState()).toMatchObject({ status: "error", error: "receiptErrorInvalid" });
    controller.submit(EVENT, { ...file, name: "x.exe", mimeType: "application/octet-stream" });
    expect(controller.getState()).toMatchObject({ status: "error", error: "receiptErrorFileType" });
    controller.submit(EVENT, { ...file, size: 30 * 1024 * 1024 });
    expect(controller.getState()).toMatchObject({ status: "error", error: "receiptErrorTooLarge" });
    expect(attempts).toHaveLength(0);
  });
});
