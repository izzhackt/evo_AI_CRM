import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import type { PaymentsIo } from "@/features/payments/io";
import type { ReceiptAttempt, ReceiptResponse } from "@/features/payments/receipt-upload";
import { PaymentsScreen } from "@/features/payments/PaymentsScreen";
import { OBLIGATION_ID, QR_ID, RECEIPT_FILE_ID, paymentCenterRow, paymentDueRow, paymentEntryRow } from "@/test-fixtures/rpc-rows";
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
jest.mock("@/features/payments/native", () => ({ createReceiptSend: jest.fn() }));

const navigate = router.navigate as jest.Mock;
const ACK: ReceiptResponse = { status: 201, body: { receipt_id: "e5555555-5555-4555-8555-555555555555", status: "pending" } };
const REJECTED_ID = "d4444444-4444-4444-8444-444444444445";

function makeIo(responses: ReceiptResponse[] = [ACK]) {
  const attempts: ReceiptAttempt[] = [];
  const downloads: string[] = [];
  const opened: string[] = [];
  const io: PaymentsIo = {
    pick: jest.fn(async () => ({ kind: "picked" as const, file: { uri: "file:///cache/chek.jpg", name: "chek.jpg", size: 2000, mimeType: "image/jpeg", source: "photo" as const } })),
    createUploadSend: jest.fn(),
    createReceiptSend: () => async (attempt) => {
      attempts.push(attempt);
      return responses.shift() ?? { status: 503, body: null };
    },
    createDownloadDeps: () => ({
      baseUrl: "https://portal.example.test",
      getToken: async () => "t",
      fetchImpl: async (url) => {
        downloads.push(url);
        return { status: 200, ok: true, headers: new Headers({ "content-type": url.includes("payment_details_qr") ? "image/png" : "image/jpeg" }), arrayBuffer: async () => new Uint8Array([1]).buffer };
      },
      writeFile: async (name) => `file:///cache/${name}`,
    }),
    openLocalFile: jest.fn(async (uri: string) => void opened.push(uri)),
  };
  return { io, attempts, downloads, opened };
}

beforeEach(() => navigate.mockClear());

const center = (over: Record<string, unknown> = {}) => fakeTransport({ student_portal_payment_center_v1: paymentCenterRow(over) });

