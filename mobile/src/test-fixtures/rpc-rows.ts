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

export const VERSION_ID = "55555555-5555-4555-8555-555555555555";
export const FILE_ID = "77777777-7777-4777-8777-777777777777";

/** Слот без файла. */
export const DOCUMENT_ROW_EMPTY = Object.freeze({
  case_id: CASE_ID,
  document_slot_id: SLOT_ID,
  requirement_key: "passport",
  requirement_label: "Загранпаспорт",
  instructions: null,
  slot_status: "required",
  deadline: null,
  next_action: null,
  document_version_id: null,
  version_no: null,
  original_filename: null,
  declared_mime_type: null,
  byte_size: null,
  submitted_at: null,
  review_decision: null,
  rework_reason: null,
  reviewed_at: null,
});

/** Слот с файлом, который нужно исправить. */
export const DOCUMENT_ROW_CORRECTION = Object.freeze({
  ...DOCUMENT_ROW_EMPTY,
  slot_status: "correction_required",
  instructions: "Разворот с фото",
  deadline: "2026-09-20T03:00:00+00:00",
  document_version_id: VERSION_ID,
  version_no: "2",
  original_filename: "passport.pdf",
  declared_mime_type: "application/pdf",
  byte_size: "123456",
  submitted_at: "2026-09-05T08:00:00+00:00",
  review_decision: "correction_required",
  rework_reason: "Фото не видно",
  reviewed_at: "2026-09-06T08:00:00+00:00",
});

export const CASE_FILE_ROW = Object.freeze({
  file_kind: "contract",
  file_id: FILE_ID,
  original_filename: "contract.pdf",
  declared_mime_type: "application/pdf",
  byte_size: 2048,
  added_at: "2026-09-01T08:00:00+00:00",
});

// ---- «Оплата» (student_portal_payment_center_v1): синтетические данные ----

export const OBLIGATION_ID = "a1111111-1111-4111-8111-111111111111";
export const QR_ID = "b2222222-2222-4222-8222-222222222222";
export const RECEIPT_FILE_ID = "c3333333-3333-4333-8333-333333333333";

export const paymentEntryRow = (over: Record<string, unknown> = {}) => ({
  kind: "receipt",
  entry_id: "d4444444-4444-4444-8444-444444444444",
  status: "review",
  amount_minor: 4000,
  currency: "USD",
  on_date: "2026-11-03",
  reject_reason: null,
  file_kind: "student_receipt",
  file_id: RECEIPT_FILE_ID,
  filename: "chek.jpg",
  ...over,
});

export const paymentDueRow = (over: Record<string, unknown> = {}) => ({
  obligation_id: OBLIGATION_ID,
  label: "Услуги EVO",
  category: "evo_service_fee",
  amount_minor: 10000,
  paid_minor: 4000,
  refunded_minor: 0,
  outstanding_minor: 6000,
  currency: "USD",
  due_at: "2026-12-01T08:00:00+00:00",
  derived_status: "partially_paid",
  overdue: false,
  next_action: "Оплатить остаток",
  entries: [paymentEntryRow()],
  ...over,
});

export const paymentCenterRow = (over: Record<string, unknown> = {}) => ({
  details: null,
  dues: [paymentDueRow()],
  unassigned: [],
  can_upload: true,
  ...over,
});
