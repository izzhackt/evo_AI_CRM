import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCaseNote,
  parsePlatformCaseNoteBody,
  parsePlatformCaseNoteCursor,
  parsePlatformCaseNoteSubject,
  parsePlatformCaseNoteUuid,
  PLATFORM_CASE_NOTE_MAX_BODY_LENGTH,
  PlatformCaseNoteMutationError,
  PlatformCaseNoteRepositoryError,
  readCaseNotes,
} from "../src/lib/platform-case-notes.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000009";
const LEAD_ID = "20000000-0000-4000-8000-000000000001";
const STUDENT_CASE_ID = "20000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";
const NOTE_ID = "40000000-0000-4000-8000-000000000001";
const SECOND_NOTE_ID = "40000000-0000-4000-8000-000000000002";
const THIRD_NOTE_ID = "40000000-0000-4000-8000-000000000003";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const NEWEST_AT = "2026-09-06T12:00:00.123456+00:00";
const MIDDLE_AT = "2026-09-06T11:00:00+00:00";
const OLDEST_AT = "2026-09-06T10:00:00+00:00";

const actor = Object.freeze({
  authUserId: "10000000-0000-4000-8000-000000000002",
  profileId: "10000000-0000-4000-8000-000000000003",
  membershipId: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Sales User",
  email: "sales@example.test",
  platformRole: "sales",
  authorityRole: "sales",
  presentationRole: "sales",
  platformAccessVersion: 1,
  platformBundleId: "10000000-0000-4000-8000-000000000005",
  platformBundleVersion: 1,
});

const leadSubject = Object.freeze({ leadId: LEAD_ID, studentCaseId: null });
const caseSubject = Object.freeze({
  leadId: null,
  studentCaseId: STUDENT_CASE_ID,
});

function validNoteRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    case_note_id: NOTE_ID,
    lead_id: LEAD_ID,
    student_case_id: null,
    body: "First contact done.\nStudent asks about UK foundation year.",
    created_by_membership_id: MEMBERSHIP_ID,
    author_display_name: "Sales User",
    created_at: NEWEST_AT,
    ...overrides,
  };
}

function validReceipt(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    student_case_id: null,
    body: "First contact done.",
    request_id: REQUEST_ID,
    case_note_id: NOTE_ID,
    created_by_membership_id: MEMBERSHIP_ID,
    created_at: NEWEST_AT,
    ...overrides,
  };
}

function recordingClient(responseFor) {
  const calls = [];
  return {
    calls,
    client: {
      schema(schema) {
        calls.push({ kind: "schema", schema });
        return {
          rpc(functionName, args, options) {
            calls.push({ kind: "rpc", functionName, args, options });
            return Promise.resolve(responseFor(functionName, args, options));
          },
        };
      },
    },
  };
}

function staticClient(data, error = null) {
  return recordingClient(() => ({ data, error }));
}

