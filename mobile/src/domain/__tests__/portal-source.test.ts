import { buildPortalOverview, decodeNotifications, decodePayments, normalizeStudentPortalNotification, normalizeStudentPortalOverview, normalizeStudentPortalPayment, PortalDecodeError } from "@/domain/portal-source";

import { CASE_ID, NOTIFICATION_ID, NOTIFICATION_ROW, OVERVIEW_ROW, OVERVIEW_ROW_EMPTY, PAYMENT_ROW, SLOT_ID, TASK_ID } from "@/test-fixtures/rpc-rows";

const rejects = (fn: () => unknown) => expect(fn).toThrow(PortalDecodeError);

describe("обзор дела", () => {
  it("сохраняет пустые значения и замораживает результат", () => {
    const overview = normalizeStudentPortalOverview(OVERVIEW_ROW);
    expect(overview).toEqual({
      operationalStage: "documents",
      studentActions: [overview.studentAction],
      studentAction: { kind: "replace_document", label: "Паспорт", dueAt: "2026-09-12T03:00:00+00:00", documentSlotId: SLOT_ID },
      evoAction: { taskId: TASK_ID, title: "Проверить анкету", status: "in_progress", dueAt: null, dueOn: "2026-09-13" },
      curatorDisplayName: "Айжан К.",
    });
    expect(Object.isFrozen(overview)).toBe(true);
    expect(Object.isFrozen(overview.studentAction)).toBe(true);
    expect(normalizeStudentPortalOverview(OVERVIEW_ROW_EMPTY)).toEqual({
      operationalStage: "documents",
      studentAction: null,
      studentActions: [],
      evoAction: null,
      curatorDisplayName: "Айжан К.",
    });
  });

  it.each([
    ["лишнее поле", { ...OVERVIEW_ROW, organization_id: CASE_ID }],
    ["нет поля", Object.fromEntries(Object.entries(OVERVIEW_ROW).filter(([key]) => key !== "curator_display_name"))],
    ["неизвестный вид действия", { ...OVERVIEW_ROW, student_action_kind: "call_student" }],
    ["действие без слота", { ...OVERVIEW_ROW, student_action_document_slot_id: null }],
    ["задача EVO без id", { ...OVERVIEW_ROW, evo_action_task_id: null }],
    ["статус задачи вне словаря", { ...OVERVIEW_ROW, evo_action_status: "done" }],
    ["срок задачи и датой, и временем", { ...OVERVIEW_ROW, evo_action_due_at: "2026-09-13T03:00:00+00:00" }],
    ["нулевой uuid", { ...OVERVIEW_ROW, student_action_document_slot_id: "00000000-0000-0000-0000-000000000000" }],
    ["несуществующая дата", { ...OVERVIEW_ROW, evo_action_due_on: "2026-02-30" }],
    ["время с пробелом по краям", { ...OVERVIEW_ROW, operational_stage: " documents" }],
    ["управляющий символ", { ...OVERVIEW_ROW, student_action_label: "Пас\u0007порт" }],
    ["календарно неверное время", { ...OVERVIEW_ROW, student_action_due_at: "2026-02-30T03:00:00+00:00" }],
    ["не объект", null],
  ])("отклоняет: %s", (_name, row) => rejects(() => normalizeStudentPortalOverview(row)));

  it("ошибка не несёт данных", () => {
    try {
      normalizeStudentPortalOverview({ ...OVERVIEW_ROW, student_action_label: "Секрет\u0007" });
    } catch (error) {
      expect((error as Error).message).toBe("portal:decode");
      return;
    }
    throw new Error("ожидалась ошибка");
  });
});

describe("начисления", () => {
  it("проверяет арифметику в минимальных единицах", () => {
    expect(normalizeStudentPortalPayment(PAYMENT_ROW)).toEqual({
      label: "Услуги EVO",
      category: "evo_service_fee",
      amountMinor: 10000,
      paidMinor: 4000,
      refundedMinor: 1000,
      outstandingMinor: 7000,
      currency: "USD",
      dueAt: "2026-10-01T08:00:00+00:00",
      status: "partially_paid",
      overdue: false,
      nextAction: "Оплатить остаток",
    });
    rejects(() => normalizeStudentPortalPayment({ ...PAYMENT_ROW, outstanding_minor: 6999 }));
    rejects(() => normalizeStudentPortalPayment({ ...PAYMENT_ROW, amount_minor: "9007199254740993", paid_minor: 0, refunded_minor: 0, outstanding_minor: "9007199254740993" }));
    rejects(() => normalizeStudentPortalPayment({ ...PAYMENT_ROW, payment_obligation_id: CASE_ID }));
    rejects(() => normalizeStudentPortalPayment({ ...PAYMENT_ROW, currency: "usd" }));
    rejects(() => normalizeStudentPortalPayment({ ...PAYMENT_ROW, overdue: true }));
  });
  it("ответ должен быть списком", () => {
    rejects(() => decodePayments({}));
    expect(decodePayments([])).toEqual([]);
  });
});

