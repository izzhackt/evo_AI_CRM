import assert from "node:assert/strict";
import test from "node:test";

import {
  StudentPortalSourceError,
  markStudentPortalNotificationRead,
  normalizeStudentPortalDocument,
  normalizeStudentPortalNotification,
  normalizeStudentPortalOverview,
  normalizeStudentPortalPayment,
  readStudentPortalApplications,
  readStudentPortalDocuments,
  readStudentPortalNotifications,
  readStudentPortalOverview,
  readStudentPortalPayments,
} from "../src/lib/v3/portal-source.ts";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const VISA_CASE_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const SLOT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const NOTIFICATION_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";

const OVERVIEW_ROW = Object.freeze({
  operational_stage: "Подготовка документов",
  next_action: "Загрузить паспорт",
  next_action_due_at: null,
  next_action_due_on: "2026-09-12",
  curator_display_name: "Айжан К.",
});

const DOCUMENT_ROW = Object.freeze({
  case_id: CASE_ID,
  document_slot_id: SLOT_ID,
  requirement_key: null,
  requirement_label: "Мотивационное письмо",
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

const APPLICATION_ROW = Object.freeze({
  application_id: APPLICATION_ID,
  institution_name: "University of Example",
  program_name: "Computer Science",
  application_status: "submitted",
  is_primary: true,
  university_deadline_on: null,
});

const VISA_ROW = Object.freeze({
  visa_case_id: VISA_CASE_ID,
  visa_status: "approved",
});

const PAYMENT_ROW = Object.freeze({
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

const NOTIFICATION_ROW = Object.freeze({
  notification_id: NOTIFICATION_ID,
  category: "document",
  event_code: "correction_required",
  subject_label: "Паспорт",
  detail: null,
  due_at: null,
  created_at: "2026-09-07T08:00:00+00:00",
  read_at: null,
});

function mockRpc(handler) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schemaName) {
        assert.equal(schemaName, "platform");
        return {
          async rpc(functionName, args = {}, options) {
            calls.push({ functionName, args, options });
            return handler(functionName, args, options);
          },
        };
      },
    },
  };
}

function ok(data) {
  return { data, error: null };
}

function expectUnavailable(callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof StudentPortalSourceError);
    assert.equal(error.message, "Student Portal data is unavailable.");
    return true;
  });
}

async function expectUnavailableAsync(callback) {
  await assert.rejects(callback, (error) => {
    assert.ok(error instanceof StudentPortalSourceError);
    assert.equal(error.message, "Student Portal data is unavailable.");
    return true;
  });
}

test("overview decoder preserves nullable facts and rejects invented or internal fields", async () => {
  const normalized = normalizeStudentPortalOverview(OVERVIEW_ROW);
  assert.deepEqual(normalized, {
    operationalStage: "Подготовка документов",
    nextAction: "Загрузить паспорт",
    nextActionDueAt: null,
    nextActionDueOn: "2026-09-12",
    curatorDisplayName: "Айжан К.",
  });
  assert.ok(Object.isFrozen(normalized));

  expectUnavailable(() => normalizeStudentPortalOverview({
    ...OVERVIEW_ROW,
    organization_id: CASE_ID,
  }));
  expectUnavailable(() => normalizeStudentPortalOverview({
    ...OVERVIEW_ROW,
    next_action_due_at: "2026-09-12T03:00:00+00:00",
  }));
  expectUnavailable(() => normalizeStudentPortalOverview({
    ...OVERVIEW_ROW,
    next_action: null,
  }));

  const mock = mockRpc((name) => {
    assert.equal(name, "student_portal_overview_v1");
    return ok([OVERVIEW_ROW]);
  });
  assert.deepEqual(await readStudentPortalOverview({ client: mock.client }), normalized);
  assert.deepEqual(mock.calls[0].options, { get: true });

  const empty = mockRpc(() => ok([]));
  assert.equal(await readStudentPortalOverview({ client: empty.client }), null);
  const ambiguous = mockRpc(() => ok([OVERVIEW_ROW, OVERVIEW_ROW]));
  await expectUnavailableAsync(() => readStudentPortalOverview({
    client: ambiguous.client,
  }));
});

