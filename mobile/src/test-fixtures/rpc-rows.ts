// Синтетические строки RPC для тестов (значения придуманы; формы повторяют
// tests/v3-student-portal-source.test.mjs веба). Реальных данных студентов здесь нет.
export const CASE_ID = "33333333-3333-4333-8333-333333333333";
export const SLOT_ID = "44444444-4444-4444-8444-444444444444";
export const NOTIFICATION_ID = "66666666-6666-4666-8666-666666666666";
export const TASK_ID = "88888888-8888-4888-8888-888888888888";

export const OVERVIEW_ROW = Object.freeze({
  operational_stage: "documents",
  student_action_kind: "replace_document",
  student_action_label: "Паспорт",
  student_action_due_at: "2026-09-12T03:00:00+00:00",
  student_action_document_slot_id: SLOT_ID,
  evo_action_task_id: TASK_ID,
  evo_action_title: "Проверить анкету",
  evo_action_status: "in_progress",
  evo_action_due_at: null,
  evo_action_due_on: "2026-09-13",
  curator_display_name: "Айжан К.",
});

export const OVERVIEW_ROW_EMPTY = Object.freeze({
  ...OVERVIEW_ROW,
  student_action_kind: null,
  student_action_label: null,
  student_action_due_at: null,
  student_action_document_slot_id: null,
  evo_action_task_id: null,
  evo_action_title: null,
  evo_action_status: null,
  evo_action_due_at: null,
  evo_action_due_on: null,
});

export const PAYMENT_ROW = Object.freeze({
  obligation_label: "Услуги EVO",
  category: "evo_service_fee",
  amount_minor: "10000",
  paid_minor: 4000,
  refunded_minor: "1000",
  outstanding_minor: 7000,
  currency: "USD",
  due_at: "2026-10-01T08:00:00+00:00",
  derived_status: "partially_paid",
  overdue: false,
  next_action: "Оплатить остаток",
});

export const NOTIFICATION_ROW = Object.freeze({
  notification_id: NOTIFICATION_ID,
  category: "document",
  event_code: "correction_required",
  subject_label: "Паспорт",
  detail: null,
  due_at: null,
  created_at: "2026-09-07T08:00:00+00:00",
  read_at: null,
});
