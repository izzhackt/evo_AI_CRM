#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ProvisioningFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "ProvisioningFailure";
    this.code = code;
  }
}

function fail(code) {
  throw new ProvisioningFailure(code);
}

function unexpectedFailureCode(error) {
  if (!error || typeof error !== "object") return "UNEXPECTED_FAILURE";
  const rawCode = "code" in error ? String(error.code).toUpperCase() : "";
  const rawConstraint =
    "constraint_name" in error ? String(error.constraint_name).toUpperCase() : "";
  const code = /^[A-Z0-9_]{1,32}$/u.test(rawCode) ? rawCode : "UNKNOWN";
  const constraint = /^[A-Z0-9_]{1,96}$/u.test(rawConstraint)
    ? `_${rawConstraint}`
    : "";
  return `DATABASE_${code}${constraint}`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name}_MISSING`);
  return value;
}

function localOrigin(name) {
  const raw = requiredEnvironment(name);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${name}_INVALID`);
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    fail(`${name}_NOT_LOOPBACK`);
  }
  return parsed.origin;
}

function localDatabaseUrl() {
  const raw = requiredEnvironment("EVO_E4_SUPABASE_DB_URL");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("EVO_E4_SUPABASE_DB_URL_INVALID");
  }
  if (
    parsed.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  ) {
    fail("EVO_E4_SUPABASE_DB_URL_NOT_LOOPBACK");
  }
  return raw;
}

function password(name) {
  const value = requiredEnvironment(name);
  if (value.length < 16 || value.length > 128) fail(`${name}_INVALID`);
  return value;
}

function email(name) {
  const value = requiredEnvironment(name).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 320) {
    fail(`${name}_INVALID`);
  }
  return value;
}

function uuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail(code);
  return value.toLowerCase();
}

async function createLocalUser(client, input, code) {
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !data.user) fail(code);
  return uuid(data.user.id, code);
}

