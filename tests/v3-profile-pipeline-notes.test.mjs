import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  listPlatformSalesLeads,
  PlatformSalesRepositoryError,
} from "../src/lib/platform-sales.ts";
import {
  profileNotesSubjectKey,
  toProfileNotesSnapshot,
} from "../src/components/v3/profile/profile-notes-view.ts";
import { isPlatformCaseNoteBodyWithinCodePointLimit } from "../src/lib/platform-case-note-contract.ts";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const LEAD_ID = "20000000-0000-4000-8000-000000000001";
const NOTE_ID = "30000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const UPDATED_AT = "2026-09-07T08:00:00+00:00";

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

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function queueRow(overrides = {}) {
  return {
    sort_at: UPDATED_AT,
    organization_id: ORGANIZATION_ID,
    lead_id: LEAD_ID,
    client_id: null,
    client_display_name: null,
    client_email: null,
    client_phone: null,
    current_owner_membership_id: MEMBERSHIP_ID,
    current_owner_display_name: "Sales User",
    stage_key: "contacting",
    source_key: "whatsapp",
    lifecycle_state: "open",
    next_action_text: null,
    next_action_due_date: null,
    workflow_version: "2",
    is_connected: false,
    open_duplicate_candidate_count: "0",
    linked_student_case_count: "0",
    linked_conversation_count: "0",
    created_at: "2026-09-01T08:00:00+00:00",
    updated_at: UPDATED_AT,
    stage_entered_at: "2026-09-05T08:00:00+00:00",
    latest_note_id: NOTE_ID,
    latest_note_body: "Canonical latest lead note",
    latest_note_author_display_name: "Exact Author",
    latest_note_created_at: "2026-09-06T09:30:00+00:00",
    ...overrides,
  };
}

function clientFor(data) {
  const calls = [];
  const client = {
    schema(name) {
      calls.push({ kind: "schema", name });
      return {
        async rpc(functionName, args, options) {
          calls.push({ kind: "rpc", functionName, args, options });
          return { data, error: null };
        },
      };
    },
  };
  return { client, calls };
}

test("Sales queue accepts one exact latest lead-note summary from one RPC", async () => {
  const recorded = clientFor([queueRow()]);
  const page = await listPlatformSalesLeads(actor, {}, { client: recorded.client });

  assert.deepEqual(page.rows[0].latestNote, {
    id: NOTE_ID,
    body: "Canonical latest lead note",
    authorDisplayName: "Exact Author",
    createdAt: "2026-09-06T09:30:00+00:00",
  });
  assert.equal(page.rows[0].stageEnteredAt, "2026-09-05T08:00:00+00:00");
  assert.equal(
    recorded.calls.filter((call) => call.kind === "rpc").length,
    1,
  );
  assert.equal(recorded.calls[1].functionName, "staff_sales_lead_page");
});

test("Sales queue rejects partial note tuples and accepts the all-null absence", async () => {
  const absent = clientFor([
    queueRow({
      latest_note_id: null,
      latest_note_body: null,
      latest_note_author_display_name: null,
      latest_note_created_at: null,
    }),
  ]);
  const page = await listPlatformSalesLeads(actor, {}, { client: absent.client });
  assert.equal(page.rows[0].latestNote, null);

  for (const invalidRow of [
    queueRow({ latest_note_body: null }),
    queueRow({ latest_note_id: null }),
    queueRow({ latest_note_author_display_name: null }),
    queueRow({ latest_note_created_at: null }),
  ]) {
    const invalid = clientFor([invalidRow]);
    await assert.rejects(
      listPlatformSalesLeads(actor, {}, { client: invalid.client }),
      PlatformSalesRepositoryError,
    );
  }
});

