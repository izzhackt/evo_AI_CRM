import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_RESOURCE_TYPES,
  PlatformAuditContractError,
  normalizePlatformAuditExportInput,
  normalizePlatformAuditExportResult,
  normalizePlatformAuditSearchInput,
  normalizePlatformAuditSearchResult,
} from "../src/lib/platform-audit.ts";
import {
  createPlatformAuditRepository,
  PlatformAuditRepositoryError,
} from "../src/lib/platform-audit-repository.ts";
import {
  searchPlatformAudit,
  PlatformAuditActionError,
} from "../src/lib/platform-audit-actions.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RESOURCE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const CURSOR_ID = "55555555-5555-4555-8555-555555555555";

const MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/071_platform_audit_search_export.sql", import.meta.url),
  "utf8",
);
const U1_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/083_platform_unified_staff_access.sql", import.meta.url),
  "utf8",
);
const V3_F_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/108_platform_dynamic_document_checklists.sql", import.meta.url),
  "utf8",
);
const V3_F_APPLICATION_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/112_platform_university_application_details.sql", import.meta.url),
  "utf8",
);
const V3_F_DOCUMENT_LINKS_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/113_platform_document_case_links.sql", import.meta.url),
  "utf8",
);
const STAFF_ORGANIZATION_MIGRATION_SOURCE = readFileSync(
  new URL("../supabase/migrations/154_platform_staff_organization_directory.sql", import.meta.url),
  "utf8",
);

// Every later action/resource-type addition follows the same rename-and-union
// wrapper convention 154 established (ALTER FUNCTION ... RENAME TO
// <fn>_pre_<slug>; CREATE FUNCTION <fn>() ... <fn>_pre_<slug>() ||
// ARRAY[...]::TEXT[]). One (file, slug) entry per migration that extends the
// P7A action/resource-type projection.
const P7A_WRAPPER_MIGRATIONS = [
  ["087_platform_contract_payment_gate.sql", "u5"],
  ["088_platform_sales_admissions_handoff.sql", "u6"],
  ["091_platform_u9_gemini_human_review.sql", "u9"],
  ["092_platform_u10_pilot_cohort_legacy_isolation.sql", "u10"],
  ["117_platform_case_notes.sql", "case_notes"],
  ["120_platform_reply_snippets.sql", "reply_snippets"],
  ["121_platform_message_media_case_attach.sql", "message_media_attach"],
  ["126_platform_student_portal_provisioning.sql", "student_portal_e1"],
  ["179_platform_case_baseline_checklist.sql", "case_baseline_checklist"],
  ["181_platform_lead_sale_conditions.sql", "lead_sale_conditions"],
  ["184_platform_card_fields_and_partner_details.sql", "card_fields_and_partner_details"],
  ["187_platform_admissions_pipeline_board.sql", "admissions_pipeline_board"],
  ["191_platform_case_chat.sql", "case_chat"],
].map(([file, slug]) => ({
  slug,
  source: readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
}));

const SAFE_ROW = {
  audit_event_id: EVENT_ID,
  created_at: "2026-08-13T08:15:00.000Z",
  action: "case.curator.set",
  resource_type: "student_case",
  resource_id: RESOURCE_ID,
  actor_kind: "user",
  actor_display_label: "Staff",
  request_id: REQUEST_ID,
  reason_code: "restricted",
  changed_field_codes: ["case_assignment"],
};

function assertContractError(callback) {
  assert.throws(callback, PlatformAuditContractError);
}

function sqlTextArray(functionName) {
  const startMarker = `CREATE OR REPLACE FUNCTION platform_private.${functionName}()`;
  const start = MIGRATION_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `${functionName} must exist in migration 071`);

  const bodyEnd = MIGRATION_SOURCE.indexOf("$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} must have a complete SQL body`);

  const functionBody = MIGRATION_SOURCE.slice(start, bodyEnd);
  const arrayStart = functionBody.indexOf("SELECT ARRAY[");
  const arrayEnd = functionBody.indexOf("]::TEXT[]", arrayStart);
  assert.notEqual(arrayStart, -1, `${functionName} must select one text array`);
  assert.notEqual(arrayEnd, -1, `${functionName} must cast one text array`);

  return [...functionBody.slice(arrayStart, arrayEnd).matchAll(/'([^']+)'/g)].map(
    ([, value]) => value,
  );
}