async function main() {
  const url = localOrigin("EVO_E4_SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("EVO_E4_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = localDatabaseUrl();
  const resultPath = requiredEnvironment("EVO_E4_PROVISION_RESULT");
  const admin = {
    email: email("EVO_E4_ADMIN_EMAIL"),
    password: password("EVO_E4_ADMIN_PASSWORD"),
    displayName: "E4 Browser Admin",
  };
  const student = {
    email: email("EVO_E4_STUDENT_EMAIL"),
    password: password("EVO_E4_STUDENT_PASSWORD"),
    displayName: "E4 Browser Student",
  };
  const identitySuffix = randomUUID();
  const servicePassword = `${randomUUID()}Aa1!`;
  const sales = {
    email: `sales-${identitySuffix}@e4.local.test`,
    password: servicePassword,
    displayName: "E4 Browser Sales",
  };
  const curator = {
    email: `curator-${identitySuffix}@e4.local.test`,
    password: servicePassword,
    displayName: "E4 Browser Curator",
  };

  const serviceClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const authUserIds = {
    admin: await createLocalUser(serviceClient, admin, "ADMIN_AUTH_CREATE_FAILED"),
    student: await createLocalUser(
      serviceClient,
      student,
      "STUDENT_AUTH_CREATE_FAILED",
    ),
    sales: await createLocalUser(serviceClient, sales, "SALES_AUTH_CREATE_FAILED"),
    curator: await createLocalUser(
      serviceClient,
      curator,
      "CURATOR_AUTH_CREATE_FAILED",
    ),
  };

  const ids = Object.freeze({
    organization: randomUUID(),
    organizationScope: randomUUID(),
    case: randomUUID(),
    caseScope: randomUUID(),
    adminProfile: randomUUID(),
    studentProfile: randomUUID(),
    salesProfile: randomUUID(),
    curatorProfile: randomUUID(),
    adminMembership: randomUUID(),
    studentMembership: randomUUID(),
    salesMembership: randomUUID(),
    curatorMembership: randomUUID(),
    application: randomUUID(),
    applicationEvent: randomUUID(),
    visa: randomUUID(),
    visaEvent: randomUUID(),
    obligation: randomUUID(),
    requirement: randomUUID(),
    slot: randomUUID(),
    version: randomUUID(),
    review: randomUUID(),
    notification: randomUUID(),
  });

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const bundleRows = await sql`
      SELECT DISTINCT ON (bundle.role)
        bundle.role::TEXT AS role,
        bundle.id::TEXT AS id
      FROM platform.role_bundle_versions AS bundle
      WHERE bundle.status = 'published'
        AND bundle.role IN ('admin', 'sales', 'curator', 'student')
      ORDER BY bundle.role, bundle.version DESC
    `;
    const bundles = new Map(bundleRows.map((row) => [row.role, uuid(row.id, "BUNDLE_INVALID")]));
    for (const role of ["admin", "sales", "curator", "student"]) {
      if (!bundles.has(role)) fail(`PUBLISHED_${role.toUpperCase()}_BUNDLE_MISSING`);
    }

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO platform.organizations (id, name)
        VALUES (${ids.organization}, 'E4 Browser Proof Organization')
      `;
      await tx`
        INSERT INTO platform.profiles (
          id, auth_user_id, display_name, status, access_version
        )
        VALUES
          (${ids.adminProfile}, ${authUserIds.admin}, ${admin.displayName}, 'active', 1),
          (${ids.studentProfile}, ${authUserIds.student}, ${student.displayName}, 'active', 1),
          (${ids.salesProfile}, ${authUserIds.sales}, ${sales.displayName}, 'active', 1),
          (${ids.curatorProfile}, ${authUserIds.curator}, ${curator.displayName}, 'active', 1)
      `;
      await tx`
        INSERT INTO platform.organization_memberships (
          id, organization_id, profile_id, status, "current_role", current_bundle_id
        )
        VALUES
          (${ids.adminMembership}, ${ids.organization}, ${ids.adminProfile}, 'active', 'admin', ${bundles.get("admin")}),
          (${ids.studentMembership}, ${ids.organization}, ${ids.studentProfile}, 'active', 'student', ${bundles.get("student")}),
          (${ids.salesMembership}, ${ids.organization}, ${ids.salesProfile}, 'active', 'sales', ${bundles.get("sales")}),
          (${ids.curatorMembership}, ${ids.organization}, ${ids.curatorProfile}, 'active', 'curator', ${bundles.get("curator")})
      `;
      await tx`
        INSERT INTO platform.record_scopes (
          id, organization_id, scope_kind, scope_key, scope_version
        )
        VALUES
          (${ids.organizationScope}, ${ids.organization}, 'organization', ${ids.organization}, 1),
          (${ids.caseScope}, ${ids.organization}, 'student_case', ${ids.case}, 1)
      `;
      await tx`
        INSERT INTO platform.membership_scope_assignments (
          id, organization_id, membership_id, scope_id, scope_version,
          assignment_version, granted, actor_kind, actor_profile_id, reason,
          request_id
        )
        VALUES
          (${randomUUID()}, ${ids.organization}, ${ids.adminMembership}, ${ids.organizationScope}, 1, 1, TRUE, 'system', NULL, 'E4 local Admin organization scope', ${randomUUID()}),
          (${randomUUID()}, ${ids.organization}, ${ids.studentMembership}, ${ids.organizationScope}, 1, 1, TRUE, 'system', NULL, 'E4 local Student organization scope', ${randomUUID()}),
          (${randomUUID()}, ${ids.organization}, ${ids.studentMembership}, ${ids.caseScope}, 1, 1, TRUE, 'system', NULL, 'E4 local Student case scope', ${randomUUID()})
      `;

      // Migration 126 correctly constrains runtime creation to pending cases.
      // This synthetic browser seed models an already-finalized E1 handoff,
      // exactly like the transaction-scoped SQL read-model acceptance.
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        INSERT INTO platform.student_cases (
          id, organization_id, student_membership_id,
          responsible_sales_membership_id, current_curator_membership_id,
          source_key, contract_confirmation_ref, contract_confirmed_at,
          student_display_name, target_country, target_degree, program_direction,
          intake, route_approval_status, operational_stage, state, handoff_at,
          portal_activated_at, closed_at, next_action, current_scope_id,
          current_scope_version
        )
        VALUES (
          ${ids.case}, ${ids.organization}, ${ids.studentMembership},
          ${ids.salesMembership}, ${ids.curatorMembership},
          'synthetic:e4:browser-case', 'synthetic:e4:contract',
          '2026-09-01T08:00:00Z', 'E4 Browser Student', 'United Kingdom',
          'Bachelor', 'Computer Science', '2027 Fall', 'approved', 'documents',
          'active', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', NULL,
          'Загрузить обновлённый паспорт', ${ids.caseScope}, 1
        )
      `;
      await tx`SET LOCAL session_replication_role = origin`;

      await tx`
        INSERT INTO platform.university_applications (
          id, organization_id, student_case_id, institution_name, program_name,
          status, latest_evidence_reference, created_by_membership_id, is_primary,
          university_deadline_on, country, degree
        )
        VALUES (
          ${ids.application}, ${ids.organization}, ${ids.case},
          'University of Browser Proof', 'Computer Science', 'submitted',
          'synthetic:e4:application', ${ids.curatorMembership}, TRUE,
          '2027-01-15', NULL, 'Bachelor'
        )
      `;
      await tx`
        INSERT INTO platform.university_application_events (
          id, organization_id, application_id, student_case_id, previous_status,
          new_status, evidence_reference, note, actor_membership_id, request_id,
          created_at
        )
        VALUES (
          ${ids.applicationEvent}, ${ids.organization}, ${ids.application},
          ${ids.case}, 'ready', 'submitted', 'synthetic:e4:application', NULL,
          ${ids.curatorMembership}, ${randomUUID()}, '2026-09-02T10:00:00Z'
        )
      `;
      await tx`
        INSERT INTO platform.visa_cases (
          id, organization_id, student_case_id, status,
          latest_evidence_reference, created_by_membership_id
        )
        VALUES (
          ${ids.visa}, ${ids.organization}, ${ids.case}, 'docs', NULL,
          ${ids.curatorMembership}
        )
      `;
      await tx`
        INSERT INTO platform.visa_case_events (
          id, organization_id, visa_case_id, student_case_id, previous_status,
          new_status, evidence_reference, note, actor_membership_id, request_id,
          created_at
        )
        VALUES (
          ${ids.visaEvent}, ${ids.organization}, ${ids.visa}, ${ids.case}, NULL,
          'docs', NULL, NULL, ${ids.curatorMembership}, ${randomUUID()},
          '2026-09-02T11:00:00Z'
        )
      `;
      // Staff finance requires paid totals to agree with payment events. The
      // review fixture has no payment confirmations, so its obligation is unpaid.
      // Preserve the existing Student-only snapshot when review is not enabled.
      await tx`
        INSERT INTO platform.payment_obligations (
          id, organization_id, student_case_id, label, category, amount_minor,
          currency, due_at, next_action, total_paid_minor,
          total_refunded_minor, created_by_membership_id
        )
        VALUES (
          ${ids.obligation}, ${ids.organization}, ${ids.case},
          'Сервисный сбор EVO', 'evo_service_fee', 100000, 'USD',
          '2027-01-20T08:00:00Z', 'Оплатить остаток',
          ${process.env.EVO_E4_REVIEW_UI_FIXTURE === "1" ? 0 : 40000}, 0,
          ${ids.curatorMembership}
        )
      `;
      await tx`
        INSERT INTO platform.document_requirements (
          id, organization_id, target_country, target_degree, program_direction,
          checklist_version, requirement_key, label, instructions, status,
          created_by_membership_id
        )
        VALUES (
          ${ids.requirement}, ${ids.organization}, 'United Kingdom', 'Bachelor',
          'Computer Science', 1, 'passport', 'Паспорт',
          'Загрузите читаемую копию паспорта.', 'active', ${ids.adminMembership}
        )
      `;
      await tx`
        INSERT INTO platform.document_slots (
          id, organization_id, student_case_id, requirement_id, status,
          deadline, next_action, created_by_membership_id
        )
        VALUES (
          ${ids.slot}, ${ids.organization}, ${ids.case}, ${ids.requirement},
          'required', '2027-01-10T08:00:00Z',
          'Загрузить новую копию', ${ids.curatorMembership}
        )
      `;
      await tx`
        INSERT INTO platform.document_versions (
          id, organization_id, student_case_id, document_slot_id, version_no,
          original_filename, declared_mime_type, byte_size, sha256_hex,
          ingest_evidence_ref, submitted_by_membership_id, integrity_status,
          malware_status, validation_updated_at
        )
        VALUES (
          ${ids.version}, ${ids.organization}, ${ids.case}, ${ids.slot}, 1,
          'passport.pdf', 'application/pdf', 2048, ${"a".repeat(64)},
          'synthetic:e4:document', ${ids.studentMembership}, 'verified', 'pending',
          '2026-09-03T08:00:00Z'
        )
      `;
      await tx`
        UPDATE platform.document_slots
        SET status = 'submitted', current_version_id = ${ids.version},
          current_version_no = 1
        WHERE id = ${ids.slot}
      `;
      await tx`
        UPDATE platform.document_slots
        SET status = 'rejected'
        WHERE id = ${ids.slot}
      `;
      await tx`
        INSERT INTO platform.document_reviews (
          id, organization_id, student_case_id, document_slot_id,
          document_version_id, decision, reason, reviewer_membership_id,
          request_id, created_at
        )
        VALUES (
          ${ids.review}, ${ids.organization}, ${ids.case}, ${ids.slot},
          ${ids.version}, 'rejected',
          'Загрузите более чёткую копию паспорта.', ${ids.curatorMembership},
          ${randomUUID()}, '2026-09-03T09:00:00Z'
        )
      `;
      await tx`
        INSERT INTO platform.notifications (
          id, organization_id, student_case_id, recipient_membership_id,
          category, title, body, dedupe_key, created_by_membership_id,
          created_at, updated_at
        )
        VALUES (
          ${ids.notification}, ${ids.organization}, ${ids.case},
          ${ids.studentMembership}, 'document.review',
          'Требуется исправление документа',
          'Загрузите более чёткую копию паспорта.',
          ${`synthetic:e4:notification:${ids.notification}`},
          ${ids.curatorMembership}, '2026-09-03T09:00:00Z',
          '2026-09-03T09:00:00Z'
        )
      `;
      await tx`
        INSERT INTO platform.student_portal_notification_projection_v1 (
          notification_id, organization_id, student_case_id,
          recipient_membership_id, source_record_id, document_slot_id,
          document_version_id, document_requirement_id, review_decision,
          requirement_label, created_at
        )
        VALUES (
          ${ids.notification}, ${ids.organization}, ${ids.case},
          ${ids.studentMembership}, ${ids.review}, ${ids.slot}, ${ids.version},
          ${ids.requirement}, 'rejected', 'Паспорт', '2026-09-03T09:00:00Z'
        )
      `;

      if (process.env.EVO_E4_REVIEW_UI_FIXTURE === "1") {
        // The staff document route reads its historical Sales handoff and three
        // starter tasks as well as documents. These are explicit synthetic
        // upstream snapshots, not proof of a Sales handoff, contract or payment.
        const clientId = randomUUID();
        const leadId = randomUUID();
        await tx`
          INSERT INTO platform.clients (id, organization_id, display_name, normalized_name)
          VALUES (${clientId}, ${ids.organization}, 'E4 Browser Student', platform_private.normalize_person_name('E4 Browser Student'))
        `;
        await tx`
          INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key)
          VALUES (${leadId}, ${ids.organization}, ${clientId}, ${ids.salesMembership}, 'qualified', 'e4-browser.synthetic')
        `;
        await tx`
          INSERT INTO platform.sales_admissions_handoffs
            (organization_id, lead_id, client_id, student_case_id, source_key, handoff_mode, reason,
             actor_membership_id, actor_profile_id, admissions_owner_membership_id,
             gate_version, gate_state, workflow_version, sales_context, client_context, provenance, conversation_links)
          VALUES (${ids.organization}, ${leadId}, ${clientId}, ${ids.case}, ${`canonical-lead:${leadId}`}, 'normal',
            'Synthetic historical context for the document-review browser fixture; not business evidence',
            ${ids.salesMembership}, ${ids.salesProfile}, ${ids.curatorMembership}, 1, 'satisfied', 1,
            ${tx.json({ lead_id: leadId, stage_key: "qualified", source_key: "e4-browser.synthetic",
              current_owner_membership_id: ids.salesMembership, next_action_text: null,
              next_action_due_date: null, workflow_version: "1" })},
            ${tx.json({ client_id: clientId, display_name: "E4 Browser Student" })}, '[]', '[]')
        `;
        for (const sourceKey of ["u6.sales-context-review", "u6.study-route-confirmation", "u6.document-request-plan"]) {
          await tx`
            INSERT INTO platform.case_tasks
              (organization_id, student_case_id, task_type, title, assignee_membership_id,
               student_visible, created_by_membership_id, source_key)
            VALUES (${ids.organization}, ${ids.case}, 'handoff', ${`Synthetic E4 starter: ${sourceKey}`},
              ${ids.curatorMembership}, FALSE, ${ids.salesMembership}, ${sourceKey})
          `;
        }
        await tx`
          INSERT INTO platform_private.student_portal_notification_runtime_controls
            (organization_id, enabled) VALUES (${ids.organization}, TRUE)
        `;
        // Authorized synthetic metadata for the negative-review UI only. There
        // are no Storage bytes or ClamAV attestations: approval must stay disabled.
        // Model the retained pre-116 reservation shape explicitly; current upload
        // commands still require ingress scanning and are never called or bypassed.
        // Separate slots prevent the two mobile projects sharing a mutable version.
        for (const width of [320, 393]) {
          const requirementId = randomUUID();
          const slotId = randomUUID();
          const versionId = randomUUID();
          const reservationId = randomUUID();
          const auditId = randomUUID();
          const objectHash = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
          const objectName = `${objectHash.slice(0, 2)}/${objectHash.slice(2)}`;
          await tx`
            INSERT INTO platform.document_requirements
              (id, organization_id, requirement_key, label, target_country, target_degree,
               program_direction, checklist_version, instructions, created_by_membership_id)
            VALUES (${requirementId}, ${ids.organization}, ${`e4_review_${width}`},
              ${`Проверка интерфейса ${width}`}, 'United Kingdom', 'Bachelor',
              'Computer Science', 1, 'Synthetic finalized metadata; no Storage bytes or scanner proof.', ${ids.adminMembership})
          `;
          await tx`
            INSERT INTO platform.document_slots
              (id, organization_id, student_case_id, requirement_id, status, created_by_membership_id)
            VALUES (${slotId}, ${ids.organization}, ${ids.case}, ${requirementId}, 'required', ${ids.adminMembership})
          `;
          await tx`
            INSERT INTO platform.document_versions
              (id, organization_id, student_case_id, document_slot_id, version_no,
               original_filename, declared_mime_type, byte_size, sha256_hex,
               ingest_evidence_ref, submitted_by_membership_id, integrity_status, malware_status)
            VALUES (${versionId}, ${ids.organization}, ${ids.case}, ${slotId}, 1,
              ${`synthetic-e4-unscanned-${width}.pdf`}, 'application/pdf', 2048, ${"b".repeat(64)},
              'synthetic:e4:finalized-unscanned-metadata-only', ${ids.studentMembership}, 'verified', 'pending')
          `;
          await tx`
            INSERT INTO platform_private.document_upload_reservations
              (id, request_id, organization_id, student_case_id, document_slot_id, document_version_id,
               uploader_profile_id, uploader_membership_id, uploader_auth_user_id, object_name,
               declared_mime_type, byte_size, sha256_hex, expires_at, ingress_scan_required)
            VALUES (${reservationId}, ${randomUUID()}, ${ids.organization}, ${ids.case}, ${slotId}, ${versionId},
              ${ids.studentProfile}, ${ids.studentMembership}, ${authUserIds.student}, ${objectName},
              'application/pdf', 2048, ${"b".repeat(64)}, statement_timestamp() + interval '5 minutes', FALSE)
          `;
          await tx`
            INSERT INTO platform.audit_events
              (id, organization_id, actor_kind, actor_principal, action, resource_type, resource_id,
               after_state, reason, request_id)
            VALUES (${auditId}, ${ids.organization}, 'system', 'synthetic:e4:browser-fixture',
              'document.version.finalize', 'document_version', ${versionId},
              '{"synthetic_metadata_only":true,"storage_bytes":false,"scanner_proof":false}'::jsonb,
              'Synthetic finalized metadata for negative-review UI; no actual uploaded or scanned bytes', ${randomUUID()})
          `;
          await tx`
            INSERT INTO platform_private.document_upload_finalizations
              (id, request_id, organization_id, upload_reservation_id, student_case_id, document_version_id,
               document_slot_id, finalization_audit_event_id, bucket_id, object_name, published_version_no, object_created_at)
            VALUES (${randomUUID()}, ${randomUUID()}, ${ids.organization}, ${reservationId}, ${ids.case}, ${versionId},
              ${slotId}, ${auditId}, 'platform-documents', ${objectName}, 1, statement_timestamp())
          `;
          await tx`
            UPDATE platform.document_slots SET status = 'submitted', current_version_id = ${versionId}, current_version_no = 1
            WHERE id = ${slotId}
          `;
        }
      }
    });

    const [shape] = await sql`
      SELECT
        (
          SELECT pg_catalog.count(*)::INTEGER
          FROM platform.student_cases
          WHERE id = ${ids.case} AND portal_activated_at IS NOT NULL
        ) AS case_count,
        (
          SELECT pg_catalog.count(*)::INTEGER
          FROM platform.student_portal_notification_projection_v1
          WHERE notification_id = ${ids.notification}
        ) AS notification_count
    `;
    if (shape?.case_count !== 1 || shape?.notification_count !== 1) {
      fail("PORTAL_FIXTURE_SHAPE_INVALID");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  await writeFile(
    resultPath,
    `${JSON.stringify({
      organizationId: ids.organization,
      ...(process.env.EVO_E4_REVIEW_UI_FIXTURE === "1" ? { caseId: ids.case } : {}),
      studentMembershipId: ids.studentMembership,
      notificationId: ids.notification,
    })}\n`,
    { mode: 0o600 },
  );
  await chmod(resultPath, 0o600);
  console.log(
    `LOCAL_STUDENT_PORTAL_BROWSER_PROVISIONED ${ids.organization} ${ids.studentMembership} ${ids.notification}`,
  );
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof ProvisioningFailure
      ? error.code
      : unexpectedFailureCode(error);
  console.error(`LOCAL_STUDENT_PORTAL_BROWSER_ERROR:${code}`);
  process.exitCode = 1;
}
