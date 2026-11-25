import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo } from "react-native";

import type { PaymentsIo } from "@/features/payments/io";
import type { ProofAttempt } from "@/features/payments/proof-upload";
import { todayInBishkek, type ReceiptAttempt, type ReceiptResponse } from "@/features/payments/receipt-upload";
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
jest.mock("@/features/payments/native", () => ({ createReceiptSend: jest.fn(), createProofSend: jest.fn(), copyText: jest.fn() }));

const navigate = router.navigate as jest.Mock;
const announceMock = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
const ACK: ReceiptResponse = { status: 201, body: { receipt_id: "e5555555-5555-4555-8555-555555555555", status: "pending" } };
const REJECTED_ID = "d4444444-4444-4444-8444-444444444445";
const RECEIPT_SENT = "Чек отправлен на проверку. Оплата засчитается, когда куратор его примет.";
const PHOTO = { uri: "file:///cache/chek.jpg", name: "chek.jpg", size: 2000, mimeType: "image/jpeg", source: "photo" as const };

function makeIo(responses: ReceiptResponse[] = [ACK], proofResponses: ReceiptResponse[] = [], picked: typeof PHOTO | Record<string, unknown> = PHOTO) {
  const attempts: ReceiptAttempt[] = [];
  const proofs: ProofAttempt[] = [];
  const copied: string[] = [];
  const copyResult = { ok: true };
  const downloads: string[] = [];
  const opened: string[] = [];
  const io: PaymentsIo = {
    pick: jest.fn(async () => ({ kind: "picked" as const, file: picked as typeof PHOTO })),
    createUploadSend: jest.fn(),
    createReceiptSend: () => async (attempt) => {
      attempts.push(attempt);
      return responses.shift() ?? { status: 503, body: null };
    },
    createProofSend: () => async (attempt) => {
      proofs.push(attempt);
      return proofResponses.shift() ?? { status: 503, body: null };
    },
    copyText: jest.fn(async (value: string) => {
      copied.push(value);
      return copyResult.ok;
    }),
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
  return { io, attempts, downloads, opened, proofs, copied, copyResult };
}

beforeEach(() => {
  navigate.mockClear();
  announceMock.mockClear();
});

const center = (over: Record<string, unknown> = {}) => fakeTransport({ student_portal_payment_center_v1: paymentCenterRow(over) });
/** Первый ответ - как дан, следующие - после того, как данные «обновились» (чек появился, файл приложен). */
const changing = (first: Record<string, unknown>, later: Record<string, unknown>) =>
  fakeTransport({ student_portal_payment_center_v1: (_args: unknown, call: number) => paymentCenterRow(call === 1 ? first : later) });

/** Нажать кнопку, выбрать «Фото» в листе и дождаться выбранного файла (на iOS лист закрывается 700 мс, пока таймер не пройдёт, выбора нет). */
async function choosePhoto(openTestId: string, io: PaymentsIo) {
  jest.useFakeTimers();
  try {
    await fireEvent.press(await screen.findByTestId(openTestId));
    await fireEvent.press(screen.getByTestId("pick-photo"));
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
  } finally {
    jest.useRealTimers();
  }
  await waitFor(() => expect(io.pick).toHaveBeenCalledWith("photo"));
}

const paymentCenterCalls = (calls: { name: string }[]) => calls.filter((c) => c.name === "student_portal_payment_center_v1").length;
const ENTRY_ID = (n: number) => `d4444444-4444-4444-8444-4444444444${String(n).padStart(2, "0")}`;

describe("Оплата: страница как на сайте (#1452)", () => {
  it("шапка «Платежи» с заметкой про Бишкек и кнопкой «Добавить платёж»; нет «Чеков без платежа»; читается одним RPC в режиме GET", async () => {
    const { transport, calls } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-title")).toHaveTextContent("Услуги EVO");
    expect(screen.getByTestId("title-payments")).toHaveTextContent("Оплата");
    expect(screen.getByText("Платежи")).toBeTruthy();
    expect(screen.getByText("Сроки указаны по времени Бишкека.")).toBeTruthy();
    expect(screen.getByTestId("payments-add")).toHaveTextContent("Добавить платёж");
    expect(screen.queryByText("Чеки без платежа")).toBeNull();
    expect(screen.queryByText("Приложить чек без платежа")).toBeNull();
    expect(screen.queryByText("Оплаты и чеки")).toBeNull();
    expect(screen.queryByText("Начисления")).toBeNull();
    expect(calls[0]).toMatchObject({ name: "student_portal_payment_center_v1", get: true });
    expect(calls.find((c) => c.name === "student_portal_finance_v2")).toBeUndefined();
  });

  it("заголовок услуги - категория, а не «Получено в USD»", async () => {
    const { transport } = center({ dues: [paymentDueRow({ label: "Получено в USD" })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-title")).toHaveTextContent("Услуги EVO");
    expect(screen.queryByText("Получено в USD")).toBeNull();
    expect(screen.queryByTestId("payment-0-name")).toBeNull();
  });

  it("настоящее имя транша под заголовком, когда оно одно и отличается от заголовка", async () => {
    const { transport } = center({ dues: [paymentDueRow({ label: "Первый платёж" })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-name")).toHaveTextContent("Первый платёж");
  });

  it("суммы услуги: К оплате, Оплачено с «на проверке», Осталось; следующий шаг", async () => {
    const { transport } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("amount-toPay-0")).toHaveTextContent(/100/);
    expect(screen.getByTestId("amount-paid-0")).toHaveTextContent(/40/);
    expect(screen.getByTestId("amount-paid-aside-0")).toHaveTextContent(/40.*на проверке/);
    expect(screen.getByTestId("amount-outstanding-0")).toHaveTextContent(/60/);
    expect(screen.queryByTestId("amount-refunded-0")).toBeNull();
    expect(screen.getByText("К оплате")).toBeTruthy();
    expect(screen.getByText("Оплачено")).toBeTruthy();
    expect(screen.getByText("Осталось")).toBeTruthy();
    expect(screen.getByTestId("payment-0-next")).toHaveTextContent("Следующий шаг: Оплатить остаток");
  });

  it("«Возвращено» появляется, только когда есть возврат; возврат в таблице со знаком минус", async () => {
    const refund = paymentEntryRow({ kind: "refund", status: "accepted", entry_id: ENTRY_ID(31), amount_minor: 1000, on_date: "2026-10-20", file_kind: null, file_id: null, filename: null });
    const { transport } = center({ dues: [paymentDueRow({ paid_minor: 6000, refunded_minor: 1000, outstanding_minor: 5000, entries: [refund] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("amount-refunded-0")).toHaveTextContent(/10/);
    expect(screen.getByText("Возвращено")).toBeTruthy();
    expect(screen.getByTestId("payment-0-entry-0-amount")).toHaveTextContent(/^\u2212/);
    expect(screen.getByTestId("payment-0-entry-0-status")).toHaveTextContent("Возврат");
  });

  it("полоса: зачтённое и чеки на проверке, подпись и значение для читалки", async () => {
    const { transport } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    const bar = await screen.findByTestId("payment-0-bar");
    expect(bar.props.accessibilityRole).toBe("progressbar");
    expect(bar.props.accessibilityLabel).toMatch(/^Оплачено .*40.* из .*100.*\. .*40.* на проверке$/);
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
    expect(screen.getByTestId("payment-0-bar-paid").props.style.width).toBe("40%");
    expect(screen.getByTestId("payment-0-bar-review").props.style.width).toBe("40%");
  });

  it("одна таблица: у строки Дата, Сумма, Чек, Статус; чек на проверке - ссылка и «На проверке»; остаток без чека - «Нет чека» и «Приложить чек»", async () => {
    const { transport } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    const row = await screen.findByTestId("payment-0-entry-0");
    // подпись «Чек» скрыта от читалки (у кнопок ячейки свои имена с датой и суммой), но на экране она есть
    for (const column of ["Дата", "Сумма", "Чек", "Статус"]) expect(within(row).getByText(column, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("payment-0-entry-0-date")).toHaveTextContent("03.11.2026");
    expect(screen.getByTestId("payment-0-entry-0-amount")).toHaveTextContent(/^40/);
    expect(screen.getByTestId("payment-0-entry-0-open")).toHaveTextContent("chek.jpg");
    expect(screen.getByTestId("payment-0-entry-0-status")).toHaveTextContent("На проверке");
    expect(screen.queryByTestId("payment-0-entry-0-slot-attach")).toBeNull();
    // остаток 60 минус чек на проверке 40 = 20 без чека: своя строка со сроком транша
    expect(screen.getByTestId("payment-0-entry-1-date")).toHaveTextContent("01.12.2026");
    expect(screen.getByTestId("payment-0-entry-1-amount")).toHaveTextContent(/^20/);
    expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("Нет чека");
    const attach = screen.getByTestId("payment-0-entry-1-slot-attach");
    expect(attach).toHaveTextContent("Приложить чек");
    expect(attach.props.accessibilityLabel).toMatch(/^Приложить чек: 01\.12\.2026, .*20/);
    expect(screen.queryByTestId("payment-0-entry-2")).toBeNull();
  });

  it("просрочка: у строки «Нет чека» красная метка «просрочено»", async () => {
    const { transport } = center({ dues: [paymentDueRow({ overdue: true, derived_status: "overdue", entries: [] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-entry-0-overdue")).toHaveTextContent("просрочено");
    expect(screen.getByTestId("payment-0-entry-0-status")).toHaveTextContent("Нет чека");
  });

  it("принятая и отклонённая запись: «Принято» и «Отклонён» (как на сайте), причина отказа красным", async () => {
    const accepted = paymentEntryRow({ status: "accepted", kind: "payment", entry_id: ENTRY_ID(46), file_kind: "receipt" });
    const rejected = paymentEntryRow({ status: "rejected", reject_reason: "Не видна сумма", entry_id: REJECTED_ID, on_date: "2026-11-04" });
    const { transport } = center({ dues: [paymentDueRow({ entries: [accepted, rejected] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-entry-0-status")).toHaveTextContent("Принято");
    expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("Отклонён");
    expect(screen.queryByText("Отклонено")).toBeNull();
    expect(screen.getByTestId("payment-0-entry-1-reason")).toHaveTextContent("Не видна сумма");
  });

  it("«Открыть чек» качает через case-files/{вид}/{id}/download и открывает файл; имя файла - ссылка", async () => {
    const { transport } = center();
    const { io, downloads, opened } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    const link = await screen.findByTestId("payment-0-entry-0-open");
    expect(link.props.accessibilityRole).toBe("link");
    expect(link.props.accessibilityLabel).toBe("Открыть чек chek.jpg");
    await fireEvent.press(link);
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(downloads).toEqual([`https://portal.example.test/api/portal/case-files/student_receipt/${RECEIPT_FILE_ID}/download`]);
    expect(opened[0]).toMatch(/chek\.jpg$/);
  });

  it("запись без файла: ссылки на чек нет, в ячейке тире", async () => {
    const entry = paymentEntryRow({ file_kind: null, file_id: null, filename: null, kind: "refund", status: "accepted" });
    const { transport } = center({ dues: [paymentDueRow({ entries: [entry] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-entry-0-status")).toHaveTextContent("Возврат");
    expect(screen.queryByTestId("payment-0-entry-0-open")).toBeNull();
    expect(within(screen.getByTestId("payment-0-entry-0-receipt")).getByText("—", { includeHiddenElements: true })).toBeTruthy();
  });

  it("несколько услуг и валют: каждая под своим заголовком со своими суммами, между ними черта", async () => {
    const kgs = paymentDueRow({ obligation_id: "a1111111-1111-4111-8111-111111111112", currency: "KGS", label: "Оплата по договору", category: "third_party_cost", amount_minor: 5000000, paid_minor: 0, outstanding_minor: 5000000, entries: [], next_action: null });
    const { transport } = center({ dues: [paymentDueRow(), kgs] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-title")).toHaveTextContent("Услуги EVO");
    expect(screen.getByTestId("payment-1-title")).toHaveTextContent("Сторонние расходы");
    expect(screen.getByTestId("payment-1-name")).toHaveTextContent("Оплата по договору");
    expect(screen.getByTestId("amount-toPay-1")).toHaveTextContent(/50\s?000.*сом/);
    expect(screen.getByTestId("payment-1-entry-0-status")).toHaveTextContent("Нет чека");
  });

  it("по-кыргызски: слова из общего словаря сайта", async () => {
    const { transport } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport), "ky");
    expect(await screen.findByText("Төлөмдөр")).toBeTruthy();
    expect(screen.getByTestId("title-payments")).toHaveTextContent("Төлөм");
    expect(screen.getByTestId("payments-add")).toHaveTextContent("Төлөм кошуу");
    expect(screen.getByTestId("payment-0-entry-0-status")).toHaveTextContent("Текшерилүүдө");
    expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("Чек жок");
    expect(screen.getByTestId("payment-0-entry-1-slot-attach")).toHaveTextContent("Чек тиркөө");
  });
});

describe("Оплата: когда чек можно приложить или заменить (G32)", () => {
  const review = (n: number, minor: number) => paymentEntryRow({ entry_id: ENTRY_ID(n), status: "review", amount_minor: minor });
  const rejected = (n: number, minor: number) => paymentEntryRow({ entry_id: ENTRY_ID(n), status: "rejected", amount_minor: minor, reject_reason: "Размыто" });

  it("весь остаток закрыт чеками на проверке: строки «Нет чека» и «Приложить чек» нет", async () => {
    const { transport } = center({ dues: [paymentDueRow({ amount_minor: 4000, paid_minor: 0, outstanding_minor: 4000, derived_status: "pending", entries: [review(50, 4000)] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByTestId("payment-0-entry-0");
    expect(screen.queryByTestId("payment-0-entry-1")).toBeNull();
    expect(screen.queryByTestId("payment-0-entry-0-slot-attach")).toBeNull();
    expect(screen.queryByText("Приложить чек")).toBeNull();
  });

  it("платёж оплачен целиком: ни «Приложить чек», ни «Заменить» (отклонённый чек остаётся историей с причиной)", async () => {
    const paid = paymentEntryRow({ kind: "payment", status: "accepted", entry_id: ENTRY_ID(51), amount_minor: 10000, file_kind: "receipt", on_date: "2026-11-07" });
    const { transport } = center({ dues: [paymentDueRow({ paid_minor: 10000, outstanding_minor: 0, derived_status: "paid", entries: [rejected(52, 10000), paid] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByTestId("payment-0-entry-0-reason")).toHaveTextContent("Размыто");
    expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("Принято");
    expect(screen.queryByText("Приложить чек")).toBeNull();
    expect(screen.queryByText("Заменить")).toBeNull();
  });

  it("отклонённый чек: «Заменить» у него, «Приложить чек» у непокрытого остатка", async () => {
    const { transport } = center({ dues: [paymentDueRow({ entries: [rejected(53, 4000)] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    const replace = await screen.findByTestId("payment-0-entry-0-slot-replace");
    expect(replace).toHaveTextContent("Заменить");
    expect(replace.props.accessibilityLabel).toMatch(/^Заменить: 03\.11\.2026, .*40/);
    expect(screen.getByTestId("payment-0-entry-1-slot-attach")).toBeTruthy();
  });

  it("пока по платежу есть чек на проверке, «Заменить» у отклонённого нет", async () => {
    const { transport } = center({ dues: [paymentDueRow({ entries: [rejected(54, 2000), review(55, 4000)] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByTestId("payment-0-entry-0");
    expect(screen.queryByText("Заменить")).toBeNull();
  });

  it("нет права загрузки (canUpload=false): ни одной кнопки чека, ни «Добавить платёж»; история видна", async () => {
    const { transport } = center({ can_upload: false, dues: [paymentDueRow({ entries: [rejected(56, 4000), paymentEntryRow({ kind: "payment", status: "accepted", entry_id: ENTRY_ID(57), file_kind: null, file_id: null, filename: null })] })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByTestId("payment-0-entry-0");
    expect(screen.queryByText("Приложить чек")).toBeNull();
    expect(screen.queryByText("Заменить")).toBeNull();
    expect(screen.queryByTestId("payments-add")).toBeNull();
    expect(screen.getByTestId("payment-0-entry-0-status")).toHaveTextContent("Принято");
    expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("Отклонён");
  });
});

describe("Оплата: чек у строки - только файл (D8)", () => {
  it("«Приложить чек» у остатка: сумма, валюта и дата не вводятся; отправка с полями строки, ключом, сообщение, перечитывание, озвучка", async () => {
    const { transport, calls } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-1-slot-attach", io);
    const row = screen.getByTestId("payment-0-entry-1");
    expect(within(row).queryAllByDisplayValue(/.*/)).toHaveLength(0);
    expect(screen.queryByText("Фото или PDF чека")).toBeNull();
    expect(await screen.findByTestId("payment-0-entry-1-slot-file-name")).toHaveTextContent("chek.jpg");
    expect(screen.queryByTestId("payment-0-entry-1-slot-attach")).toBeNull();
    await fireEvent.press(screen.getByTestId("payment-0-entry-1-slot-save"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // сумма - непокрытая часть остатка (20), валюта - платежа, день - сегодня по Бишкеку, платёж - строки
    expect(attempts[0]).toMatchObject({ mimeType: "image/jpeg", fields: { amount: "20.00", currency: "USD", paidOn: todayInBishkek(), obligationId: OBLIGATION_ID } });
    expect(await screen.findByTestId("payment-0-entry-1-slot-sent")).toHaveTextContent(RECEIPT_SENT);
    expect(announceMock).toHaveBeenCalledWith(RECEIPT_SENT);
    await waitFor(() => expect(paymentCenterCalls(calls)).toBeGreaterThan(1));
  });

  it("после перечитывания строка «Нет чека» заменяется строкой «На проверке» с файлом", async () => {
    const second = paymentEntryRow({ entry_id: ENTRY_ID(60), amount_minor: 2000, on_date: "2026-11-25", filename: "new.jpg" });
    const { transport } = changing({}, { dues: [paymentDueRow({ entries: [paymentEntryRow(), second] })] });
    const { io } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-1-slot-attach", io);
    await fireEvent.press(screen.getByTestId("payment-0-entry-1-slot-save"));
    await waitFor(() => expect(screen.getByTestId("payment-0-entry-1-status")).toHaveTextContent("На проверке"));
    expect(screen.getByTestId("payment-0-entry-1-open")).toHaveTextContent("new.jpg");
    expect(screen.queryByText("Приложить чек")).toBeNull();
    expect(screen.queryByTestId("payment-0-entry-2")).toBeNull();
  });

  it("«Заменить»: поля отклонённого чека (его сумма и день), платёж строки; файл выбирается так же", async () => {
    const rejected = paymentEntryRow({ entry_id: REJECTED_ID, status: "rejected", reject_reason: "Не видна сумма", amount_minor: 4000, on_date: "2026-11-03" });
    const { transport } = center({ dues: [paymentDueRow({ entries: [rejected] })] });
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-0-slot-replace", io);
    await fireEvent.press(await screen.findByTestId("payment-0-entry-0-slot-save"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.fields).toEqual({ amount: "40.00", currency: "USD", paidOn: "2026-11-03", obligationId: OBLIGATION_ID });
  });

  it("файл можно убрать до отправки; «Сохранить» без файла нет", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-1-slot-attach", io);
    await fireEvent.press(await screen.findByTestId("payment-0-entry-1-slot-file-clear"));
    expect(screen.queryByTestId("payment-0-entry-1-slot-save")).toBeNull();
    expect(screen.getByTestId("payment-0-entry-1-slot-attach")).toBeTruthy();
    expect(attempts).toHaveLength(0);
  });

  it("не тот тип файла (HEIC): понятная строка, сеть не вызывается", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo([ACK], [], { uri: "file:///cache/a.heic", name: "a.heic", size: 2000, mimeType: "image/heic", source: "photo" });
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-1-slot-attach", io);
    await fireEvent.press(await screen.findByTestId("payment-0-entry-1-slot-save"));
    expect(await screen.findByTestId("payment-0-entry-1-slot-error")).toHaveTextContent("Выберите PDF, JPG или PNG.");
    expect(attempts).toHaveLength(0);
  });

  it("отказ сервера (409 дубликат): текст по коду, файл остаётся для повтора, сообщения об успехе нет", async () => {
    const { transport } = center();
    const { io, attempts } = makeIo([{ status: 409, body: { error: "receipt_duplicate" } }]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("payment-0-entry-1-slot-attach", io);
    await fireEvent.press(await screen.findByTestId("payment-0-entry-1-slot-save"));
    expect(await screen.findByTestId("payment-0-entry-1-slot-error")).toHaveTextContent("Этот чек уже отправлен.");
    expect(attempts).toHaveLength(1);
    expect(screen.getByTestId("payment-0-entry-1-slot-file-name")).toHaveTextContent("chek.jpg");
    expect(screen.queryByTestId("payment-0-entry-1-slot-sent")).toBeNull();
  });
});

describe("Оплата: «Добавить платёж» вместо «Чеков без платежа» (G33)", () => {
  async function open(over: Record<string, unknown> = {}, io = makeIo()) {
    const { transport, calls } = center(over);
    await renderPortal(<PaymentsScreen io={io.io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("payments-add"));
    return { ...io, calls };
  }

  it("кнопка раскрывает форму и закрывает её; сумма пуста, валюта первая из платежей, день сегодня, поле файла и подсказка", async () => {
    await open();
    const button = screen.getByTestId("payments-add");
    expect(button.props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByTestId("payment-add-amount").props.value).toBe("");
    expect(screen.getByTestId("payment-add-currency").props.value).toBe("USD");
    const [year, month, day] = todayInBishkek().split("-");
    expect(screen.getByTestId("payment-add-date").props.value).toBe(`${day}.${month}.${year}`);
    expect(screen.getByTestId("payment-add-pick")).toHaveTextContent("Приложить чек");
    expect(screen.getByText("JPG, PNG или PDF, до 25 МБ. После сохранения чек уйдёт куратору на проверку.")).toBeTruthy();
    await fireEvent.press(button);
    expect(screen.queryByTestId("payment-add-form")).toBeNull();
    expect(screen.getByTestId("payments-add").props.accessibilityState).toMatchObject({ expanded: false });
  });

  it("«Отмена» закрывает форму без отправки", async () => {
    const { attempts } = await open();
    await fireEvent.press(screen.getByTestId("payment-add-cancel"));
    expect(screen.queryByTestId("payment-add-form")).toBeNull();
    expect(attempts).toHaveLength(0);
  });

  it("сумма, валюта, день и файл: отправка без платежа (payment_obligation_id пуст), день как «дд.мм.гггг», сообщение на месте формы", async () => {
    const io = makeIo();
    const { attempts, calls } = await open({}, io);
    await fireEvent.changeText(screen.getByTestId("payment-add-amount"), "1 000,5");
    await fireEvent.changeText(screen.getByTestId("payment-add-currency"), "kgs");
    await fireEvent.changeText(screen.getByTestId("payment-add-date"), "10.11.2026");
    await choosePhoto("payment-add-pick", io.io);
    expect(await screen.findByTestId("payment-add-file-name")).toHaveTextContent("chek.jpg");
    await fireEvent.press(screen.getByTestId("payment-add-save"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(attempts[0]).toMatchObject({ mimeType: "image/jpeg", fields: { amount: "1000.50", currency: "KGS", paidOn: "2026-11-10", obligationId: null } });
    expect(await screen.findByTestId("payment-add-sent")).toHaveTextContent(RECEIPT_SENT);
    expect(screen.queryByTestId("payment-add-form")).toBeNull();
    expect(announceMock).toHaveBeenCalledWith(RECEIPT_SENT);
    await waitFor(() => expect(paymentCenterCalls(calls)).toBeGreaterThan(1));
    // кнопка заголовка закрывает сообщение; новое открытие - чистая форма
    await fireEvent.press(screen.getByTestId("payments-add"));
    await fireEvent.press(screen.getByTestId("payments-add"));
    expect(screen.getByTestId("payment-add-amount").props.value).toBe("");
  });

  it("день «гггг-мм-дд» тоже принимается", async () => {
    const io = makeIo();
    const { attempts } = await open({}, io);
    await fireEvent.changeText(screen.getByTestId("payment-add-amount"), "5");
    await fireEvent.changeText(screen.getByTestId("payment-add-date"), "2026-11-09");
    await choosePhoto("payment-add-pick", io.io);
    await fireEvent.press(await screen.findByTestId("payment-add-save"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.fields).toEqual({ amount: "5.00", currency: "USD", paidOn: "2026-11-09", obligationId: null });
  });

  it("проверки до отправки: без файла и суммы, валюта не из трёх букв (слова сайта), день в будущем; сеть не вызывается", async () => {
    const io = makeIo();
    const { attempts } = await open({}, io);
    await fireEvent.press(screen.getByTestId("payment-add-save"));
    expect(await screen.findByTestId("payment-add-error")).toHaveTextContent("Проверьте сумму, валюту, дату и файл.");
    await choosePhoto("payment-add-pick", io.io);
    await fireEvent.changeText(screen.getByTestId("payment-add-amount"), "10");
    await fireEvent.changeText(screen.getByTestId("payment-add-currency"), "us");
    await fireEvent.press(await screen.findByTestId("payment-add-save"));
    expect(await screen.findByTestId("payment-add-error")).toHaveTextContent("Проверьте сумму, валюту, дату и файл.");
    await fireEvent.changeText(screen.getByTestId("payment-add-currency"), "usd");
    await fireEvent.changeText(screen.getByTestId("payment-add-date"), "01.01.2999");
    await fireEvent.press(screen.getByTestId("payment-add-save"));
    expect(await screen.findByTestId("payment-add-error")).toHaveTextContent("Проверьте дату оплаты: она не может быть в будущем.");
    expect(attempts).toHaveLength(0);
  });

  it("отказ сервера: текст по коду, форма остаётся", async () => {
    const io = makeIo([{ status: 429, body: { error: "receipt_too_many" } }]);
    const { attempts } = await open({}, io);
    await fireEvent.changeText(screen.getByTestId("payment-add-amount"), "10");
    await choosePhoto("payment-add-pick", io.io);
    await fireEvent.press(await screen.findByTestId("payment-add-save"));
    expect(await screen.findByTestId("payment-add-error")).toHaveTextContent("Слишком много чеков на проверке. Дождитесь решения куратора.");
    expect(attempts).toHaveLength(1);
    expect(screen.getByTestId("payment-add-form")).toBeTruthy();
    expect(screen.queryByTestId("payment-add-sent")).toBeNull();
  });

  it("валюты платежей и чеков - быстрые кнопки у поля валюты", async () => {
    const loose = paymentEntryRow({ entry_id: ENTRY_ID(70), currency: "KGS", amount_minor: 2500000 });
    await open({ unassigned: [loose] });
    expect(screen.getByTestId("payment-add-currency-USD").props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId("payment-add-currency-KGS"));
    expect(screen.getByTestId("payment-add-currency").props.value).toBe("KGS");
    expect(screen.getByTestId("payment-add-currency-KGS").props.accessibilityState).toMatchObject({ selected: true });
  });

  it("одна валюта: быстрых кнопок нет, она уже стоит в поле", async () => {
    await open();
    expect(screen.getByTestId("payment-add-currency").props.value).toBe("USD");
    expect(screen.queryByTestId("payment-add-currency-USD")).toBeNull();
  });

  it("платежей и чеков нет: валюта по умолчанию - сом", async () => {
    await open({ dues: [], unassigned: [] });
    expect(screen.getByTestId("payment-add-currency").props.value).toBe("KGS");
  });
});

describe("Оплата: «Добавленные платежи» (чеки без платежа в графике)", () => {
  const loose = (n: number, over: Record<string, unknown> = {}) => paymentEntryRow({ entry_id: ENTRY_ID(n), amount_minor: 2500, ...over });

  it("отдельная таблица под услугами: заголовок, пояснение, статус, причина, «Заменить» у отклонённого", async () => {
    const { transport } = center({ unassigned: [loose(71, { status: "rejected", reject_reason: "Размыто", on_date: "2026-11-10" }), loose(72, { on_date: "2026-11-12" })] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Добавленные платежи")).toBeTruthy();
    expect(screen.getByText("Куратор отнесёт их к нужному платежу.")).toBeTruthy();
    expect(screen.getByTestId("added-entry-0-date")).toHaveTextContent("10.11.2026");
    expect(screen.getByTestId("added-entry-0-status")).toHaveTextContent("Отклонён");
    expect(screen.getByTestId("added-entry-0-reason")).toHaveTextContent("Размыто");
    expect(screen.getByTestId("added-entry-0-slot-replace")).toBeTruthy();
    expect(screen.getByTestId("added-entry-1-status")).toHaveTextContent("На проверке");
    expect(screen.queryByTestId("added-entry-1-slot-replace")).toBeNull();
    expect(screen.queryByText("Чеки без платежа")).toBeNull();
  });

  it("«Заменить» у добавленного платежа: поля того же чека, платежа нет", async () => {
    const { transport } = center({ dues: [], unassigned: [loose(73, { status: "rejected", reject_reason: "Размыто", on_date: "2026-11-10", currency: "KGS", amount_minor: 150000 })] });
    const { io, attempts } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await choosePhoto("added-entry-0-slot-replace", io);
    await fireEvent.press(await screen.findByTestId("added-entry-0-slot-save"));
    await waitFor(() => expect(attempts).toHaveLength(1));
    expect(attempts[0]?.fields).toEqual({ amount: "1500.00", currency: "KGS", paidOn: "2026-11-10", obligationId: null });
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

const BANK_TEXT = "Банк: KICB (Kyrgyz Commercial Bank)\nПолучатель: Test Recipient\nТелефон: +996 700 000 000\nСчёт: 0000 0000";
const withQr = { text: BANK_TEXT, has_qr: true, qr_id: QR_ID, updated_at: "2026-11-01T08:00:00+00:00" };

describe("Оплата: «Как оплатить» как на сайте (#1476)", () => {
  it("поля банк, получатель, телефон, сумма и остальной текст; сумма - остаток транша и срок", async () => {
    const { transport } = center({ details: withQr });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Как оплатить")).toBeTruthy();
    expect(screen.getByTestId("how-to-pay-bank-value")).toHaveTextContent("KICB (Kyrgyz Commercial Bank)");
    expect(screen.getByTestId("how-to-pay-recipient-value")).toHaveTextContent("Test Recipient");
    expect(screen.getByTestId("how-to-pay-phone-value")).toHaveTextContent("+996 700 000 000");
    // остаток 60 USD минус чек на 40 на проверке = 20 к оплате; «до 01.12.2026»
    expect(screen.getByTestId("how-to-pay-amount-value").props.children).toContain("20");
    expect(screen.getByText("до 01.12.2026")).toBeTruthy();
    expect(screen.getByTestId("how-to-pay-text")).toHaveTextContent("Счёт: 0000 0000");
    expect(screen.getByText("Сумма к оплате")).toBeTruthy();
  });

  it("«Скопировать»: телефон без пробелов, сумма числом; подтверждение «Скопировано»", async () => {
    const { transport } = center({ details: withQr });
    const { io, copied } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("how-to-pay-phone-copy"));
    await waitFor(() => expect(copied).toEqual(["+996700000000"]));
    expect(await screen.findByTestId("how-to-pay-phone-feedback")).toHaveTextContent("Скопировано");
    await fireEvent.press(screen.getByTestId("how-to-pay-amount-copy"));
    await waitFor(() => expect(copied).toEqual(["+996700000000", "20"]));
    await fireEvent.press(screen.getByTestId("how-to-pay-bank-copy"));
    await waitFor(() => expect(copied[2]).toBe("KICB (Kyrgyz Commercial Bank)"));
    expect(screen.getByTestId("how-to-pay-bank-copy").props.accessibilityLabel).toBe("Скопировать банк");
  });

  it("система не дала записать в буфер: «Не удалось скопировать»", async () => {
    const { transport } = center({ details: withQr });
    const { io, copyResult } = makeIo();
    copyResult.ok = false;
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("how-to-pay-recipient-copy"));
    expect(await screen.findByTestId("how-to-pay-recipient-feedback")).toHaveTextContent("Не удалось скопировать");
  });

  it("крупный QR: подпись банка, «Скачать QR» открывает файл, «На весь экран» открывает окно с большим QR", async () => {
    const { transport } = center({ details: withQr });
    const { io, opened } = makeIo();
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    const qr = await screen.findByTestId("how-to-pay-qr");
    expect(qr.props.style.width).toBeGreaterThanOrEqual(220);
    expect(screen.getByTestId("how-to-pay-qr-brand")).toHaveTextContent("KICB");
    await fireEvent.press(screen.getByTestId("how-to-pay-qr-download"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatch(/payment-qr/);
    expect(screen.queryByTestId("how-to-pay-qr-large")).toBeNull();
    await fireEvent.press(screen.getByTestId("how-to-pay-qr-full"));
    expect(await screen.findByTestId("how-to-pay-qr-large")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("how-to-pay-qr-close"));
    await waitFor(() => expect(screen.queryByTestId("how-to-pay-qr-large")).toBeNull());
  });

  it("всё оплачено: строки «Сумма к оплате» нет", async () => {
    const paid = paymentDueRow({ paid_minor: 10000, outstanding_minor: 0, derived_status: "paid", entries: [] });
    const { transport } = center({ details: withQr, dues: [paid] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByText("Как оплатить");
    expect(screen.queryByTestId("how-to-pay-amount")).toBeNull();
    expect(screen.getByTestId("how-to-pay-bank")).toBeTruthy();
  });
});

describe("Оплата: чек к уже принятой оплате (#1458) и «Чек приложен» (G34)", () => {
  const ACCEPTED_ID = "d4444444-4444-4444-8444-444444444450";
  const acceptedNoFile = paymentEntryRow({ kind: "payment", status: "accepted", entry_id: ACCEPTED_ID, file_kind: null, file_id: null, filename: null });
  const PROOF_OK: ReceiptResponse = { status: 201, body: { payment_receipt_file_id: RECEIPT_FILE_ID, original_filename: "chek.jpg" } };
  const dueWithProof = (entries: unknown[]) => ({ dues: [paymentDueRow({ entries })] });
  const attachedFile = { file_kind: "receipt", file_id: RECEIPT_FILE_ID, filename: "from-data.jpg" };

  async function saveProof(io: PaymentsIo) {
    await choosePhoto("payment-0-entry-0-proof-attach", io);
    expect(await screen.findByTestId("payment-0-entry-0-proof-file-name")).toHaveTextContent("chek.jpg");
    await fireEvent.press(screen.getByTestId("payment-0-entry-0-proof-save"));
  }

  it("кнопка только у принятой оплаты без файла и только при canUpload", async () => {
    const withFile = paymentEntryRow({ kind: "payment", status: "accepted", entry_id: "d4444444-4444-4444-8444-444444444451", file_kind: "receipt" });
    const review = paymentEntryRow({ kind: "receipt", status: "review", entry_id: "d4444444-4444-4444-8444-444444444452" });
    const { transport } = center(dueWithProof([acceptedNoFile, withFile, review]));
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    const attach = await screen.findByTestId("payment-0-entry-0-proof-attach");
    expect(attach.props.accessibilityLabel).toMatch(/^Приложить чек: 03\.11\.2026, .*40/);
    expect(screen.queryByTestId("payment-0-entry-1-proof-attach")).toBeNull();
    expect(screen.queryByTestId("payment-0-entry-2-proof-attach")).toBeNull();
  });

  it("canUpload=false: кнопки нет", async () => {
    const { transport } = center({ can_upload: false, ...dueWithProof([acceptedNoFile]) });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await screen.findByTestId("payment-0-entry-0");
    expect(screen.queryByTestId("payment-0-entry-0-proof-attach")).toBeNull();
  });

  it("выбрать файл и «Сохранить»: POST с id оплаты и ключом повтора, затем ссылка на сохранённый файл и «Чек приложен», данные перечитаны", async () => {
    const { transport, calls } = center(dueWithProof([acceptedNoFile]));
    const { io, proofs } = makeIo([ACK], [PROOF_OK]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    expect(await screen.findByTestId("payment-0-entry-0-proof-sent")).toHaveTextContent("Чек приложен");
    expect(screen.getByTestId("payment-0-entry-0-open")).toHaveTextContent("chek.jpg");
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ paymentEventId: ACCEPTED_ID, mimeType: "image/jpeg" });
    expect(proofs[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(announceMock).toHaveBeenCalledWith("Чек приложен");
    await waitFor(() => expect(paymentCenterCalls(calls)).toBeGreaterThan(1));
  });

  it("ссылка ведёт на файл оплаты: case-files/receipt/{id}/download", async () => {
    const { transport } = center(dueWithProof([acceptedNoFile]));
    const { io, downloads, opened } = makeIo([ACK], [PROOF_OK]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    await fireEvent.press(await screen.findByTestId("payment-0-entry-0-open"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(downloads).toEqual([`https://portal.example.test/api/portal/case-files/receipt/${RECEIPT_FILE_ID}/download`]);
  });

  it("G34: перечитанные данные уже дали записи файл, слот исчез, а «Чек приложен» и ссылка остаются, пока страница открыта", async () => {
    const { transport, calls } = changing(dueWithProof([acceptedNoFile]), dueWithProof([{ ...acceptedNoFile, ...attachedFile }]));
    const { io } = makeIo([ACK], [PROOF_OK]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    await waitFor(() => expect(paymentCenterCalls(calls)).toBeGreaterThan(1));
    // ссылка теперь из данных (имя из ответа списка), слота «Приложить чек» нет, подтверждение на месте
    await waitFor(() => expect(screen.getByTestId("payment-0-entry-0-open")).toHaveTextContent("from-data.jpg"));
    expect(screen.queryByTestId("payment-0-entry-0-proof-attach")).toBeNull();
    expect(screen.getByTestId("payment-0-entry-0-proof-sent")).toHaveTextContent("Чек приложен");
  });

  it("ответ сервера не той формы: «Чек приложен» без ссылки, ссылка приходит с перечитанными данными", async () => {
    const { transport } = changing(dueWithProof([acceptedNoFile]), dueWithProof([{ ...acceptedNoFile, ...attachedFile }]));
    const { io } = makeIo([ACK], [{ status: 200, body: { unexpected: true } }]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    expect(await screen.findByTestId("payment-0-entry-0-proof-sent")).toHaveTextContent("Чек приложен");
    await waitFor(() => expect(screen.getByTestId("payment-0-entry-0-open")).toHaveTextContent("from-data.jpg"));
  });

  it("файл к оплате уже приложен (409 proof_exists): «Чек приложен» не говорится, строка просто обновляется и показывает файл", async () => {
    const { transport } = changing(dueWithProof([acceptedNoFile]), dueWithProof([{ ...acceptedNoFile, ...attachedFile }]));
    const { io } = makeIo([ACK], [{ status: 409, body: { error: "proof_exists" } }]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    await waitFor(() => expect(screen.getByTestId("payment-0-entry-0-open")).toHaveTextContent("from-data.jpg"));
    expect(screen.queryByTestId("payment-0-entry-0-proof-sent")).toBeNull();
    expect(screen.queryByTestId("payment-0-entry-0-proof-attach")).toBeNull();
    expect(announceMock).not.toHaveBeenCalledWith("Чек приложен");
  });

  it("сервер отказал: понятная строка без текста ответа", async () => {
    const { transport } = center(dueWithProof([acceptedNoFile]));
    const { io } = makeIo([ACK], [{ status: 413, body: { error: "file_too_large" } }]);
    await renderPortal(<PaymentsScreen io={io} />, testApi(transport));
    await saveProof(io);
    expect(await screen.findByTestId("payment-0-entry-0-proof-error")).toHaveTextContent("Файл больше 25 МБ или пустой.");
    expect(screen.queryByTestId("payment-0-entry-0-proof-sent")).toBeNull();
  });
});

describe("Оплата: пусто, сбой, права", () => {
  it("пусто: объяснение, «Написать куратору» ведёт в чат, «Добавить платёж» доступен", async () => {
    const { transport } = center({ dues: [], unassigned: [] });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Платежей пока нет")).toBeTruthy();
    expect(screen.getByText("Если вам сказали оплатить, напишите куратору.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("payments-write-evo"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
    await fireEvent.press(screen.getByTestId("payments-add"));
    expect(screen.getByTestId("payment-add-form")).toBeTruthy();
    expect(screen.queryByTestId("receipt-attach-loose")).toBeNull();
  });

  it("пусто без права загрузки: только объяснение и «Написать куратору»", async () => {
    const { transport } = center({ dues: [], unassigned: [], can_upload: false });
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    expect(await screen.findByText("Платежей пока нет")).toBeTruthy();
    expect(screen.queryByTestId("payments-add")).toBeNull();
    expect(screen.getByTestId("payments-write-evo")).toBeTruthy();
  });

  it("список не пуст: «Написать куратору» внизу страницы", async () => {
    const { transport } = center();
    await renderPortal(<PaymentsScreen io={makeIo().io} />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("payments-write-evo"));
    expect(navigate).toHaveBeenCalledWith("/messages/chat");
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
});
