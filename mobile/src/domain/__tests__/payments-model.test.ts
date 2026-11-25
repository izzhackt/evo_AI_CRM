import type { PaymentCenter, PaymentDue, PaymentEntry } from "@web/lib/portal/payment-center";
import { buildPaymentSchedule } from "@web/lib/portal/payment-rows";

import {
  bishkekDay,
  buildPaymentsPage,
  formatEntryDay,
  howToPayAmount,
  lineDateText,
  lineDay,
  lineMoney,
  lineStatus,
  progressLabel,
  serviceBar,
  sharedServiceName,
  type PaymentLineView,
} from "@/domain/payments-model";
import { getPortalStrings } from "@/i18n";

const A = "a1111111-1111-4111-8111-111111111111";
const B = "b2222222-2222-4222-8222-222222222222";
const C = "c3333333-3333-4333-8333-333333333333";
const D = "d4444444-4444-4444-8444-444444444444";
const E = "e5555555-5555-4555-8555-555555555555";

const ru = getPortalStrings("admission", "ru");
const ky = getPortalStrings("admission", "ky");

const entry = (over: Partial<PaymentEntry> = {}): PaymentEntry => ({
  kind: "payment",
  entryId: D,
  status: "accepted",
  amountMinor: 4000,
  currency: "USD",
  onDate: "2026-11-03",
  rejectReason: null,
  fileKind: null,
  fileId: null,
  filename: null,
  ...over,
});

const receipt = (over: Partial<PaymentEntry> = {}): PaymentEntry =>
  entry({ kind: "receipt", entryId: C, status: "review", amountMinor: 30000, onDate: "2026-11-01", fileKind: "student_receipt", fileId: C, filename: "chek.jpg", ...over });

const due = (over: Partial<PaymentDue> = {}): PaymentDue => ({
  obligationId: A,
  label: "Получено в USD",
  category: "evo_service_fee",
  amountMinor: 120000,
  paidMinor: 0,
  refundedMinor: 0,
  outstandingMinor: 120000,
  currency: "USD",
  dueAt: "2026-12-01T00:00:00.000Z",
  status: "pending",
  overdue: false,
  nextAction: null,
  entries: [],
  ...over,
});

const center = (over: Partial<PaymentCenter> = {}): PaymentCenter => ({ details: null, dues: [due()], unassigned: [], canUpload: true, ...over });

const lines = (over: Partial<PaymentCenter> = {}, index = 0): readonly PaymentLineView[] => buildPaymentsPage(center(over), ru).services[index]?.lines ?? [];
const flags = (view: PaymentLineView) => [view.line.status, view.slot, view.proofEventId !== null] as const;

describe("howToPayAmount (#1476)", () => {
  it("ближайший неоплаченный транш: остаток минус чеки на проверке, число для копирования и срок", () => {
    const amount = howToPayAmount([due({ amountMinor: 10000, paidMinor: 4000, outstandingMinor: 6000, currency: "USD", dueAt: "2026-12-01T08:00:00+00:00", entries: [entry({ kind: "receipt", status: "review", amountMinor: 2050 })] })]);
    expect(amount?.copyValue).toBe("39.50");
    expect(amount?.dueOn).toBe("01.12.2026");
    expect(amount?.overdue).toBe(false);
    expect(amount?.display).toContain("39,50");
  });

  it("просрочка передаётся; без срока срока нет", () => {
    expect(howToPayAmount([due({ overdue: true })])?.overdue).toBe(true);
    expect(howToPayAmount([due({ dueAt: null })])?.dueOn).toBeNull();
  });

  it("платить нечего: null", () => {
    expect(howToPayAmount([])).toBeNull();
    expect(howToPayAmount([due({ amountMinor: 10000, paidMinor: 10000, outstandingMinor: 0, status: "paid" })])).toBeNull();
  });
});