test("case note parsers accept only the reviewed contract", () => {
  assert.equal(PLATFORM_CASE_NOTE_MAX_BODY_LENGTH, 4000);
  assert.equal(parsePlatformCaseNoteUuid(LEAD_ID), LEAD_ID);
  assert.equal(
    parsePlatformCaseNoteUuid("00000000-0000-0000-0000-000000000000"),
    null,
  );
  assert.equal(parsePlatformCaseNoteUuid("not-a-uuid"), null);

  assert.deepEqual(
    parsePlatformCaseNoteSubject({ leadId: LEAD_ID, studentCaseId: null }),
    { leadId: LEAD_ID, studentCaseId: null },
  );
  assert.deepEqual(
    parsePlatformCaseNoteSubject({
      leadId: null,
      studentCaseId: STUDENT_CASE_ID,
    }),
    { leadId: null, studentCaseId: STUDENT_CASE_ID },
  );
  assert.equal(
    parsePlatformCaseNoteSubject({ leadId: null, studentCaseId: null }),
    null,
  );
  assert.equal(
    parsePlatformCaseNoteSubject({
      leadId: LEAD_ID,
      studentCaseId: STUDENT_CASE_ID,
    }),
    null,
  );
  assert.equal(parsePlatformCaseNoteSubject({ leadId: LEAD_ID }), null);
  assert.equal(
    parsePlatformCaseNoteSubject({
      leadId: LEAD_ID,
      studentCaseId: null,
      extra: true,
    }),
    null,
  );

  assert.equal(
    parsePlatformCaseNoteBody("  Multi-line\nnote body.  "),
    "Multi-line\nnote body.",
  );
  assert.equal(parsePlatformCaseNoteBody("   "), null);
  assert.equal(parsePlatformCaseNoteBody("\n\t\r"), null);
  assert.equal(parsePlatformCaseNoteBody("\u00a0"), null);
  assert.equal(parsePlatformCaseNoteBody("\u00a0Visible note\u00a0"), "Visible note");
  assert.equal(parsePlatformCaseNoteBody("bellchar"), null);
  assert.equal(parsePlatformCaseNoteBody("a".repeat(4001)), null);
  assert.equal(parsePlatformCaseNoteBody("a".repeat(4000)), "a".repeat(4000));
  assert.equal(
    parsePlatformCaseNoteBody("📝".repeat(4000)),
    "📝".repeat(4000),
  );
  assert.equal(parsePlatformCaseNoteBody("📝".repeat(4001)), null);
  assert.equal(parsePlatformCaseNoteBody("broken\ud800unicode"), null);

  assert.deepEqual(parsePlatformCaseNoteCursor(NEWEST_AT, NOTE_ID), {
    createdAt: NEWEST_AT,
    id: NOTE_ID,
  });
  assert.equal(parsePlatformCaseNoteCursor("2026-09-06", NOTE_ID), null);
  assert.equal(parsePlatformCaseNoteCursor(NEWEST_AT, "nope"), null);
});

test("readCaseNotes pages newest-first with a verified keyset cursor", async () => {
  const rows = [
    validNoteRow(),
    validNoteRow({ case_note_id: SECOND_NOTE_ID, created_at: MIDDLE_AT }),
    validNoteRow({ case_note_id: THIRD_NOTE_ID, created_at: OLDEST_AT }),
  ];
  const { client, calls } = staticClient(rows);
  const page = await readCaseNotes(actor, leadSubject, { limit: 2 }, {
    client,
  });

  assert.equal(page.rows.length, 2);
  assert.equal(page.hasNext, true);
  assert.deepEqual(page.nextCursor, {
    createdAt: MIDDLE_AT,
    id: SECOND_NOTE_ID,
  });
  assert.equal(page.rows[0].caseNoteId, NOTE_ID);
  assert.equal(page.rows[0].authorDisplayName, "Sales User");
  assert.match(page.rows[0].body, /\n/);

  const rpcCall = calls.find((call) => call.kind === "rpc");
  assert.equal(rpcCall.functionName, "list_case_notes");
  assert.deepEqual(rpcCall.args, {
    p_lead_id: LEAD_ID,
    p_student_case_id: null,
    p_limit: 3,
  });
  assert.deepEqual(rpcCall.options, { get: true });
});

test("readCaseNotes sends the cursor and reads a student-case subject", async () => {
  const rows = [
    validNoteRow({ lead_id: null, student_case_id: STUDENT_CASE_ID }),
  ];
  const { client, calls } = staticClient(rows);
  const page = await readCaseNotes(
    actor,
    caseSubject,
    { limit: 10, cursor: { createdAt: NEWEST_AT, id: NOTE_ID } },
    { client },
  );

  assert.equal(page.hasNext, false);
  assert.equal(page.nextCursor, null);
  assert.equal(page.rows[0].studentCaseId, STUDENT_CASE_ID);
  assert.equal(page.rows[0].leadId, null);

  const rpcCall = calls.find((call) => call.kind === "rpc");
  assert.deepEqual(rpcCall.args, {
    p_lead_id: null,
    p_student_case_id: STUDENT_CASE_ID,
    p_limit: 11,
    p_before_created_at: NEWEST_AT,
    p_before_note_id: NOTE_ID,
  });
});