describe("Оплата: платежи и история", () => {
  it("платёж: статус, суммы, следующий шаг, история с датой, статусом и «Открыть чек»; читается одним RPC в режиме GET", async () => {
    const { transport, calls } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Услуги EVO")).toBeTruthy();
    expect(screen.getByText("Платежи")).toBeTruthy();
    expect(screen.queryByText("Начисления")).toBeNull();
    expect(screen.getByText("оплачено частично")).toBeTruthy();
    expect(screen.getByTestId("amount-0").props.children).toContain("100");
    expect(screen.getByText(/Оплатить остаток/)).toBeTruthy();
    expect(screen.getByTestId("payment-0-entry-0-amount").props.children).toContain("40");
    expect(screen.getByText(/03\.11\.2026/)).toBeTruthy();
    expect(screen.getByText("На проверке")).toBeTruthy();
    expect(screen.getByTestId("payment-0-entry-0-open")).toBeTruthy();
    expect(screen.queryByTestId("how-to-pay")).toBeNull();
    expect(calls[0]).toMatchObject({ name: "student_portal_payment_center_v1", get: true });
    expect(calls.find((c) => c.name === "student_portal_finance_v2")).toBeUndefined();
  });

  it("принятая и отклонённая запись: тон, причина отказа, «Приложить снова» только у отклонённой", async () => {
    const entries = [paymentEntryRow({ status: "accepted", kind: "payment", entry_id: "d4444444-4444-4444-8444-444444444446", file_kind: "receipt" }), paymentEntryRow({ status: "rejected", reject_reason: "Не видна сумма", entry_id: REJECTED_ID })];
    const { transport } = center({ dues: [paymentDueRow({ entries })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Принято")).toBeTruthy();
    expect(screen.getByText("Отклонено")).toBeTruthy();
    expect(screen.getByTestId("payment-0-entry-1-reason")).toHaveTextContent(/Не видна сумма/);
    expect(screen.queryByTestId("payment-0-entry-0-again")).toBeNull();
    await fireEvent.press(screen.getByTestId("payment-0-entry-1-again"));
    // форма открыта с суммой и датой отклонённого чека
    expect(screen.getByTestId("receipt-amount").props.value).toBe("40");
    expect(screen.getByTestId("receipt-date").props.value).toBe("2026-11-03");
  });

  it("«Открыть чек» качает через case-files/{вид}/{id}/download и открывает файл", async () => {
    const { transport } = center();
    const { io, downloads, opened } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("payment-0-entry-0-open"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(downloads).toEqual([`https://portal.example.test/api/portal/case-files/student_receipt/${RECEIPT_FILE_ID}/download`]);
    expect(opened[0]).toMatch(/chek\.jpg$/);
  });

  it("запись без файла: «Открыть чек» нет", async () => {
    const entry = paymentEntryRow({ file_kind: null, file_id: null, filename: null, kind: "refund", status: "accepted" });
    const { transport } = center({ dues: [paymentDueRow({ entries: [entry] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Возврат · 03.11.2026")).toBeTruthy();
    expect(screen.queryByTestId("payment-0-entry-0-open")).toBeNull();
  });
});

describe("Оплата: «Как оплатить»", () => {
  it("нет реквизитов: блока нет", async () => {
    const { transport } = center({ details: null });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByText("Услуги EVO");
    expect(screen.queryByText("Как оплатить")).toBeNull();
    expect(screen.queryByTestId("how-to-pay")).toBeNull();
  });

  it("реквизиты с QR: текст и картинка из локального файла; QR качается как payment_details_qr", async () => {
    const details = { text: "Реквизиты: тестовый счёт 000", has_qr: true, qr_id: QR_ID, updated_at: "2026-11-01T08:00:00+00:00" };
    const { transport } = center({ details });
    const { io, downloads } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    expect(await screen.findByText("Как оплатить")).toBeTruthy();
    expect(screen.getByTestId("how-to-pay-text")).toHaveTextContent("Реквизиты: тестовый счёт 000");
    const qr = await screen.findByTestId("how-to-pay-qr");
    expect(qr.props.accessibilityLabel).toBe("QR-код для оплаты");
    expect(downloads).toEqual([`https://portal.example.test/api/portal/case-files/payment_details_qr/${QR_ID}/download`]);
  });

  it("реквизиты без QR: только текст, QR не качается", async () => {
    const details = { text: "Только текст", has_qr: false, qr_id: null, updated_at: "2026-11-01T08:00:00+00:00" };
    const { transport } = center({ details });
    const { io, downloads } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    expect(await screen.findByText("Только текст")).toBeTruthy();
    expect(screen.queryByTestId("how-to-pay-qr")).toBeNull();
    expect(downloads).toHaveLength(0);
  });
});

describe("Оплата: пусто, сбой, права", () => {
  it("пусто: объяснение, «Написать куратору» ведёт в чат, чек без платежа доступен", async () => {
    const { transport } = center({ dues: [], unassigned: [] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Платежей пока нет")).toBeTruthy();
    expect(screen.getByText("Если вам сказали оплатить, напишите куратору.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("payments-write-evo"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    await fireEvent.press(screen.getByTestId("receipt-attach-loose"));
    expect(screen.getByTestId("receipt-loose-form")).toBeTruthy();
  });

  it("сбой чтения: плашка с повтором", async () => {
    const bad = fakeTransport({ student_portal_payment_center_v1: failure(null, 503) });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(bad.transport));
    expect(await screen.findByTestId("payments-error")).toBeTruthy();
    expect(screen.getByText("Не удалось загрузить платежи. Обновите страницу чуть позже.")).toBeTruthy();
  });

  it("чужая форма ответа тоже сбой чтения", async () => {
    const wrong = fakeTransport({ student_portal_payment_center_v1: { dues: [] } });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(wrong.transport));
    expect(await screen.findByTestId("payments-error")).toBeTruthy();
  });

  it("canUpload=false: кнопок «Приложить чек» нет, история видна", async () => {
    const { transport } = center({ can_upload: false });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByText("Услуги EVO");
    expect(screen.queryByTestId("receipt-attach-0")).toBeNull();
    expect(screen.queryByTestId("receipt-attach-loose")).toBeNull();
    expect(screen.queryByTestId("receipts-unassigned")).toBeNull();
    expect(screen.getByTestId("payment-0-entry-0")).toBeTruthy();
  });

  it("чеки без платежа: список и кнопка", async () => {
    const loose = paymentEntryRow({ entry_id: "d4444444-4444-4444-8444-444444444447", amount_minor: 2500, status: "rejected", reject_reason: "Размыто" });
    const { transport } = center({ unassigned: [loose] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Чеки без платежа")).toBeTruthy();
    expect(screen.getByTestId("unassigned-0-reason")).toHaveTextContent(/Размыто/);
    expect(screen.getByTestId("receipt-attach-loose")).toBeTruthy();
  });
});

describe("Оплата: приложить чек", () => {
  async function fillAndPick(prefix: string, io: PaymentsIo, over: { amount?: string; date?: string } = {}) {
    if (over.amount !== undefined) await fireEvent.changeText(screen.getByTestId(`${prefix}-amount`), over.amount);
    if (over.date !== undefined) await fireEvent.changeText(screen.getByTestId(`${prefix}-date`), over.date);
    jest.useFakeTimers();
    try {
      await fireEvent.press(screen.getByTestId(`${prefix}-pick`));
      await fireEvent.press(screen.getByTestId("pick-photo"));
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(io.pick).toHaveBeenCalledWith("photo"));
    await screen.findByText(/chek\.jpg/);
  }

  it("к платежу: форма с валютой платежа и остатком; отправка с ключом, полями; сообщение об успехе и повторное чтение", async () => {
    const { transport, calls } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("receipt-attach-0"));
    expect(screen.getByTestId("receipt-amount").props.value).toBe("60");
    expect(screen.getByTestId("receipt-currency")).toHaveTextContent("USD");
    await fillAndPick("receipt", io, { amount: "59,5", date: "2026-11-01" });
    await fireEvent.press(screen.getByTestId("receipt-submit"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(attempts[0]).toMatchObject({ mimeType: "image/jpeg", fields: { amount: "59.50", currency: "USD", paidOn: "2026-11-01", obligationId: OBLIGATION_ID } });
    expect(await screen.findByTestId("receipt-sent")).toHaveTextContent("Чек отправлен на проверку. Оплата засчитается, когда куратор его примет.");
    expect(screen.queryByTestId("receipt-form")).toBeNull();
    await waitFor(() => expect(calls.filter((c) => c.name === "student_portal_payment_center_v1").length).toBeGreaterThan(1));
  });

  it("без платежа: валюта вводится, поле payment_obligation_id пусто", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("receipt-attach-loose"));
    await fireEvent.changeText(screen.getByTestId("receipt-loose-currency"), "kgs");
    await fillAndPick("receipt-loose", io, { amount: "1 000", date: "10.11.2026" });
    await fireEvent.press(screen.getByTestId("receipt-loose-submit"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.fields).toEqual({ amount: "1000.00", currency: "KGS", paidOn: "2026-11-10", obligationId: null });
  });

  it("проверки до отправки: без файла, дата в будущем; сеть не вызывается", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("receipt-attach-0"));
    await fireEvent.press(screen.getByTestId("receipt-submit"));
    expect(await screen.findByText("Проверьте сумму, валюту, дату и файл.")).toBeTruthy();
    await fillAndPick("receipt", io, { date: "2999-01-01" });
    await fireEvent.press(screen.getByTestId("receipt-submit"));
    expect(await screen.findByText("Проверьте дату оплаты: она не может быть в будущем.")).toBeTruthy();
    expect(attempts).toHaveLength(0);
  });

  it("отказ сервера (409): текст ошибки по коду, форма остаётся", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo([{ status: 409, body: { error: "receipt_duplicate" } }]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("receipt-attach-0"));
    await fillAndPick("receipt", io);
    await fireEvent.press(screen.getByTestId("receipt-submit"));
    expect(await screen.findByText("Этот чек уже отправлен.")).toBeTruthy();
    expect(attempts).toHaveLength(1);
    expect(screen.getByTestId("receipt-form")).toBeTruthy();
    expect(screen.queryByTestId("receipt-sent")).toBeNull();
  });

  it("отмена закрывает форму без отправки", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("receipt-attach-0"));
    await fireEvent.press(screen.getByTestId("receipt-cancel"));
    expect(screen.queryByTestId("receipt-form")).toBeNull();
    expect(attempts).toHaveLength(0);
  });
});