describe("слова строки (веб: LineStatus, Money, shownDate)", () => {
  it("статусы и тон, как в таблице сайта; «Отклонён» из receiptDeclined, а не «Отклонено»", () => {
    expect(lineStatus({ status: "accepted" }, ru)).toEqual({ label: "Принято", tone: "ok" });
    expect(lineStatus({ status: "review" }, ru)).toEqual({ label: "На проверке", tone: "info" });
    expect(lineStatus({ status: "rejected" }, ru)).toEqual({ label: "Отклонён", tone: "danger" });
    expect(lineStatus({ status: "refund" }, ru)).toEqual({ label: "Возврат", tone: "neutral" });
    expect(lineStatus({ status: "missing" }, ru)).toEqual({ label: "Нет чека", tone: "neutral" });
    expect(lineStatus({ status: "rejected" }, ky).label).toBe(ky.receiptDeclined);
    expect(ky.receiptDeclined).not.toBe(ru.receiptDeclined);
  });

  it("возврат со знаком минус (U+2212), остальное без знака; сомы словом", () => {
    expect(lineMoney({ amountMinor: 10000, currency: "USD", negative: true }).startsWith("−")).toBe(true);
    expect(lineMoney({ amountMinor: 10000, currency: "USD", negative: false }).startsWith("−")).toBe(false);
    expect(lineMoney({ amountMinor: 150000, currency: "KGS", negative: false })).toMatch(/сом$/);
    expect(lineMoney({ amountMinor: 150000, currency: "KGS", negative: true })).toMatch(/^−.*сом$/);
  });

  it("день: свой день записи; нет его - срок транша; нет и его - тире; странный формат не показывается", () => {
    expect(lineDateText({ onDate: "2026-11-03", status: "accepted" }, undefined)).toBe("03.11.2026");
    expect(lineDateText({ onDate: null, status: "accepted" }, { dueAt: "2026-12-01T08:00:00+00:00" })).toBe("01.12.2026");
    expect(lineDateText({ onDate: null, status: "accepted" }, { dueAt: null })).toBe("—");
    expect(lineDateText({ onDate: null, status: "accepted" }, undefined)).toBe("—");
    expect(lineDateText({ onDate: "12/01/2026", status: "accepted" }, { dueAt: "2026-12-01T08:00:00+00:00" })).toBe("01.12.2026");
    expect(formatEntryDay("2026-01-05")).toBe("05.01.2026");
  });

  it("строка «Нет чека» стоит на сроке транша по Бишкеку, а не на том, что вернул форматтер устройства", () => {
    // срок 20:00 UTC - в Бишкеке уже следующие сутки (02:00)
    const due = { dueAt: "2026-12-01T20:00:00.000Z" };
    expect(lineDay({ onDate: "2026-12-01", status: "missing" }, due)).toBe("2026-12-02");
    expect(lineDateText({ onDate: "мусор", status: "missing" }, due)).toBe("02.12.2026");
    expect(lineDay({ onDate: "2026-12-01", status: "missing" }, undefined)).toBeNull();
    expect(lineDay({ onDate: null, status: "missing" }, { dueAt: null })).toBeNull();
    expect(lineDay({ onDate: null, status: "missing" }, { dueAt: "не дата" })).toBeNull();
    expect(lineDay({ onDate: null, status: "missing" }, { dueAt: "+275760-09-13T00:00:00.000Z" })).toBeNull();
    // запись с сервера - его день как есть, срок транша ей не нужен
    expect(lineDay({ onDate: "2026-11-03", status: "review" }, due)).toBe("2026-11-03");
  });
});

