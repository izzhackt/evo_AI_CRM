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
  ["255_platform_audit_journal_allowlist_widen.sql", "journal_widen"],
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

  // 087 (U5 contract/first-payment gate) through 255 (journal widen,
  // proposal — not applied to any database, see 255's own header and
  // PLAN_CHANGES.md «2026-09-29 — «Журнал действий»: серверный allowlist
  // аудита расширен на 73 действия»): each migration's own bounded
  // extension, verified against the live server allowlist by the
  // real-Postgres suite (platform_audit_journal_contract.sql +
  // check-platform-audit-journal-contract.mjs), not re-derived here.
  const laterActions = [];
  const laterResourceTypes = [];
  for (const { slug, source } of P7A_WRAPPER_MIGRATIONS) {
    laterActions.push(...wrapperSqlExtension(source, "p7a_safe_audit_actions", slug));
    laterResourceTypes.push(...wrapperSqlExtension(source, "p7a_safe_audit_resource_types", slug));
  }
  assert.deepEqual([...laterActions].sort(), [
    "ai.proposal.review",
    "application.document.review",
    "application.partner.details.update",
    "application.requirements.save",
    "case.chat.await",
    "case.chat.post",
    "case.coverage.return",
    "case.coverage.start",
    "case.handoff.acknowledge",
    "case.handoff.clarification",
    "case.handoff.decline",
    "case.next.action.change",
    "case.payment.receipt.upload",
    "case.pipeline.move",
    "case.sales.owner.sync",
    "case.tranche.save",
    "company.file.download.grant",
    "company.file.file.archive",
    "company.file.file.create",
    "company.file.file.move",
    "company.file.file.rename",
    "company.file.folder.archive",
    "company.file.folder.create",
    "company.file.folder.move",
    "company.file.folder.rename",
    "company.file.upload.finalize",
    "company.file.upload.reserve",
    "docs.student.create",
    "document.checklist.baseline.seed",
    "document.export.begun",
    "document.export.download.failed",
    "document.export.download.verified",
    "document.export.failed",
    "document.export.prepared",
    "document.export.ready",
    "document.export.reconciled",
    "document.export.sealed",
    "document.export.unknown",
    "document.media.attach.complete",
    "document.media.attach.reserve",
    "lead.admissions.gate.contract.confirmed",
    "lead.admissions.gate.firstpayment.confirmed",
    "lead.admissions.gate.overridden",
    "lead.admissions.handoff.completed",
    "lead.cabinet.prepare",
    "lead.lifecycle.change",
    "lead.manual.create",
    "lead.sale.conditions.save",
    "lead.sales.workflow.changed",
    "lead.website.receive",
    "media.download.grant",
    "note.create",
    "pilot.cohort.configured",
    "pilot.cohort.member.automatic",
    "pilot.cohort.member.excluded",
    "pilot.cohort.member.included",
    "prompt.artifact.publish",
    "prompt.artifact.retire",
    "sales.register.archive",
    "sales.register.create",
    "sales.register.import",
    "sales.register.lead.link",
    "sales.register.lead.unlink",
    "sales.register.manager.label",
    "sales.register.pipeline",
    "sales.register.restore",
    "sales.register.target",
    "sales.register.update",
    "snippet.archive",
    "snippet.create",
    "snippet.update",
    "staff.role.archive",
    "staff.role.assignments",
    "staff.role.copy",
    "staff.role.create",
    "staff.role.publish",
    "staff.role.restore",
    "staff.role.save",
    "staff.system.admin",
    "staff.task.create",
    "staff.task.edit",
    "staff.task.status",
    "student.portal.authority.activate",
    "student.profile.export.attempted",
    "student.profile.export.failed",
    "student.profile.export.generated",
    "student.profile.field.review",
    "student.profile.recognition.publish",
    "student.profile.start",
    "team.chat.delete",
    "team.chat.edit",
    "team.chat.moderate",
    "team.chat.post",
    "work.review.resolve",
  ]);
  assert.deepEqual([...laterResourceTypes].sort(), [
    "ai_prompt_artifact_version",
    "communication_media",
    "company_file",
    "company_file_folder",
    "company_file_version",
    "gemini_proposal_review",
    "lead",
    "membership",
    "payment_receipt_file",
    "pilot_cohort_configuration",
    "pilot_cohort_membership",
    "reply_snippet",
    "sales_manager_label",
    "sales_register",
    "sales_register_import",
    "sales_register_target",
    "staff_role",
    "staff_task",
    // 088's own extension is ["student_case"] — already in the 071 baseline,
    // so it disappears once the final list is de-duplicated by Set below.
    "student_case",
    "team_chat_message",
    "work_review_case",
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

// Privacy pin (255's own header + PLAN_CHANGES.md «2026-09-29 — «Журнал
// действий»: серверный allowlist аудита расширен на 73 действия»): every
// action 255 deliberately did NOT allowlist, and the 4 resource types that
// must never be allowlisted, stay out of the browser-safe TS lists. Reasons
// per action are in 255's header comment and the PLAN_CHANGES.md table; kept
// here as a single static pin so a future edit cannot silently re-add one.
const P7A_EXCLUDED_ACTIONS = [
  // X1 — pre-account applicant intake; no staff route resolves the id.
  "student.application.approve",
  "student.application.reject",
  // Student-writable → the projection would label the row "сотрудник"
  // (actor_kind='user' regardless of who actually called the RPC).
  "application.document.submit",
  "application.catalog.select",
  "application.requirements.initialize",
  // X3 — credential-recovery internals, needs its own security review.
  "staff.auth.prepare",
  "staff.auth.recovery.observed",
  // X4 — machine plumbing, no human decision, high volume.
  "work.enqueue",
  "work.enqueue.deduplicate",
  "work.claim",
  "work.lease.extend",
  "work.retry.schedule",
  "work.dead.letter",
  "work.succeed",
  "work.unknown.review",
  "work.conflict.review",
  "communication.leadagent.sessionstatus",
  "communication.leadagent.sync",
  "communication.webhook.persist",
  "media.archive.claim",
  "media.archive.finish",
  "media.download.consume",
  "company.file.download.consume",
  "integration.amocrm.mapping.discovery.persist",
  "configuration.waha.provision",
  "platform.observability.probe",
  // X5 — one-off deploy backfills.
  "lead.sales.stage.normalized",
  "staff.roles.migrated",
  // Lead's correction (PR #1120, head 170efb75): document.slot.scaninvalidate
  // moved here from a draft INCLUDE — same X5 class, its only writer is the
  // DO $$ ... $$ block inside already-applied migration 115 (115:611-690),
  // not a live function.
  "document.slot.scaninvalidate",
];
const P7A_NEVER_ADD_RESOURCE_TYPES = [
  "student_application",
  "staff_auth_request",
  "waha_session_observation",
  "provider_webhook_event",
];

test("excluded audit actions and never-add resource types stay out of the browser-safe allowlists", () => {
  assert.equal(P7A_EXCLUDED_ACTIONS.length, 29);
  for (const action of P7A_EXCLUDED_ACTIONS) {
    assert.equal(
      PLATFORM_AUDIT_ACTIONS.includes(action),
      false,
      `${action} must stay out of PLATFORM_AUDIT_ACTIONS (see 255's header / PLAN_CHANGES.md for the reason)`,
    );
  }
  for (const resourceType of P7A_NEVER_ADD_RESOURCE_TYPES) {
    assert.equal(
      PLATFORM_AUDIT_RESOURCE_TYPES.includes(resourceType),
      false,
      `${resourceType} must never enter PLATFORM_AUDIT_RESOURCE_TYPES`,
    );
  }
});

// Distinct from the privacy pin above: `case.contract_file.upload` is not a
// privacy exclusion — 255 researched it as a 73rd INCLUDE candidate, but its
// only writer (189's platform.record_case_contract_file_metadata) contains
// an underscore ("contract_file") that platform.audit_events' own
// audit_events_action_check CHECK (041:281, `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`)
// rejects — a pre-existing, independent defect in already-applied migration
// 189, confirmed by `DOCKER_CONTEXT=orbstack npm run
// test:database:migration-boundaries` failing with "violates check
// constraint \"audit_events_action_check\"" the first time anything (255's
// own P7A fixture) tried to write that literal. Out of scope to fix here
// (already-applied migration, product code); left out of both allowlists
// until a separate fix lands. Pinned so a future edit does not silently
// re-add it without also fixing 189.
test("case.contract_file.upload stays out of the browser-safe allowlists until 189's action-check defect is fixed", () => {
  assert.equal(PLATFORM_AUDIT_ACTIONS.includes("case.contract_file.upload"), false);
  assert.equal(PLATFORM_AUDIT_RESOURCE_TYPES.includes("case_contract_file"), false);
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

test("changed_field_codes count/length bounds are generous structural sanity ceilings, not today's server maximum", () => {
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
  const manyCodesRow = (count) => ({
    ...SAFE_ROW,
    changed_field_codes: Array.from({ length: count }, (_, index) => `code_${index}`),
  });

  // 7 well-formed, unique, but unknown codes: within the sanity bound, not
  // the exact codes this file expects for case.curator.set — degrades.
  const seven = normalizePlatformAuditSearchResult({ ...base, rows: [manyCodesRow(7)] })
    .rows[0];
  assert.equal(seven.recognized, false);
  assert.deepEqual(seven.changedFieldCodes, Array.from({ length: 7 }, (_, i) => `code_${i}`));

  // 17 codes exceeds the 16-code sanity bound — structural, throws.
  assertContractError(() =>
    normalizePlatformAuditSearchResult({ ...base, rows: [manyCodesRow(17)] }),
  );

  // A single 65-character code exceeds the 64-character sanity bound —
  // structural, throws.
  assertContractError(() =>
    normalizePlatformAuditSearchResult({
      ...base,
      rows: [{ ...SAFE_ROW, changed_field_codes: ["a".repeat(65)] }],
    }),
  );

  // A 64-character code is within bounds — well-formed, just unrecognized.
  const sixtyFour = normalizePlatformAuditSearchResult({
    ...base,
    rows: [{ ...SAFE_ROW, changed_field_codes: ["a".repeat(64)] }],
  }).rows[0];
  assert.equal(sixtyFour.recognized, false);
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