// Generic form of the rename-and-union wrapper 154 established: ALTER
// FUNCTION ... RENAME TO <fn>_pre_<slug>; CREATE FUNCTION <fn>() ... RETURN
// <fn>_pre_<slug>() || ARRAY[...]::TEXT[]. Returns [] (not a failure) when a
// given migration does not touch that particular function — not every P7A
// migration renames all three (e.g. 117/121/126/179/181/184/187/191 only
// extend actions, never resource types).
function wrapperSqlExtension(source, functionName, slug) {
  const startMarker = `CREATE FUNCTION platform_private.${functionName}()`;
  const start = source.indexOf(startMarker);
  if (start === -1) return [];

  const bodyEnd = source.indexOf("$$;", start);
  assert.notEqual(bodyEnd, -1, `${functionName} must have a complete SQL body`);
  const functionBody = source.slice(start, bodyEnd);
  const extension = functionBody.match(new RegExp(
    `platform_private\\.${functionName}_pre_${slug}\\(\\)\\s*\\|\\|\\s*ARRAY\\[([\\s\\S]*?)\\]::TEXT\\[\\]`,
  ));
  assert.ok(extension, `${functionName} must append its bounded array to the prior SQL authority (slug ${slug})`);
  return [...extension[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
}

function staffOrganizationSqlExtension(functionName) {
  return wrapperSqlExtension(STAFF_ORGANIZATION_MIGRATION_SOURCE, functionName, "staff_organization");
}

test("browser-safe allowlists match the SQL authority plus bounded extensions", () => {
  assert.match(U1_MIGRATION_SOURCE, /'membership\.permission\.change'/);
  const v3FDocumentActions = [
    "document.slot.custom.create",
    "document.slot.metadata.change",
    "document.slot.remove",
  ];
  const v3FDocumentLinkActions = [
    "document.slot.application.link",
    "document.slot.application.unlink",
    "document.slot.visa.link",
    "document.slot.visa.unlink",
  ];
  for (const action of v3FDocumentActions) {
    assert.match(V3_F_MIGRATION_SOURCE, new RegExp(`'${action.replaceAll(".", "\\.")}'`));
  }
  for (const action of v3FDocumentLinkActions) {
    assert.match(
      V3_F_DOCUMENT_LINKS_MIGRATION_SOURCE,
      new RegExp(`'${action.replaceAll(".", "\\.")}'`),
    );
  }
  assert.match(V3_F_APPLICATION_MIGRATION_SOURCE, /'application\.details\.update'/);
  const staffOrganizationActions = staffOrganizationSqlExtension("p7a_safe_audit_actions");
  const staffOrganizationResources = staffOrganizationSqlExtension("p7a_safe_audit_resource_types");
  assert.deepEqual([...staffOrganizationActions].sort(), [
    "staff.department.archive",
    "staff.department.create",
    "staff.department.restore",
    "staff.department.update",
    "staff.organization.details.change",
  ]);
  assert.deepEqual(staffOrganizationResources, ["staff_department", "staff_organizational_details"]);

  // 087 (U5 contract/first-payment gate) through 191 (case chat): each
  // migration's own bounded extension, verified against the live server
  // allowlist by the real-Postgres suite (platform_audit_journal_contract.sql
  // + check-platform-audit-journal-contract.mjs), not re-derived here.
  const laterActions = [];
  const laterResourceTypes = [];
  for (const { slug, source } of P7A_WRAPPER_MIGRATIONS) {
    laterActions.push(...wrapperSqlExtension(source, "p7a_safe_audit_actions", slug));
    laterResourceTypes.push(...wrapperSqlExtension(source, "p7a_safe_audit_resource_types", slug));
  }
  assert.deepEqual([...laterActions].sort(), [
    "ai.proposal.review",
    "application.partner.details.update",
    "case.chat.await",
    "case.chat.post",
    "case.pipeline.move",
    "case.sales.owner.sync",
    "document.checklist.baseline.seed",
    "document.media.attach.complete",
    "document.media.attach.reserve",
    "lead.admissions.gate.contract.confirmed",
    "lead.admissions.gate.firstpayment.confirmed",
    "lead.admissions.gate.overridden",
    "lead.admissions.handoff.completed",
    "lead.cabinet.prepare",
    "note.create",
    "pilot.cohort.configured",
    "pilot.cohort.member.automatic",
    "pilot.cohort.member.excluded",
    "pilot.cohort.member.included",
    "snippet.archive",
    "snippet.create",
    "snippet.update",
    "student.portal.authority.activate",
  ]);
  assert.deepEqual([...laterResourceTypes].sort(), [
    "gemini_proposal_review",
    "lead",
    "pilot_cohort_configuration",
    "pilot_cohort_membership",
    "reply_snippet",
    // 088's own extension is ["student_case"] — already in the 071 baseline,
    // so it disappears once the final list is de-duplicated by Set below.
    "student_case",
  ]);

  assert.deepEqual(
    PLATFORM_AUDIT_ACTIONS,
    [
      ...sqlTextArray("p7a_safe_audit_actions"),
      "membership.permission.change",
      ...v3FDocumentActions,
      ...v3FDocumentLinkActions,
      "application.details.update",
      ...staffOrganizationActions,
      ...laterActions,
    ].sort(),
  );
  assert.deepEqual(
    PLATFORM_AUDIT_RESOURCE_TYPES,
    [...new Set([
      ...sqlTextArray("p7a_safe_audit_resource_types"),
      ...staffOrganizationResources,
      ...laterResourceTypes,
    ])].sort(),
  );
});

test("search input canonicalizes exact allowlisted filters and stable cursor pairs", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00.000Z",
      actions: "case.curator.set,audit.export,case.curator.set",
      resource_types: "student_case,audit_export",
      resource_id: RESOURCE_ID.toUpperCase(),
      page_size: "25",
      snapshot_created_at: "2026-08-13T09:00:00Z",
      snapshot_id: SNAPSHOT_ID.toUpperCase(),
      cursor_created_at: "2026-08-13T08:30:00.000Z",
      cursor_id: CURSOR_ID,
    }),
    {
      startAt: "2026-08-01T00:00:00.000000Z",
      endAt: "2026-08-14T00:00:00.000000Z",
      actions: ["audit.export", "case.curator.set"],
      resourceTypes: ["audit_export", "student_case"],
      resourceId: RESOURCE_ID,
      pageSize: 25,
      snapshotCreatedAt: "2026-08-13T09:00:00.000000Z",
      snapshotId: SNAPSHOT_ID,
      cursorCreatedAt: "2026-08-13T08:30:00.000000Z",
      cursorId: CURSOR_ID,
    },
  );
});