describe("услуга: заголовок, имя, суммы, полоса (веб: ServiceBlock)", () => {
  it("заголовок - категория, а не «Получено в USD»; имени нет", () => {
    const page = buildPaymentsPage(center(), ru);
    expect(page.services).toHaveLength(1);
    expect(page.services[0]?.title).toBe("Услуги EVO");
    expect(page.services[0]?.sharedName).toBeNull();
    expect(buildPaymentsPage(center(), ky).services[0]?.title).toBe("EVO кызматтары");
  });

  it("одно настоящее имя транша под заголовком; повтор заголовка с точностью до регистра не показывается", () => {
    expect(buildPaymentsPage(center({ dues: [due({ label: "Первый платёж" })] }), ru).services[0]?.sharedName).toBe("Первый платёж");
    expect(buildPaymentsPage(center({ dues: [due({ label: "услуги EVO" })] }), ru).services[0]?.sharedName).toBeNull();
    expect(sharedServiceName("Услуги EVO", ["Получено в USD"])).toBeNull();
    expect(sharedServiceName("Услуги EVO", ["Первый", "Второй"])).toBeNull();
    expect(sharedServiceName("Услуги EVO", ["Первый", "Первый"])).toBe("Первый");
  });

  it("несколько траншей: имя транша не под заголовком, а в строке под датой", () => {
    const page = buildPaymentsPage(center({ dues: [due({ label: "Первый платёж" }), due({ obligationId: B, label: "Второй платёж", dueAt: "2027-01-10T00:00:00.000Z" })] }), ru);
    expect(page.services).toHaveLength(1);
    expect(page.services[0]?.sharedName).toBeNull();
    expect(page.services[0]?.lines.map((line) => line.rowLabel)).toEqual(["Первый платёж", "Второй платёж"]);
  });

  it("услуга и валюта - одна группа: две валюты дают две услуги", () => {
    const page = buildPaymentsPage(center({ dues: [due(), due({ obligationId: B, currency: "KGS", label: "Оплата по договору" })] }), ru);
    expect(page.services.map((service) => service.title)).toEqual(["Услуги EVO", "Услуги EVO"]);
    expect(page.currencies).toEqual(["USD", "KGS"]);
    expect(page.defaultCurrency).toBe("USD");
  });

  it("суммы: К оплате, Оплачено с «N на проверке», Осталось; Возвращено только если есть", () => {
    const base = buildPaymentsPage(center({ dues: [due({ amountMinor: 100000, paidMinor: 40000, outstandingMinor: 60000, entries: [receipt({ amountMinor: 20000 })] })] }), ru).services[0];
    expect(base?.tiles.map((tile) => [tile.key, tile.label])).toEqual([
      ["toPay", "К оплате"],
      ["paid", "Оплачено"],
      ["outstanding", "Осталось"],
    ]);
    expect(base?.tiles[0]?.value).toContain("1");
    expect(base?.tiles[1]?.aside).toMatch(/на проверке/);
    expect(base?.tiles[2]?.aside).toBeNull();
    const refunded = buildPaymentsPage(center({ dues: [due({ amountMinor: 100000, paidMinor: 60000, refundedMinor: 10000, outstandingMinor: 50000 })] }), ru).services[0];
    expect(refunded?.tiles.map((tile) => tile.key)).toEqual(["toPay", "paid", "outstanding", "refunded"]);
    expect(refunded?.tiles[3]?.label).toBe("Возвращено");
  });

  it("полоса: зачтённое = сумма минус остаток, чеки на проверке следом, вместе не больше 100; подпись для читалки", () => {
    const group = { amountMinor: 100000, paidMinor: 40000, outstandingMinor: 60000, reviewMinor: 20000, currency: "USD" };
    const bar = serviceBar(group, ru);
    expect(bar?.paidPct).toBeCloseTo(40);
    expect(bar?.reviewPct).toBeCloseTo(20);
    expect(bar?.label).toMatch(/^Оплачено .* из .*\. .* на проверке$/);
    expect(serviceBar({ ...group, reviewMinor: 0 }, ru)?.label).toMatch(/^Оплачено .* из [^.]*$/);
    const over = serviceBar({ ...group, outstandingMinor: 10000, reviewMinor: 80000 }, ru);
    expect((over?.paidPct ?? 0) + (over?.reviewPct ?? 0)).toBeLessThanOrEqual(100);
    expect(serviceBar({ ...group, amountMinor: 0 }, ru)).toBeNull();
    // возврат: оплачено 600, возвращено 100, осталось 500 - полоса зачтённое (500), а не «оплачено» (600), как на сайте
    const refunded = serviceBar({ amountMinor: 100000, paidMinor: 60000, outstandingMinor: 50000, reviewMinor: 0, currency: "USD" }, ru);
    expect(refunded?.paidPct).toBeCloseTo(50);
    expect(progressLabel({ ...group, reviewMinor: 0 }, ky)).toContain("ичинен");
  });

  it("«Следующий шаг»: свои фразы траншей без повторов", () => {
    const page = buildPaymentsPage(center({ dues: [due({ nextAction: "Оплатить остаток" }), due({ obligationId: B, nextAction: "Оплатить остаток" })] }), ru);
    expect(page.services[0]?.nextActions).toEqual(["Оплатить остаток"]);
  });

  it("пусто: нет платежей и чеков - empty; чек без платежа - не пусто", () => {
    expect(buildPaymentsPage(center({ dues: [] }), ru)).toMatchObject({ empty: true, services: [], added: [], defaultCurrency: "KGS", currencies: [] });
    expect(buildPaymentsPage(center({ dues: [], unassigned: [receipt()] }), ru).empty).toBe(false);
  });
});