test("document decoder keeps database nulls and validates one complete safe version", async () => {
  const emptySlot = normalizeStudentPortalDocument(DOCUMENT_ROW);
  assert.equal(emptySlot.requirementKey, null);
  assert.equal(emptySlot.documentVersionId, null);
  assert.equal(emptySlot.reviewDecision, null);

  const reviewed = normalizeStudentPortalDocument({
    ...DOCUMENT_ROW,
    requirement_key: "passport.copy",
    slot_status: "correction_required",
    deadline: "2026-09-12T03:00:00+00:00",
    next_action: "Загрузить новую копию",
    document_version_id: VERSION_ID,
    version_no: "9007199254740993",
    original_filename: "passport.pdf",
    declared_mime_type: "application/pdf",
    byte_size: 2048,
    submitted_at: "2026-09-06T08:00:00+00:00",
    review_decision: "correction_required",
    rework_reason: "Нужен читаемый разворот",
    reviewed_at: "2026-09-07T08:00:00+00:00",
  });
  assert.equal(reviewed.versionNo, "9007199254740993");
  assert.equal(reviewed.byteSize, 2048);

  expectUnavailable(() => normalizeStudentPortalDocument({
    ...DOCUMENT_ROW,
    storage_object_path: "private/path.pdf",
  }));
  expectUnavailable(() => normalizeStudentPortalDocument({
    ...DOCUMENT_ROW,
    document_version_id: VERSION_ID,
  }));
  expectUnavailable(() => normalizeStudentPortalDocument({
    ...DOCUMENT_ROW,
    document_version_id: VERSION_ID,
    version_no: "1",
    original_filename: "passport.pdf",
    declared_mime_type: "application/pdf",
    byte_size: 0,
    submitted_at: "2026-09-06T08:00:00+00:00",
  }));

  const mock = mockRpc(() => ok([DOCUMENT_ROW]));
  assert.deepEqual(await readStudentPortalDocuments({ client: mock.client }), [emptySlot]);
  assert.equal(mock.calls[0].functionName, "student_portal_documents");
  assert.deepEqual(mock.calls[0].options, { get: true });
});

test("applications reader joins only bounded safe status timelines", async () => {
  const applicationTimeline = [
    {
      previous_status: "ready",
      new_status: "submitted",
      occurred_at: "2026-09-07T09:00:00+00:00",
    },
    {
      previous_status: "preparation",
      new_status: "ready",
      occurred_at: "2026-09-06T09:00:00+00:00",
    },
  ];
  const visaTimeline = [
    {
      previous_status: "submitted",
      new_status: "approved",
      occurred_at: "2026-09-07T10:00:00+00:00",
    },
    {
      previous_status: "docs",
      new_status: "submitted",
      occurred_at: "2026-09-06T10:00:00+00:00",
    },
  ];
  const mock = mockRpc((name, args) => {
    if (name === "student_portal_applications_v2") return ok([APPLICATION_ROW]);
    if (name === "student_portal_visa_cases_v2") return ok([VISA_ROW]);
    if (name === "student_portal_application_timeline_v1") {
      assert.deepEqual(args, { p_application_id: APPLICATION_ID, p_limit: 50 });
      return ok(applicationTimeline);
    }
    if (name === "student_portal_visa_timeline_v1") {
      assert.deepEqual(args, { p_visa_case_id: VISA_CASE_ID, p_limit: 50 });
      return ok(visaTimeline);
    }
    assert.fail(`Unexpected RPC ${name}`);
  });

  const result = await readStudentPortalApplications({ client: mock.client });
  assert.equal(result.applications[0].status, "submitted");
  assert.equal(result.applications[0].universityDeadlineOn, null);
  assert.deepEqual(result.applications[0].timeline[0], {
    previousStatus: "ready",
    newStatus: "submitted",
    occurredAt: "2026-09-07T09:00:00+00:00",
  });
  assert.equal(result.visa?.status, "approved");
  assert.equal(result.visa?.timeline.length, 2);
  assert.ok(mock.calls.every((call) => call.options?.get === true));
});

test("applications reader fails closed on status drift, broken chronology, or unsafe fields", async () => {
  const drifted = mockRpc((name) => {
    if (name === "student_portal_applications_v2") return ok([APPLICATION_ROW]);
    if (name === "student_portal_visa_cases_v2") return ok([]);
    return ok([{
      previous_status: "preparation",
      new_status: "ready",
      occurred_at: "2026-09-07T09:00:00+00:00",
    }]);
  });
  await expectUnavailableAsync(() => readStudentPortalApplications({
    client: drifted.client,
  }));

  const unsafe = mockRpc((name) => {
    if (name === "student_portal_applications_v2") {
      return ok([{ ...APPLICATION_ROW, evidence_reference: "internal" }]);
    }
    if (name === "student_portal_visa_cases_v2") return ok([]);
    assert.fail(`Unexpected RPC ${name}`);
  });
  await expectUnavailableAsync(() => readStudentPortalApplications({
    client: unsafe.client,
  }));

  const broken = mockRpc((name) => {
    if (name === "student_portal_applications_v2") return ok([APPLICATION_ROW]);
    if (name === "student_portal_visa_cases_v2") return ok([]);
    return ok([
      {
        previous_status: "ready",
        new_status: "submitted",
        occurred_at: "2026-09-06T09:00:00+00:00",
      },
      {
        previous_status: "preparation",
        new_status: "ready",
        occurred_at: "2026-09-07T09:00:00+00:00",
      },
    ]);
  });
  await expectUnavailableAsync(() => readStudentPortalApplications({
    client: broken.client,
  }));
});