test("search input rejects extras, invalid allowlist values, invalid pages and incomplete pairs", () => {
  for (const input of [
    { unknown: "value" },
    { actions: "case.curator.set,not.allowed" },
    { resource_types: "student_case,phone_number" },
    { resource_id: "not-a-uuid" },
    { page_size: "0" },
    { page_size: "101" },
    { snapshot_created_at: "2026-08-13T09:00:00Z" },
    { snapshot_id: SNAPSHOT_ID },
    { cursor_created_at: "2026-08-13T08:00:00Z", cursor_id: CURSOR_ID },
  ]) {
    assertContractError(() => normalizePlatformAuditSearchInput(input));
  }
});

test("export requires an explicit UTC window of no more than 31 days and a request UUID", () => {
  assert.deepEqual(
    normalizePlatformAuditExportInput({
      request_id: REQUEST_ID.toUpperCase(),
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: "audit.export",
      resource_types: "audit_export",
    }),
    {
      requestId: REQUEST_ID,
      startAt: "2026-08-01T00:00:00.000000Z",
      endAt: "2026-08-14T00:00:00.000000Z",
      actions: ["audit.export"],
      resourceTypes: ["audit_export"],
      resourceId: null,
      snapshotCreatedAt: null,
      snapshotId: null,
    },
  );

  for (const input of [
    { request_id: REQUEST_ID, start_at: "", end_at: "2026-08-14T00:00:00Z" },
    { request_id: REQUEST_ID, start_at: "2026-08-14T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
    { request_id: REQUEST_ID, start_at: "2026-07-01T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
    { request_id: "not-a-uuid", start_at: "2026-08-01T00:00:00Z", end_at: "2026-08-14T00:00:00Z" },
  ]) {
    assertContractError(() => normalizePlatformAuditExportInput(input));
  }
});

test("search result accepts only the exact safe projection and stable page metadata", () => {
  const normalized = normalizePlatformAuditSearchResult({
    filters: {
      start_at: "2026-08-01T00:00:00+00:00",
      end_at: "2026-08-14T00:00:00+00:00",
      actions: ["case.curator.set"],
      resource_types: ["student_case"],
      resource_id: RESOURCE_ID,
    },
    snapshot_created_at: "2026-08-13T09:00:00+00:00",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: "2026-08-13T08:15:00+00:00",
    next_cursor_id: EVENT_ID,
    has_more: true,
    rows: [SAFE_ROW],
  });

  assert.equal(normalized.rows[0].actorDisplayLabel, "Staff");
  assert.equal(normalized.rows[0].resourceId, RESOURCE_ID);
  assert.deepEqual(normalized.rows[0].changedFieldCodes, ["case_assignment"]);
  assert.equal(normalized.snapshotId, SNAPSHOT_ID);
  assert.equal(normalized.hasMore, true);
});

test("SQL microsecond timestamps round-trip without weakening snapshot or cursor precision", () => {
  const result = normalizePlatformAuditSearchResult({
    filters: {
      start_at: "2026-08-01T00:00:00.123400+00:00",
      end_at: "2026-08-14T00:00:00.654321+00:00",
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00.123456+00:00",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: "2026-08-13T08:15:00.654321+00:00",
    next_cursor_id: CURSOR_ID,
    has_more: true,
    rows: [{ ...SAFE_ROW, created_at: "2026-08-13T08:15:00.999999+00:00" }],
  });

  assert.equal(result.filters.startAt, "2026-08-01T00:00:00.123400Z");
  assert.equal(result.filters.endAt, "2026-08-14T00:00:00.654321Z");
  assert.equal(result.snapshotCreatedAt, "2026-08-13T09:00:00.123456Z");
  assert.equal(result.nextCursorCreatedAt, "2026-08-13T08:15:00.654321Z");
  assert.equal(result.rows[0].createdAt, "2026-08-13T08:15:00.999999Z");
});

test("microsecond filter ordering compares numeric time instead of variable-length text", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-13T08:15:00.12Z",
      end_at: "2026-08-13T08:15:00.123Z",
    }).startAt,
    "2026-08-13T08:15:00.120000Z",
  );
  assertContractError(() =>
    normalizePlatformAuditSearchInput({
      start_at: "2026-08-13T08:15:00.123Z",
      end_at: "2026-08-13T08:15:00.12Z",
    }),
  );
});