test("Profile notes preserve exact route subjects and bounded keyset paging", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const adapter = source("src/lib/v3/profile-source.ts");
  const component = source("src/components/v3/profile/ProfileNotes.tsx");

  assert.match(adapter, /target\.leadId !== null[\s\S]*leadId: target\.leadId, studentCaseId: null/u);
  assert.match(adapter, /leadId: null, studentCaseId: target\.studentCaseId/u);
  assert.match(adapter, /readCaseNotes\(actor, subject, \{[\s\S]*limit: 50,[\s\S]*cursor: noteCursor/u);
  assert.match(component, /name="lead_id" value=\{notes\.subject\.leadId \?\? ""\}/u);
  assert.match(component, /name="student_case_id"[\s\S]*notes\.subject\.studentCaseId \?\? ""/u);
  assert.match(component, /notes\.rows\.map/u);
  assert.match(component, /note\.authorDisplayName/u);
  assert.match(component, /<time dateTime=\{note\.createdAt\}/u);
  assert.doesNotMatch(component, /data-note-id|note\.caseNoteId/u);
  assert.doesNotMatch(component, /maxLength=\{4000\}/u);
  assert.match(component, /isPlatformCaseNoteBodyWithinCodePointLimit/u);
  assert.match(component, /role="alert"/u);
  assert.match(component, /disabled=\{pending \|\| lengthRejected\}/u);
  const profile = source("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /key=\{profileNotesSubjectKey\(notes\.subject\)\}/u);
  assert.match(component, />\s*Ранее\s*</u);
  assert.match(page, /parsePlatformCaseNoteCursor\(noteBeforeAt, noteBeforeId\)/u);
  assert.match(page, /noteCursor === null \|\| \(!hasLeadParam && !hasCaseParam\)/u);
  assert.match(page, /note_before_at/u);
  assert.match(page, /note_before_id/u);
  assert.match(page, /readProfileTarget\(actor, target, noteCursor,/u);
  assert.match(page, /toProfileNotesSnapshot\(view\.notes\.subject, view\.notes\.page\)/u);
});

test("Profile note client rows exclude repository-only identities", () => {
  const subject = Object.freeze({ leadId: LEAD_ID, studentCaseId: null });
  const snapshot = toProfileNotesSnapshot(subject, {
    rows: [
      {
        organizationId: ORGANIZATION_ID,
        caseNoteId: NOTE_ID,
        leadId: LEAD_ID,
        studentCaseId: null,
        body: "Visible note body",
        createdByMembershipId: MEMBERSHIP_ID,
        authorDisplayName: "Exact Author",
        createdAt: "2026-09-06T09:30:00+00:00",
      },
    ],
    nextCursor: {
      createdAt: "2026-09-06T09:30:00+00:00",
      id: NOTE_ID,
    },
    hasNext: true,
  });

  assert.equal(snapshot.subject, subject);
  assert.deepEqual(snapshot.rows, [
    {
      body: "Visible note body",
      authorDisplayName: "Exact Author",
      createdAt: "2026-09-06T09:30:00+00:00",
    },
  ]);
  assert.deepEqual(Object.keys(snapshot), ["subject", "rows"]);
  assert.deepEqual(Object.keys(snapshot.rows[0]), [
    "body",
    "authorDisplayName",
    "createdAt",
  ]);
  const serializedRows = JSON.stringify(snapshot.rows);
  assert.doesNotMatch(serializedRows, new RegExp(ORGANIZATION_ID, "u"));
  assert.doesNotMatch(serializedRows, new RegExp(LEAD_ID, "u"));
  assert.doesNotMatch(serializedRows, new RegExp(NOTE_ID, "u"));
  assert.doesNotMatch(serializedRows, new RegExp(MEMBERSHIP_ID, "u"));
  assert.equal(profileNotesSubjectKey(subject), `lead:${LEAD_ID}`);
  assert.equal(
    profileNotesSubjectKey({ leadId: null, studentCaseId: NOTE_ID }),
    `student-case:${NOTE_ID}`,
  );
  assert.notEqual(
    profileNotesSubjectKey(subject),
    profileNotesSubjectKey({ leadId: null, studentCaseId: NOTE_ID }),
  );
  assert.throws(
    () => profileNotesSubjectKey({ leadId: null, studentCaseId: null }),
    /subject is invalid/u,
  );
});

test("Profile note draft limit uses Unicode code points", () => {
  assert.equal(
    isPlatformCaseNoteBodyWithinCodePointLimit("📝".repeat(4_000)),
    true,
  );
  assert.equal(
    isPlatformCaseNoteBodyWithinCodePointLimit("📝".repeat(4_001)),
    false,
  );
  assert.equal(isPlatformCaseNoteBodyWithinCodePointLimit("broken\ud800"), false);
});

test("Pipeline cards use batched latest notes and suppress synthetic handoff age", () => {
  const adapter = source("src/lib/v3/pipeline-source.ts");
  const card = source("src/components/v3/Pipeline.tsx");
  const migration = source("supabase/migrations/123_platform_profile_pipeline_notes.sql");

  assert.match(adapter, /stageAgeDays\(row\.stageEnteredAt, today\)/u);
  assert.match(adapter, /stageKey === "handed_off"[\s\S]*\? null/u);
  assert.match(adapter, /latestNote: row\.latestNote/u);
  assert.match(card, /!terminal && lead\.stageAgeDays !== null/u);
  assert.doesNotMatch(card, /data-note-id/u);
  assert.match(card, /lead\.latestNote\.body/u);
  assert.match(card, /lead\.latestNote\.authorDisplayName/u);
  assert.match(card, /dateTime=\{lead\.latestNote\.createdAt\}/u);
  assert.match(migration, /FROM private\.staff_sales_lead_page\(/u);
  assert.match(migration, /LEFT JOIN LATERAL/u);
  assert.match(migration, /note\.lead_id = page\.lead_id/u);
  assert.match(migration, /note\.student_case_id IS NULL/u);
  assert.match(migration, /ORDER BY note\.created_at DESC, note\.id DESC[\s\S]*LIMIT 1/u);
});