test("payment decoder verifies exact minor-unit arithmetic without exposing an ID", async () => {
  const payment = normalizeStudentPortalPayment(PAYMENT_ROW);
  assert.deepEqual(payment, {
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
  assert.equal("paymentObligationId" in payment, false);

  expectUnavailable(() => normalizeStudentPortalPayment({
    ...PAYMENT_ROW,
    outstanding_minor: 6999,
  }));
  expectUnavailable(() => normalizeStudentPortalPayment({
    ...PAYMENT_ROW,
    amount_minor: "9007199254740993",
    paid_minor: 0,
    refunded_minor: 0,
    outstanding_minor: "9007199254740993",
  }));
  expectUnavailable(() => normalizeStudentPortalPayment({
    ...PAYMENT_ROW,
    payment_obligation_id: APPLICATION_ID,
  }));

  const mock = mockRpc(() => ok([PAYMENT_ROW]));
  assert.deepEqual(await readStudentPortalPayments({ client: mock.client }), [payment]);
  assert.equal(mock.calls[0].functionName, "student_portal_finance_v2");
  assert.deepEqual(mock.calls[0].options, { get: true });
});

test("notification decoder exposes only the reusable read model", async () => {
  const notification = normalizeStudentPortalNotification(NOTIFICATION_ROW);
  assert.equal(notification.detail, null);
  assert.equal(notification.readAt, null);
  expectUnavailable(() => normalizeStudentPortalNotification({
    ...NOTIFICATION_ROW,
    recipient_membership_id: CASE_ID,
  }));

  const mock = mockRpc(() => ok([NOTIFICATION_ROW]));
  assert.deepEqual(
    await readStudentPortalNotifications({ client: mock.client }),
    [notification],
  );
  assert.equal(mock.calls[0].functionName, "student_portal_notifications_v2");
  assert.deepEqual(mock.calls[0].options, { get: true });
});

test("timestamp decoder rejects calendar-invalid offset timestamps", () => {
  expectUnavailable(() => normalizeStudentPortalNotification({
    ...NOTIFICATION_ROW,
    created_at: "2026-02-31T08:00:00+00:00",
  }));
});

test("mark-read seam validates action handles and calls only the existing RPC", async () => {
  const readAt = "2026-09-07T11:00:00+00:00";
  const mock = mockRpc((name, args, options) => {
    assert.equal(name, "mark_own_student_portal_notification_read_v2");
    assert.deepEqual(args, {
      p_notification_id: NOTIFICATION_ID,
      p_request_id: REQUEST_ID,
    });
    assert.equal(options, undefined);
    return ok({ notification_id: NOTIFICATION_ID, is_read: true, read_at: readAt });
  });
  assert.deepEqual(await markStudentPortalNotificationRead(
    { notificationId: NOTIFICATION_ID, requestId: REQUEST_ID },
    { client: mock.client },
  ), {
    notificationId: NOTIFICATION_ID,
    isRead: true,
    readAt,
  });

  const wrongIdentity = mockRpc(() => ok({
    notification_id: APPLICATION_ID,
    is_read: true,
    read_at: readAt,
  }));
  await expectUnavailableAsync(() => markStudentPortalNotificationRead(
    { notificationId: NOTIFICATION_ID, requestId: REQUEST_ID },
    { client: wrongIdentity.client },
  ));
  await expectUnavailableAsync(() => markStudentPortalNotificationRead(
    { notificationId: "not-an-id", requestId: REQUEST_ID },
    { client: mock.client },
  ));
});

test("every RPC or decode failure remains one bounded portal error", async () => {
  const rpcFailure = mockRpc(() => ({ data: null, error: { message: "sensitive" } }));
  await expectUnavailableAsync(() => readStudentPortalOverview({
    client: rpcFailure.client,
  }));

  const thrownFailure = mockRpc(() => {
    throw new Error("provider details");
  });
  await expectUnavailableAsync(() => readStudentPortalDocuments({
    client: thrownFailure.client,
  }));
});