test("safe row parsing rejects unknown private fields and unsafe labels; a well-formed but non-allowlisted code degrades instead of failing the page", () => {
  const base = {
    filters: {
      start_at: null,
      end_at: null,
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: null,
    next_cursor_id: null,
    has_more: false,
    rows: [SAFE_ROW],
  };

  for (const row of [
    { ...SAFE_ROW, before_state: { secret: true } },
    { ...SAFE_ROW, actor_display_label: "Administrator +996 555 000 000" },
    { ...SAFE_ROW, actor_kind: "provider" },
    { ...SAFE_ROW, reason_code: "free text" },
  ]) {
    assertContractError(() => normalizePlatformAuditSearchResult({ ...base, rows: [row] }));
  }

  // "phone_number" has the right SHAPE (lowercase, underscores, <=26 chars) —
  // it is not a code this file knows for case.curator.set — so the row is
  // kept, unrecognized, with plain strings rather than dropped. Dropping
  // would make the journal and the CSV export silently incomplete.
  const degraded = normalizePlatformAuditSearchResult({
    ...base,
    rows: [{ ...SAFE_ROW, changed_field_codes: ["phone_number"] }],
  }).rows[0];
  assert.equal(degraded.recognized, false);
  assert.equal(degraded.action, "case.curator.set");
  assert.deepEqual(degraded.changedFieldCodes, ["phone_number"]);
});

test("empty search uses a null snapshot and export result verifies exact safe receipt shape", () => {
  assert.deepEqual(
    normalizePlatformAuditSearchResult({
      filters: {
        start_at: null,
        end_at: null,
        actions: null,
        resource_types: null,
        resource_id: null,
      },
      snapshot_created_at: null,
      snapshot_id: null,
      next_cursor_created_at: null,
      next_cursor_id: null,
      has_more: false,
      rows: [],
    }).rows,
    [],
  );

  const result = normalizePlatformAuditExportResult({
    request_id: REQUEST_ID,
    filters: {
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: ["audit.export"],
      resource_types: ["audit_export"],
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    row_count: 1,
    row_set_sha256: "a".repeat(64),
    rows: [{
      ...SAFE_ROW,
      action: "audit.export",
      resource_type: "audit_export",
      reason_code: "audit_export_requested",
      changed_field_codes: [
        "export_filters",
        "export_row_count",
        "export_row_set_sha256",
      ],
    }],
  });
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.rowCount, 1);
  assert.equal(result.rowSetSha256, "a".repeat(64));
});

test("safe rows require the exact fixed reason for their action (structural); a mismatched code ORDER degrades instead of failing the page", () => {
  const base = {
    filters: {
      start_at: null,
      end_at: null,
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: null,
    next_cursor_id: null,
    has_more: false,
  };
  const organizationRow = {
    ...SAFE_ROW,
    action: "organization.bootstrap",
    resource_type: "organization",
    changed_field_codes: ["record_status", "actor_role", "assignment"],
  };
  const recognized = normalizePlatformAuditSearchResult({ ...base, rows: [organizationRow] })
    .rows[0];
  assert.equal(recognized.action, "organization.bootstrap");
  assert.equal(recognized.recognized, true);

  // reason_code/action pairing is structural — it stays fail-closed
  // regardless of whether the action itself is recognized.
  assertContractError(() =>
    normalizePlatformAuditSearchResult({
      ...base,
      rows: [{ ...organizationRow, reason_code: "audit_export_requested" }],
    }),
  );

  // Same three codes, different ORDER: well-formed, but not exactly what
  // expectedChangedFieldCodes("organization.bootstrap") returns — the row is
  // kept, unrecognized, not dropped.
  const reordered = normalizePlatformAuditSearchResult({
    ...base,
    rows: [{ ...organizationRow, changed_field_codes: ["actor_role", "assignment", "record_status"] }],
  }).rows[0];
  assert.equal(reordered.recognized, false);
  assert.deepEqual(reordered.changedFieldCodes, ["actor_role", "assignment", "record_status"]);
});

test("an unknown well-formed action/resource type page reads cleanly (the #1109-class defect); malformed values still fail closed", () => {
  const base = {
    filters: {
      start_at: null,
      end_at: null,
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    next_cursor_created_at: null,
    next_cursor_id: null,
    has_more: false,
  };
  const row = (overrides) => ({ ...SAFE_ROW, ...overrides });
  const oneRow = (overrides) => ({ ...base, rows: [row(overrides)] });

  // An action the server has started emitting but this file has not (yet)
  // learned about no longer fails the whole page (src/lib/platform-audit.ts,
  // the defect this PR fixes — 29.09, snippet.create/reply_snippet on the
  // demo DB before this file learned those literals).
  const unknownAction = normalizePlatformAuditSearchResult(
    oneRow({ action: "snippet.publish", changed_field_codes: ["record_status"] }),
  ).rows[0];
  assert.equal(unknownAction.recognized, false);
  assert.equal(unknownAction.action, "snippet.publish");
  assert.equal(typeof unknownAction.action, "string");

  // Malformed actions still throw — recognition never widens the STRUCTURAL
  // shape a value must have.
  for (const action of [
    "Case.Create", // uppercase
    "case create", // space
    "case.create!", // punctuation
    "case", // no dot-segment at all
    "a." + "b".repeat(70), // over 64 chars
    "case.créate", // non-ASCII
  ]) {
    assertContractError(() => normalizePlatformAuditSearchResult(oneRow({ action })));
  }

  // An unknown resource type degrades the same way an unknown action does.
  const unknownResourceType = normalizePlatformAuditSearchResult(
    oneRow({ resource_type: "phone_number" }),
  ).rows[0];
  assert.equal(unknownResourceType.recognized, false);
  assert.equal(unknownResourceType.resourceType, "phone_number");

  // reason_code is derived from the action alone — an unknown action still
  // must carry 'restricted', never 'audit_export_requested'.
  assertContractError(() =>
    normalizePlatformAuditSearchResult(
      oneRow({
        action: "snippet.publish",
        reason_code: "audit_export_requested",
        changed_field_codes: ["record_status"],
      }),
    ),
  );

  // The export result normalizer shares parseSafeRow/parseRows — same
  // recognized/unrecognized semantics apply to an export row.
  const exportResult = normalizePlatformAuditExportResult({
    request_id: REQUEST_ID,
    filters: {
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: null,
      resource_types: null,
      resource_id: null,
    },
    snapshot_created_at: "2026-08-13T09:00:00Z",
    snapshot_id: SNAPSHOT_ID,
    row_count: 1,
    row_set_sha256: "a".repeat(64),
    rows: [row({ action: "snippet.publish", changed_field_codes: ["record_status"] })],
  });
  assert.equal(exportResult.rows[0].recognized, false);
  assert.equal(exportResult.rows[0].action, "snippet.publish");
});

function rpcClient(response, calls) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args) {
          calls.push({ name, args });
          return response;
        },
      };
    },
  };
}