// Сценарии ниже - те же, что проверяет сайт в tests/student-payment-receipts.test.mjs: страница приложения обязана видеть те же строки
// и те же кнопки, потому что берёт правило из общего payment-rows.ts. Тест ловит разрыв, если приложение вдруг перестанет им пользоваться.
describe("правила строк как на сайте (payment-rows.ts)", () => {
  it("открытый остаток: одна строка «Нет чека» с «Приложить чек»; день - срок транша", () => {
    const [line, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(flags(line!)).toEqual(["missing", "attach", false]);
    expect(line?.dateText).toBe("01.12.2026");
    expect(line?.line.submitAmountMinor).toBe(120000);
    expect(line?.status.label).toBe("Нет чека");
  });

  it("чек на всю сумму на проверке: кнопки «Приложить чек» нет; на часть суммы - есть, на непокрытую часть", () => {
    expect(lines({ dues: [due({ outstandingMinor: 30000, entries: [receipt()] })] }).map(flags)).toEqual([["review", null, false]]);
    const partial = lines({ dues: [due({ outstandingMinor: 90000, entries: [receipt()] })] });
    expect(partial.map(flags)).toEqual([["review", null, false], ["missing", "attach", false]]);
    expect(partial[1]?.line.submitAmountMinor).toBe(60000);
  });

  it("отклонённый чек: «Заменить», пока нет чека на проверке и остаток открыт; причина видна", () => {
    const rejected = receipt({ entryId: E, status: "rejected", rejectReason: "не видно сумму", filename: "blur.jpg" });
    const only = lines({ dues: [due({ outstandingMinor: 30000, entries: [rejected] })] });
    expect(only.map(flags)).toEqual([["rejected", "replace", false]]);
    expect(only[0]?.rejectReason).toBe("не видно сумму");
    expect(only[0]?.status).toEqual({ label: "Отклонён", tone: "danger" });
    expect(only[0]?.file).toEqual({ fileKind: "student_receipt", fileId: C, filename: "blur.jpg" });
    // есть чек на проверке - заменять нечего
    const both = lines({ dues: [due({ entries: [receipt(), rejected] })] });
    expect(both.find((line) => line.line.status === "rejected")?.slot).toBeNull();
  });

  it("оплаченный платёж: ни «Приложить чек», ни «Заменить»; отклонённый чек остаётся историей", () => {
    const paid = { amountMinor: 60000, paidMinor: 60000, outstandingMinor: 0, status: "paid" as const };
    const withFile = lines({ dues: [due({ ...paid, entries: [entry({ amountMinor: 60000, fileKind: "receipt", fileId: B, filename: "chek.pdf" })] })] });
    expect(withFile.map(flags)).toEqual([["accepted", null, false]]);
    expect(withFile[0]?.file?.filename).toBe("chek.pdf");
    const replaced = lines({ dues: [due({ ...paid, entries: [entry({ amountMinor: 60000, onDate: "2026-11-07", fileKind: "receipt", fileId: B, filename: "ok.jpg" }), receipt({ entryId: E, status: "rejected", rejectReason: "размыто", amountMinor: 60000 })] })] });
    expect(replaced.map((line) => [line.line.status, line.slot])).toEqual([["rejected", null], ["accepted", null]]);
    expect(replaced[0]?.rejectReason).toBe("размыто");
  });

  it("принятая оплата без файла: «Приложить чек» как доказательство (proofEventId = запись оплаты); с файлом или без права - нет", () => {
    const noFile = entry({ amountMinor: 60000 });
    const paid = { amountMinor: 60000, paidMinor: 60000, outstandingMinor: 0, status: "paid" as const };
    expect(lines({ dues: [due({ ...paid, entries: [noFile] })] }).map(flags)).toEqual([["accepted", null, true]]);
    expect(lines({ dues: [due({ ...paid, entries: [noFile] })] })[0]?.proofEventId).toBe(D);
    expect(lines({ dues: [due({ ...paid, entries: [entry({ amountMinor: 60000, fileKind: "receipt", fileId: B, filename: "x.pdf" })] })] }).map(flags)).toEqual([["accepted", null, false]]);
    expect(lines({ canUpload: false, dues: [due({ ...paid, entries: [noFile] })] }).map(flags)).toEqual([["accepted", null, false]]);
  });

  it("нет права загрузки: ни одной кнопки чека, история видна", () => {
    const rejected = receipt({ entryId: E, status: "rejected", rejectReason: "размыто" });
    const page = buildPaymentsPage(center({ canUpload: false, unassigned: [rejected], dues: [due({ outstandingMinor: 30000, entries: [receipt({ entryId: B, status: "rejected", rejectReason: "размыто" })] })] }), ru);
    expect(page.services[0]?.lines.map((line) => line.slot)).toEqual([null]);
    expect(page.added.map((line) => line.slot)).toEqual([null]);
  });

  it("чек без платежа: отдельный список «Добавленные платежи», не в таблице услуги; отклонённый можно заменить", () => {
    const loose = receipt({ entryId: E, status: "rejected", rejectReason: "размыто", onDate: "2026-11-10" });
    const page = buildPaymentsPage(center({ unassigned: [loose], dues: [due(), due({ obligationId: B, currency: "KGS", amountMinor: 50000, outstandingMinor: 50000, label: "Оплата по договору" })] }), ru);
    expect(page.services).toHaveLength(2);
    expect(page.added).toHaveLength(1);
    expect(page.added[0]?.line.obligationId).toBeNull();
    expect(page.added[0]?.slot).toBe("replace");
    expect(page.added[0]?.dateText).toBe("10.11.2026");
    expect(page.services.some((service) => service.lines.some((line) => line.line.key.startsWith("loose:")))).toBe(false);
  });

  it("возврат: сумма со знаком минус, статус «Возврат»; строки по порядку дат, без даты последней", () => {
    const refund = entry({ kind: "refund", entryId: E, amountMinor: 10000, onDate: "2026-10-20" });
    const paid = entry({ amountMinor: 60000, onDate: "2026-10-02", fileKind: "receipt", fileId: B, filename: "chek.pdf" });
    const list = lines({ dues: [due({ paidMinor: 60000, refundedMinor: 10000, outstandingMinor: 70000, status: "partially_paid", entries: [paid, refund] })] });
    expect(list.map((line) => line.dateText)).toEqual(["02.10.2026", "20.10.2026", "01.12.2026"]);
    expect(list[1]?.status.label).toBe("Возврат");
    expect(list[1]?.money.startsWith("−")).toBe(true);
    expect(list[0]?.money.startsWith("−")).toBe(false);
    const undated = lines({ dues: [due({ dueAt: null })] });
    expect(undated[0]?.dateText).toBe("—");
  });

  it("просрочка: у строки «Нет чека» метка «просрочено»", () => {
    const [line] = lines({ dues: [due({ overdue: true })] });
    expect(line?.overdueLabel).toBe("просрочено");
    expect(lines()[0]?.overdueLabel).toBeNull();
  });

  it("имя кнопки для читалки: дата и сумма строки", () => {
    expect(lines()[0]?.context).toMatch(/^01\.12\.2026, .*1[^\d]?200/);
  });
});

// Приложение не решает, кто что может: оно показывает решение общего модуля. Сетка состояний ниже прогоняется и через сам
// `buildPaymentSchedule`, и через страницу приложения; любое расхождение (кто-то вписал своё правило в приложение) ловится здесь.
describe("страница видит ровно то, что решил общий модуль", () => {
  it("статус, кнопка чека и доказательство у каждой строки совпадают с buildPaymentSchedule", () => {
    let checked = 0;
    for (const canUpload of [true, false]) {
      for (const outstandingMinor of [0, 30000, 120000]) {
        for (const kind of ["payment", "receipt", "refund"] as const) {
          for (const status of ["accepted", "review", "rejected"] as const) {
            for (const withFile of [true, false]) {
              const file = withFile ? { fileKind: "receipt" as const, fileId: B, filename: "chek.pdf" } : {};
              const rejectReason = status === "rejected" ? "размыто" : null;
              const entries = [entry({ kind, status, rejectReason, amountMinor: 30000, ...file }), receipt({ entryId: E, status: "review", amountMinor: 30000, onDate: "2026-11-09" })];
              const c = center({ canUpload, dues: [due({ outstandingMinor, paidMinor: 120000 - outstandingMinor, entries })], unassigned: [receipt({ entryId: B, status: "rejected", rejectReason: "размыто" })] });
              const schedule = buildPaymentSchedule(c);
              const page = buildPaymentsPage(c, ru);
              const fromModule = [...schedule.groups.flatMap((group) => group.lines), ...schedule.added];
              const fromPage = [...page.services.flatMap((service) => service.lines), ...page.added];
              expect(fromPage.map((view) => [view.line.key, view.line.status, view.slot, view.proofEventId])).toEqual(
                fromModule.map((line) => [line.key, line.status, line.replace ? "replace" : line.attach ? "attach" : null, line.proofEventId]),
              );
              checked += fromPage.length;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("день по Бишкеку (UTC+6) и порядок строк не зависят от форматтера устройства", () => {
  it("граница суток: 17:59:59.999 UTC - ещё тот же день, 18:00:00 UTC - уже следующий", () => {
    expect(bishkekDay(Date.UTC(2026, 10, 25, 17, 59, 59, 999))).toBe("2026-11-25");
    expect(bishkekDay(Date.UTC(2026, 10, 25, 18, 0, 0, 0))).toBe("2026-11-26");
    expect(bishkekDay(Date.UTC(2026, 10, 25, 0, 0, 0, 0))).toBe("2026-11-25");
    expect(bishkekDay(Date.UTC(2026, 10, 24, 18, 0, 0, 0))).toBe("2026-11-25");
    expect(bishkekDay(Date.UTC(2026, 10, 24, 17, 59, 59, 999))).toBe("2026-11-24");
  });

  it("переход через месяц, год и високосный день", () => {
    expect(bishkekDay(Date.UTC(2026, 10, 30, 18, 0, 0))).toBe("2026-12-01");
    expect(bishkekDay(Date.UTC(2026, 11, 31, 17, 59, 59, 999))).toBe("2026-12-31");
    expect(bishkekDay(Date.UTC(2026, 11, 31, 18, 0, 0))).toBe("2027-01-01");
    expect(bishkekDay(Date.UTC(2028, 1, 28, 17, 59, 59, 999))).toBe("2028-02-28");
    expect(bishkekDay(Date.UTC(2028, 1, 28, 18, 0, 0))).toBe("2028-02-29");
    expect(bishkekDay(Date.UTC(2028, 1, 29, 18, 0, 0))).toBe("2028-03-01");
  });

  /** Подмена форматтера: на устройстве `Intl.DateTimeFormat("en-CA")` мог бы вернуть не `YYYY-MM-DD` (не проверено). */
  function withBrokenDayFormatter<T>(run: () => T, output: string): T {
    const real = Intl.DateTimeFormat;
    const fake = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(((locale?: string | string[], options?: Intl.DateTimeFormatOptions) =>
      locale === "en-CA" ? ({ format: () => output } as unknown as Intl.DateTimeFormat) : new real(locale, options)) as unknown as typeof Intl.DateTimeFormat);
    try {
      return run();
    } finally {
      fake.mockRestore();
    }
  }

  // Два транша одной услуги: по порядку ключей первый A, по срокам первым должен стоять B. Общий модуль сортирует по своему `onDate`.
  const trancheA = due({ obligationId: "a1111111-1111-4111-8111-111111111111", label: "Первый", dueAt: "2026-12-20T00:00:00.000Z" });
  const trancheB = due({ obligationId: "b2222222-2222-4222-8222-222222222222", label: "Второй", dueAt: "2026-12-05T00:00:00.000Z" });
  const order = (c: PaymentCenter) => buildPaymentsPage(c, ru).services[0]?.lines.map((line) => [line.line.obligationId === trancheA.obligationId ? "A" : "B", line.dateText]);

  it("форматтер работает: строки по срокам, B раньше A", () => {
    expect(order(center({ dues: [trancheA, trancheB] }))).toEqual([["B", "05.12.2026"], ["A", "20.12.2026"]]);
  });

  it.each(["11/25/2026", "25/11/2026", "", "Nov 25, 2026", "2026-1-5"])("форматтер вернул «%s»: порядок и дата те же, свои вычисления", (garbage) => {
    expect(withBrokenDayFormatter(() => order(center({ dues: [trancheA, trancheB] })), garbage)).toEqual([["B", "05.12.2026"], ["A", "20.12.2026"]]);
  });

  it("форматтер ошибся днём (часовой пояс проигнорирован): день срока всё равно по Бишкеку", () => {
    const late = due({ dueAt: "2026-12-01T20:00:00.000Z" }); // в Бишкеке 02.12
    expect(withBrokenDayFormatter(() => lines({ dues: [late] })[0]?.dateText, "2026-12-01")).toBe("02.12.2026");
  });

  it("записи с сервера и чеки без платежа сортируются по своему дню; без дня - в конце; при равном дне по ключу", () => {
    const paid = entry({ entryId: B, onDate: "2026-11-20", fileKind: "receipt", fileId: B, filename: "a.pdf" });
    const sameDay = entry({ entryId: A, onDate: "2026-11-20", fileKind: "receipt", fileId: A, filename: "b.pdf" });
    const early = receipt({ entryId: E, onDate: "2026-10-01" });
    const list = lines({ dues: [due({ paidMinor: 60000, outstandingMinor: 60000, dueAt: null, status: "partially_paid", entries: [paid, sameDay, early] })] });
    expect(list.map((line) => line.dateText)).toEqual(["01.10.2026", "20.11.2026", "20.11.2026", "—"]);
    expect(list.slice(1, 3).map((line) => line.line.key)).toEqual([`payment:${A}`, `payment:${B}`]);
  });
});

describe("полоса для читалки: целое число процентов округляется вниз", () => {
  const bar = (amountMinor: number, outstandingMinor: number, reviewMinor = 0) => serviceBar({ amountMinor, outstandingMinor, paidMinor: amountMinor - outstandingMinor, reviewMinor, currency: "USD" }, ru);

  it("99,7 % - это 99, а не 100, пока остаток открыт; 100 только когда закрыт", () => {
    expect(bar(100000, 300)?.valueNow).toBe(99);
    expect(bar(100000, 1)?.valueNow).toBe(99);
    expect(bar(100000, 0)?.valueNow).toBe(100);
    expect(bar(100000, 100000)?.valueNow).toBe(0);
  });

  it("целые проценты без ошибки числа с плавающей точкой: 29 % остаётся 29, а не 28", () => {
    expect(0.29 * 100).toBeLessThan(29); // сама ловушка: 28,999999999999996
    expect(bar(100000, 71000)?.valueNow).toBe(29);
    for (let percent = 0; percent <= 100; percent++) expect(bar(100000, 100000 - percent * 1000)?.valueNow).toBe(percent);
  });

  it("чеки на проверке в значение не входят: оно про зачтённое", () => {
    expect(bar(100000, 60000, 40000)?.valueNow).toBe(40);
  });
});

describe("имя транша под заголовком: сверка как у сайта (localeCompare, sensitivity accent)", () => {
  const web = (a: string, b: string) => a.localeCompare(b, "ru", { sensitivity: "accent" }) === 0;
  const hidden = (title: string, name: string) => sharedServiceName(title, [name]) === null;

  it("регистр, неразрывный пробел, «й» из двух знаков - тот же текст, имя не повторяется под заголовком", () => {
    expect(hidden("Услуги EVO", "услуги evo")).toBe(true);
    expect(hidden("Услуги EVO", "Услуги\u00A0EVO")).toBe(true);
    expect(hidden("Услуги EVO", "Услуги\u202FEVO")).toBe(true);
    expect(hidden("Дополнительный", "Дополнительны\u0438\u0306")).toBe(true);
  });

  it("разный текст остаётся именем: два пробела, «ё» и «е», русская «е» и латинская «e», лишнее слово", () => {
    expect(hidden("Услуги EVO", "Услуги  EVO")).toBe(false);
    expect(hidden("Ёлка", "Елка")).toBe(false);
    expect(hidden("е", "e")).toBe(false);
    expect(hidden("Услуги EVO", "Услуги EVO Плюс")).toBe(false);
  });

  it("и на телефоне, где localeCompare не знает про нашу чувствительность (сравнивает по кодам знаков), тот же текст не повторяется", () => {
    const codeUnits = jest.spyOn(String.prototype, "localeCompare").mockImplementation(function (this: string, that: string) {
      return this === that ? 0 : this < that ? -1 : 1;
    });
    try {
      expect(hidden("Услуги EVO", "услуги evo")).toBe(true);
      expect(hidden("Услуги EVO", "Услуги\u00A0EVO")).toBe(true);
      expect(hidden("Дополнительный", "Дополнительны\u0438\u0306")).toBe(true);
      expect(hidden("Услуги EVO", "Услуги  EVO")).toBe(false);
      expect(hidden("Ёлка", "Елка")).toBe(false);
    } finally {
      codeUnits.mockRestore();
    }
  });

  it("на случайных строках ответ тот же, что у сравнения сайта", () => {
    const alphabet = ["а", "А", "е", "Е", "ё", "й", "Й", "и", "\u0306", "E", "e", "V", "O", "o", " ", "\u00A0", "\u202F", "1"];
    let seed = 20261125;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const random = () => Array.from({ length: 1 + Math.floor(next() * 4) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    let same = 0;
    for (let i = 0; i < 6000; i++) {
      const a = random();
      // половина пар - тот же текст, записанный иначе: так одинаковые по сайту пары встречаются часто
      const b = next() < 0.5 ? a.toUpperCase().replace(/ /g, "\u00A0") : random();
      if (web(a, b)) same++;
      expect([a, b, hidden(a, b)]).toEqual([a, b, web(a, b)]);
    }
    expect(same).toBeGreaterThan(500);
  });
});
