import type { PaymentDue, PaymentEntry } from "@web/lib/portal/payment-center";

import { canAttachProof, howToPayAmount } from "@/domain/payments-model";

const entry = (over: Partial<PaymentEntry> = {}): PaymentEntry => ({
  kind: "payment",
  entryId: "d4444444-4444-4444-8444-444444444450",
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

const due = (over: Partial<PaymentDue> = {}): PaymentDue => ({
  obligationId: "a1111111-1111-4111-8111-111111111111",
  label: "Услуги EVO",
  category: "evo_service_fee",
  amountMinor: 10000,
  paidMinor: 4000,
  refundedMinor: 0,
  outstandingMinor: 6000,
  currency: "USD",
  dueAt: "2026-12-01T08:00:00+00:00",
  status: "partially_paid",
  overdue: false,
  nextAction: null,
  entries: [],
  ...over,
});

describe("canAttachProof (#1458, как proofEventId в payment-rows.ts веба)", () => {
  it("только принятая оплата без файла и только при canUpload", () => {
    expect(canAttachProof(entry(), true)).toBe(true);
    expect(canAttachProof(entry(), false)).toBe(false);
    expect(canAttachProof(entry({ fileId: "c3333333-3333-4333-8333-333333333333", fileKind: "receipt" }), true)).toBe(false);
    expect(canAttachProof(entry({ status: "review" }), true)).toBe(false);
    expect(canAttachProof(entry({ status: "rejected" }), true)).toBe(false);
    expect(canAttachProof(entry({ kind: "refund" }), true)).toBe(false);
    expect(canAttachProof(entry({ kind: "receipt" }), true)).toBe(false);
  });
});

describe("howToPayAmount (#1476)", () => {
  it("ближайший неоплаченный транш: остаток минус чеки на проверке, число для копирования и срок", () => {
    const review = entry({ kind: "receipt", status: "review", amountMinor: 2050 });
    const amount = howToPayAmount([due({ entries: [review] })]);
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
    expect(howToPayAmount([due({ outstandingMinor: 0, status: "paid" })])).toBeNull();
  });
});