test("search repository passes only frozen actor-derived RPC arguments and parses exact output", async () => {
  const calls = [];
  const response = {
    data: {
      filters: {
        start_at: null,
        end_at: null,
        actions: ["case.curator.set"],
        resource_types: ["student_case"],
        resource_id: RESOURCE_ID,
      },
      snapshot_created_at: "2026-08-13T09:00:00Z",
      snapshot_id: SNAPSHOT_ID,
      next_cursor_created_at: null,
      next_cursor_id: null,
      has_more: false,
      rows: [SAFE_ROW],
    },
    error: null,
  };
  const repository = createPlatformAuditRepository(rpcClient(response, calls));
  const result = await repository.search(
    normalizePlatformAuditSearchInput({
      actions: "case.curator.set",
      resource_types: "student_case",
      resource_id: RESOURCE_ID,
      page_size: "10",
    }),
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(calls, [
    {
      name: "search_audit_events",
      args: {
        p_start_at: null,
        p_end_at: null,
        p_actions: ["case.curator.set"],
        p_resource_types: ["student_case"],
        p_resource_id: RESOURCE_ID,
        p_page_size: 10,
        p_snapshot_created_at: null,
        p_snapshot_id: null,
        p_cursor_created_at: null,
        p_cursor_id: null,
      },
    },
  ]);
  assert.equal("p_organization_id" in calls[0].args, false);
  assert.equal("p_membership_id" in calls[0].args, false);
});

test("export repository binds request replay input and rejects response drift", async () => {
  const input = normalizePlatformAuditExportInput({
    request_id: REQUEST_ID,
    start_at: "2026-08-01T00:00:00Z",
    end_at: "2026-08-14T00:00:00Z",
    actions: "audit.export",
    resource_types: "audit_export",
  });
  const baseData = {
    request_id: REQUEST_ID,
    filters: {
      start_at: "2026-08-01T00:00:00Z",
      end_at: "2026-08-14T00:00:00Z",
      actions: ["audit.export"],
      resource_types: ["audit_export"],
      resource_id: null,
    },
    snapshot_created_at: null,
    snapshot_id: null,
    row_count: 0,
    row_set_sha256: "0".repeat(64),
    rows: [],
  };
  const calls = [];
  const repository = createPlatformAuditRepository(
    rpcClient({ data: baseData, error: null }, calls),
  );
  const receipt = await repository.export(input);
  assert.equal(receipt.rowCount, 0);
  assert.deepEqual(calls[0], {
    name: "export_audit_events",
    args: {
      p_request_id: REQUEST_ID,
      p_start_at: "2026-08-01T00:00:00.000000Z",
      p_end_at: "2026-08-14T00:00:00.000000Z",
      p_actions: ["audit.export"],
      p_resource_types: ["audit_export"],
      p_resource_id: null,
      p_snapshot_created_at: null,
      p_snapshot_id: null,
    },
  });

  const drifted = createPlatformAuditRepository(
    rpcClient(
      {
        data: { ...baseData, request_id: "66666666-6666-4666-8666-666666666666" },
        error: null,
      },
      [],
    ),
  );
  await assert.rejects(() => drifted.export(input), PlatformAuditRepositoryError);
});

test("repository maps SQL validation classes without exposing provider details", async () => {
  const input = normalizePlatformAuditSearchInput({});
  for (const [code, kind] of [
    ["42501", "unauthorized"],
    ["22023", "invalid"],
    ["54000", "too_large"],
    ["XX000", "unavailable"],
  ]) {
    const repository = createPlatformAuditRepository(
      rpcClient({ data: null, error: { code, message: "private provider detail" } }, []),
    );
    await assert.rejects(
      () => repository.search(input),
      (error) => {
        assert.ok(error instanceof PlatformAuditRepositoryError);
        assert.equal(error.kind, kind);
        assert.doesNotMatch(error.message, /provider detail/);
        return true;
      },
    );
  }
});

test("search action fails closed for disabled or non-Admin actors before repository access", async () => {
  let repositoryCalls = 0;
  const dependencies = {
    env: { EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" },
    async requireActor() {
      return { systemRole: "staff", assignments: [], permissionKeys: [] };
    },
    async createRepository() {
      repositoryCalls += 1;
      throw new Error("should not run");
    },
  };

  await assert.rejects(
    () => searchPlatformAudit({}, dependencies),
    (error) => error instanceof PlatformAuditActionError && error.kind === "unauthorized",
  );
  assert.equal(repositoryCalls, 0);

  await assert.rejects(
    () => searchPlatformAudit({}, { ...dependencies, env: {} }),
    (error) => error instanceof PlatformAuditActionError && error.kind === "unavailable",
  );
  assert.equal(repositoryCalls, 0);
});

test("search action uses the authenticated Admin repository and returns no actor authority fields", async () => {
  const result = await searchPlatformAudit(
    { actions: "case.curator.set", page_size: "10" },
    {
      env: { EVO_PLATFORM_P7A_AUDIT_ENABLED: "1" },
      async requireActor() {
        return {
          systemRole: "admin", assignments: [], permissionKeys: [],
          organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };
      },
      async createRepository() {
        return {
          async search(input) {
            assert.equal("organizationId" in input, false);
            assert.equal("membershipId" in input, false);
            assert.deepEqual(input.actions, ["case.curator.set"]);
            return {
              filters: {
                startAt: null,
                endAt: null,
                actions: ["case.curator.set"],
                resourceTypes: null,
                resourceId: null,
              },
              snapshotCreatedAt: null,
              snapshotId: null,
              nextCursorCreatedAt: null,
              nextCursorId: null,
              hasMore: false,
              rows: [],
            };
          },
          async export() {
            throw new Error("should not run");
          },
        };
      },
    },
  );
  assert.deepEqual(result.rows, []);
});