test("readCaseNotes fails closed on every unexpected shape", async () => {
  const failures = [
    staticClient(null),
    staticClient([validNoteRow()], { message: "boom" }),
    staticClient([validNoteRow({ unexpected: true })]),
    staticClient([validNoteRow({ organization_id: OTHER_ORGANIZATION_ID })]),
    staticClient([
      validNoteRow({ lead_id: null, student_case_id: STUDENT_CASE_ID }),
    ]),
    staticClient([validNoteRow(), validNoteRow()]),
    staticClient([
      validNoteRow({ created_at: OLDEST_AT }),
      validNoteRow({ case_note_id: SECOND_NOTE_ID, created_at: NEWEST_AT }),
    ]),
    staticClient([validNoteRow({ body: "bellchar" })]),
    staticClient([validNoteRow({ body: "\n\t\r" })]),
    staticClient([validNoteRow({ body: "\u00a0" })]),
    staticClient([validNoteRow({ body: " wrapped note " })]),
    staticClient([validNoteRow({ author_display_name: "" })]),
  ];
  for (const { client } of failures) {
    await assert.rejects(
      readCaseNotes(actor, leadSubject, {}, { client }),
      PlatformCaseNoteRepositoryError,
    );
  }

  await assert.rejects(
    readCaseNotes(
      actor,
      { leadId: LEAD_ID, studentCaseId: STUDENT_CASE_ID },
      {},
      { client: staticClient([]).client },
    ),
    PlatformCaseNoteRepositoryError,
  );
  await assert.rejects(
    readCaseNotes(actor, leadSubject, { limit: 101 }, {
      client: staticClient([]).client,
    }),
    PlatformCaseNoteRepositoryError,
  );
  await assert.rejects(
    readCaseNotes(actor, leadSubject, {
      cursor: { createdAt: NEWEST_AT },
    }, { client: staticClient([]).client }),
    PlatformCaseNoteRepositoryError,
  );
});

test("createCaseNote sends the exact command and verifies the receipt", async () => {
  const { client, calls } = staticClient(validReceipt());
  const receipt = await createCaseNote(
    actor,
    { subject: leadSubject, body: "  First contact done.  ", requestId: REQUEST_ID },
    { client },
  );

  assert.equal(receipt.caseNoteId, NOTE_ID);
  assert.equal(receipt.leadId, LEAD_ID);
  assert.equal(receipt.studentCaseId, null);
  assert.equal(receipt.body, "First contact done.");
  assert.equal(receipt.createdByMembershipId, MEMBERSHIP_ID);
  assert.equal(receipt.createdAt, NEWEST_AT);

  const rpcCall = calls.find((call) => call.kind === "rpc");
  assert.equal(rpcCall.functionName, "create_case_note");
  assert.deepEqual(rpcCall.args, {
    p_organization_id: ORGANIZATION_ID,
    p_lead_id: LEAD_ID,
    p_student_case_id: null,
    p_body: "First contact done.",
    p_request_id: REQUEST_ID,
  });
});

test("createCaseNote maps guarded database failures to safe reasons", async () => {
  const cases = [
    [{ code: "42501", message: "Lead is unavailable" }, "forbidden"],
    [
      {
        code: "22023",
        message: `request_id ${REQUEST_ID} was already used for another mutation`,
      },
      "request_conflict",
    ],
    [
      { code: "22023", message: "Case note subject and body are invalid" },
      "invalid",
    ],
    [{ code: "57014", message: "canceled" }, "unavailable"],
  ];
  for (const [error, reason] of cases) {
    const { client } = staticClient(null, error);
    await assert.rejects(
      createCaseNote(
        actor,
        { subject: leadSubject, body: "Note.", requestId: REQUEST_ID },
        { client },
      ),
      (thrown) =>
        thrown instanceof PlatformCaseNoteMutationError &&
        thrown.reason === reason,
    );
  }
});