describe("уведомления", () => {
  it("только модель чтения; повтор id отклоняется", () => {
    const n = normalizeStudentPortalNotification(NOTIFICATION_ROW);
    expect(n.detail).toBeNull();
    expect(n.readAt).toBeNull();
    rejects(() => normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, recipient_membership_id: CASE_ID }));
    rejects(() => normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, category: "Document" }));
    rejects(() => decodeNotifications([NOTIFICATION_ROW, NOTIFICATION_ROW]));
    expect(decodeNotifications([NOTIFICATION_ROW])).toEqual([n]);
  });
  it("отклоняет календарно неверные времена", () => {
    rejects(() => normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, created_at: "2026-02-30T08:00:00+00:00" }));
    rejects(() => normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, created_at: "2026-09-07T25:00:00+00:00" }));
    rejects(() => normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, created_at: "2026-09-07T08:00:00" }));
    expect(normalizeStudentPortalNotification({ ...NOTIFICATION_ROW, notification_id: NOTIFICATION_ID.toUpperCase() }).notificationId).toBe(NOTIFICATION_ID);
  });
});

describe("очередь действий дела", () => {
  const second = { ...PAYMENT_ROW, outstanding_minor: 7000 };
  it("нет строки: дело без плана", () => {
    expect(buildPortalOverview([], [])).toBeNull();
    rejects(() => buildPortalOverview([OVERVIEW_ROW, OVERVIEW_ROW], []));
    rejects(() => buildPortalOverview({}, []));
  });
  it("начисление с остатком встаёт в очередь по сроку: самый ранний первым", () => {
    const overview = buildPortalOverview([OVERVIEW_ROW], [second]);
    expect(overview?.studentActions.map((a) => a.kind)).toEqual(["replace_document", "payment"]);
    expect(overview?.studentAction?.kind).toBe("replace_document");
    const early = { ...second, due_at: "2026-08-01T08:00:00+00:00" };
    const reordered = buildPortalOverview([OVERVIEW_ROW], [early]);
    expect(reordered?.studentAction).toEqual({ kind: "payment", label: "Услуги EVO", dueAt: "2026-08-01T08:00:00+00:00", amountMinor: 7000, currency: "USD" });
    expect(reordered?.studentActions).toHaveLength(2);
  });
  it("без срока в конце; оплаченные пропускаются; просроченные идут первыми", () => {
    const undated = { ...second, due_at: null };
    expect(buildPortalOverview([OVERVIEW_ROW], [undated])?.studentActions.map((a) => a.kind)).toEqual(["replace_document", "payment"]);
    expect(buildPortalOverview([OVERVIEW_ROW_EMPTY], [undated])?.studentAction?.dueAt).toBeNull();
    const paid = { ...second, paid_minor: "10000", refunded_minor: 0, outstanding_minor: 0, derived_status: "paid" };
    expect(buildPortalOverview([OVERVIEW_ROW_EMPTY], [paid])?.studentAction).toBeNull();
    const overdue = { ...second, due_at: "2026-01-01T08:00:00+00:00", derived_status: "overdue", overdue: true };
    expect(buildPortalOverview([OVERVIEW_ROW], [overdue])?.studentAction?.kind).toBe("payment");
  });
  it("при равных сроках порядок сохраняется: документ первым", () => {
    const same = { ...second, due_at: "2026-09-12T03:00:00+00:00" };
    const overview = buildPortalOverview([OVERVIEW_ROW], [same]);
    expect(overview?.studentActions.map((a) => a.kind)).toEqual(["replace_document", "payment"]);
  });
  it("сбой начислений ломает обзор целиком, как в вебе", () => {
    rejects(() => buildPortalOverview([OVERVIEW_ROW], [{ ...PAYMENT_ROW, outstanding_minor: 1 }]));
  });
});