test("createCaseNote rejects invalid input before any network call", async () => {
  const inputs = [
    { subject: { leadId: null, studentCaseId: null }, body: "x", requestId: REQUEST_ID },
    { subject: leadSubject, body: "   ", requestId: REQUEST_ID },
    { subject: leadSubject, body: "x", requestId: "not-a-request" },
    { subject: leadSubject, body: "x".repeat(4001), requestId: REQUEST_ID },
    { subject: leadSubject, body: "x", requestId: REQUEST_ID, extra: 1 },
  ];
  for (const input of inputs) {
    const { client, calls } = staticClient(validReceipt());
    await assert.rejects(
      createCaseNote(actor, input, { client }),
      (thrown) =>
        thrown instanceof PlatformCaseNoteMutationError &&
        thrown.reason === "invalid",
    );
    assert.equal(calls.length, 0);
  }
});

test("createCaseNote fails closed on a drifted receipt", async () => {
  const drifted = [
    validReceipt({ organization_id: OTHER_ORGANIZATION_ID }),
    validReceipt({ lead_id: null, student_case_id: STUDENT_CASE_ID }),
    validReceipt({ body: "Rewritten body" }),
    validReceipt({ request_id: "50000000-0000-4000-8000-000000000002" }),
    validReceipt({ unexpected: true }),
  ];
  for (const receipt of drifted) {
    const { client } = staticClient(receipt);
    await assert.rejects(
      createCaseNote(
        actor,
        { subject: leadSubject, body: "First contact done.", requestId: REQUEST_ID },
        { client },
      ),
      (thrown) =>
        thrown instanceof PlatformCaseNoteMutationError &&
        thrown.reason === "unavailable",
    );
  }
});

const actionSource = readFileSync(
  new URL("../src/lib/platform-case-note-actions.ts", import.meta.url),
  "utf8",
);

test("case note action keeps the exact reviewed form boundary", () => {
  for (const field of ["lead_id", "student_case_id", "body", "request_id"]) {
    assert.match(actionSource, new RegExp(`"${field}"`));
  }
  assert.match(
    actionSource,
    /exactActionStringFields\(form, CASE_NOTE_FORM_FIELDS\)/,
  );
  assert.match(actionSource, /REQUEST_UUID_PATTERN/);
  assert.match(actionSource, /parsePlatformCaseNoteSubject\(/);
  assert.match(actionSource, /parsePlatformCaseNoteBody\(/);
});

test("case note action is staff-bound and revalidates only verified success", () => {
  assert.match(actionSource, /await requirePlatformStaffActor\(\)/);
  assert.match(
    actionSource,
    /const receipt = await createCaseNote\(actor, input\);/,
  );
  assert.match(actionSource, /revalidatePath\("\/v3\/pipeline"\)/);
  assert.match(
    actionSource,
    /revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\)/,
  );
  assert.match(actionSource, /error instanceof PlatformCaseNoteMutationError/);
  assert.match(
    actionSource,
    /failureState\(form, error\.reason, input\.requestId\)/,
  );
  assert.doesNotMatch(
    actionSource,
    /DATABASE_URL|service[_-]?role|Drizzle|fallback/i,
  );
});

test("case note action exposes only safe UI statuses and rotates conflicts", () => {
  for (const status of [
    "idle",
    "saved",
    "invalid",
    "forbidden",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(actionSource, new RegExp(`"${status}"`));
  }
  assert.match(
    actionSource,
    /status === "request_conflict" \? randomUUID\(\) : \(requestId \?\? randomUUID\(\)\)/,
  );
  assert.match(
    actionSource,
    /status: "saved" as const,[\s\S]*requestId: randomUUID\(\)/,
  );
  assert.match(actionSource, /caseNoteId: receipt\.caseNoteId/);
  assert.match(actionSource, /createdAt: receipt\.createdAt/);
});
