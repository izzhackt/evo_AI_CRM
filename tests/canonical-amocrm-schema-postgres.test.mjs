import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

function requiredDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required for amoCRM schema acceptance");
  const parsed = new URL(value);
  assert.ok(
    parsed.protocol === "postgres:" || parsed.protocol === "postgresql:",
    "amoCRM schema acceptance requires PostgreSQL",
  );
  return value;
}

function postgresError(code) {
  return (error) => error?.code === code;
}

test("canonical amoCRM persistence keeps PostgreSQL authoritative and provider outcomes explicit", async () => {
  const sql = postgres(requiredDatabaseUrl(), {
    idle_timeout: 5,
    max: 2,
    onnotice: () => undefined,
  });
  const runId = randomUUID();
  const accountId = randomUUID();
  const snapshotId = randomUUID();
  const personId = randomUUID();
  const leadId = randomUUID();
  const receiptId = randomUUID();
  const attemptId = randomUUID();
  const correlationId = `amocrm-schema-${runId}`;
  const idempotencyKey = `amocrm-contact-create-${runId}`;

  try {
    await sql`
      insert into evo_amocrm_accounts (
        id,
        provider_account_id,
        account_base_url,
        account_subdomain,
        account_name,
        timezone
      ) values (
        ${accountId},
        '90000001',
        'https://evo-schema-acceptance.amocrm.ru',
        'evo-schema-acceptance',
        'EVO schema acceptance',
        'Asia/Dubai'
      )
    `;

    await sql`
      insert into evo_amocrm_discovery_snapshots (
        id,
        account_id,
        snapshot_sha256,
        pipeline_catalog,
        user_catalog,
        lead_custom_field_catalog,
        contact_custom_field_catalog,
        correlation_id,
        discovered_at
      ) values (
        ${snapshotId},
        ${accountId},
        ${"a".repeat(64)},
        ${sql.json([{ id: "1001", name: "Sales" }])},
        ${sql.json([{ id: "2001", name: "Technical operator" }])},
        ${sql.json([{ id: "3001", name: "Source" }])},
        ${sql.json([{ id: "4001", name: "Phone" }])},
        ${correlationId},
        '2026-08-29T10:00:00.000Z'
      )
    `;

    await assert.rejects(
      sql`
        insert into evo_amocrm_discovery_snapshots (
          id,
          account_id,
          snapshot_sha256,
          pipeline_catalog,
          user_catalog,
          lead_custom_field_catalog,
          contact_custom_field_catalog,
          correlation_id,
          discovered_at
        ) values (
          ${randomUUID()},
          ${accountId},
          ${"b".repeat(64)},
          ${sql.json([{ access_token: "must-never-be-persisted" }])},
          '[]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          ${`${correlationId}-unsafe`},
          '2026-08-29T10:01:00.000Z'
        )
      `,
      postgresError("23514"),
    );

    await sql`
      insert into evo_people (id, full_name, email)
      values (${personId}, ${`amo schema ${runId}`}, ${`${runId}@acceptance.invalid`})
    `;
    await sql`
      insert into evo_leads (id, person_id, source)
      values (${leadId}, ${personId}, ${`amocrm-schema-${runId}`})
    `;
    await sql`
      insert into evo_command_receipts (
        id,
        command_name,
        idempotency_key,
        request_hash,
        correlation_id,
        actor_role,
        business_object_type,
        business_object_id
      ) values (
        ${receiptId},
        'amocrm.contact.create',
        ${idempotencyKey},
        ${"c".repeat(64)},
        ${correlationId},
        'sales',
        'person',
        ${personId}
      )
    `;
    await sql`
      insert into evo_amocrm_operation_attempts (
        id,
        account_id,
        command_receipt_id,
        operation_name,
        person_id,
        actor_role,
        provider_request_metadata,
        provider_request_sha256,
        prepared_at,
        correlation_id,
        idempotency_key
      ) values (
        ${attemptId},
        ${accountId},
        ${receiptId},
        'contact_create',
        ${personId},
        'sales',
        ${sql.json({ method: "POST", path: "/api/v4/contacts", bodyFields: ["name"] })},
        ${"5".repeat(64)},
        '2026-08-29T10:01:00.000Z',
        ${correlationId},
        ${idempotencyKey}
      )
    `;

    const preparedCreate = await sql`
      select
        status,
        target_contact_id,
        target_lead_id,
        result_contact_id,
        result_lead_id,
        provider_request_metadata,
        provider_request_sha256,
        provider_dispatched_at
      from evo_amocrm_operation_attempts
      where id = ${attemptId}
    `;
    assert.deepEqual(Array.from(preparedCreate), [
      {
        status: "prepared",
        target_contact_id: null,
        target_lead_id: null,
        result_contact_id: null,
        result_lead_id: null,
        provider_request_metadata: {
          method: "POST",
          path: "/api/v4/contacts",
          bodyFields: ["name"],
        },
        provider_request_sha256: "5".repeat(64),
        provider_dispatched_at: null,
      },
    ]);

    await assert.rejects(
      sql`
        update evo_amocrm_operation_attempts
        set provider_request_metadata = ${sql.json({
          method: "POST",
          path: "/api/v4/contacts",
          headers: { accept: "application/json" },
        })}
        where id = ${attemptId}
      `,
      postgresError("23514"),
    );
    await assert.rejects(
      sql`
        update evo_amocrm_operation_attempts
        set provider_request_metadata = ${sql.json({
          method: "POST",
          path: "/api/v4/contacts",
          client_secret: "must-never-be-persisted",
        })}
        where id = ${attemptId}
      `,
      postgresError("23514"),
    );
    await assert.rejects(
      sql`
        update evo_amocrm_operation_attempts
        set target_contact_id = '5001'
        where id = ${attemptId}
      `,
      postgresError("23514"),
    );

    await assert.rejects(
      sql`
        update evo_amocrm_operation_attempts
        set
          status = 'accepted',
          result_contact_id = '5001',
          provider_readback = ${sql.json({ access_token: "must-never-be-persisted" })},
          provider_readback_sha256 = ${"d".repeat(64)},
          provider_readback_at = '2026-08-29T10:02:00.000Z',
          provider_dispatched_at = '2026-08-29T10:01:30.000Z',
          provider_responded_at = '2026-08-29T10:01:31.000Z',
          provider_http_status = 201,
          provider_request_id = 'request-contact-unsafe',
          settled_at = '2026-08-29T10:02:00.000Z'
        where id = ${attemptId}
      `,
      postgresError("23514"),
    );

    await sql`
      update evo_amocrm_operation_attempts
      set
        status = 'accepted',
        result_contact_id = '5001',
        provider_readback = ${sql.json({ id: "5001", updated_at: 1787997720 })},
        provider_readback_sha256 = ${"e".repeat(64)},
        provider_readback_at = '2026-08-29T10:03:00.000Z',
        provider_dispatched_at = '2026-08-29T10:02:30.000Z',
        provider_responded_at = '2026-08-29T10:02:31.000Z',
        provider_http_status = 201,
        provider_request_id = 'request-contact-create',
        settled_at = '2026-08-29T10:03:00.000Z',
        updated_at = '2026-08-29T10:03:00.000Z'
      where id = ${attemptId}
    `;
    await sql`
      update evo_command_receipts
      set
        status = 'succeeded',
        result_payload = ${sql.json({ attemptId, providerContactId: "5001" })},
        completed_at = '2026-08-29T10:03:00.000Z',
        updated_at = '2026-08-29T10:03:00.000Z'
      where id = ${receiptId}
    `;

    const unknownReceiptId = randomUUID();
    const unknownAttemptId = randomUUID();
    const unknownIdempotencyKey = `amocrm-lead-update-unknown-${runId}`;
    await sql`
      insert into evo_command_receipts (
        id,
        command_name,
        idempotency_key,
        request_hash,
        correlation_id,
        actor_role,
        business_object_type,
        business_object_id
      ) values (
        ${unknownReceiptId},
        'amocrm.lead.update',
        ${unknownIdempotencyKey},
        ${"f".repeat(64)},
        ${`${correlationId}-unknown`},
        'sales',
        'lead',
        ${leadId}
      )
    `;
    await sql`
      insert into evo_amocrm_operation_attempts (
        id,
        account_id,
        command_receipt_id,
        operation_name,
        lead_id,
        actor_role,
        target_lead_id,
        provider_request_metadata,
        provider_request_sha256,
        prepared_at,
        correlation_id,
        idempotency_key
      ) values (
        ${unknownAttemptId},
        ${accountId},
        ${unknownReceiptId},
        'lead_update',
        ${leadId},
        'sales',
        '6002',
        ${sql.json({ method: "PATCH", path: "/api/v4/leads/6002", bodyFields: ["name"] })},
        ${"6".repeat(64)},
        '2026-08-29T10:03:30.000Z',
        ${`${correlationId}-unknown`},
        ${unknownIdempotencyKey}
      )
    `;
    const preparedUpdate = await sql`
      select
        status,
        target_contact_id,
        target_lead_id,
        result_contact_id,
        result_lead_id,
        provider_request_metadata,
        provider_request_sha256,
        provider_dispatched_at
      from evo_amocrm_operation_attempts
      where id = ${unknownAttemptId}
    `;
    assert.deepEqual(Array.from(preparedUpdate), [
      {
        status: "prepared",
        target_contact_id: null,
        target_lead_id: "6002",
        result_contact_id: null,
        result_lead_id: null,
        provider_request_metadata: {
          method: "PATCH",
          path: "/api/v4/leads/6002",
          bodyFields: ["name"],
        },
        provider_request_sha256: "6".repeat(64),
        provider_dispatched_at: null,
      },
    ]);
    await sql`
      update evo_amocrm_operation_attempts
      set
        status = 'unknown',
        result_lead_id = '6002',
        failure_code = 'provider_outcome_unknown',
        provider_dispatched_at = '2026-08-29T10:03:45.000Z',
        provider_responded_at = '2026-08-29T10:03:46.000Z',
        provider_http_status = 200,
        provider_request_id = 'request-lead-update-unknown',
        settled_at = '2026-08-29T10:04:00.000Z',
        updated_at = '2026-08-29T10:04:00.000Z'
      where id = ${unknownAttemptId}
    `;
    await sql`
      update evo_amocrm_operation_attempts
      set
        provider_readback = ${sql.json({ matches: [] })},
        provider_readback_sha256 = ${"1".repeat(64)},
        provider_readback_at = '2026-08-29T10:05:00.000Z',
        last_reconciled_at = '2026-08-29T10:05:00.000Z',
        updated_at = '2026-08-29T10:05:00.000Z'
      where id = ${unknownAttemptId}
    `;
    await sql`
      update evo_command_receipts
      set
        status = 'failed',
        failure_code = 'provider_outcome_unknown',
        completed_at = '2026-08-29T10:04:00.000Z',
        updated_at = '2026-08-29T10:04:00.000Z'
      where id = ${unknownReceiptId}
    `;

    const rejectedReceiptId = randomUUID();
    const rejectedAttemptId = randomUUID();
    const rejectedIdempotencyKey = `amocrm-lead-note-rejected-${runId}`;
    await sql`
      insert into evo_command_receipts (
        id,
        command_name,
        idempotency_key,
        request_hash,
        correlation_id,
        actor_role,
        business_object_type,
        business_object_id
      ) values (
        ${rejectedReceiptId},
        'amocrm.lead.note.create',
        ${rejectedIdempotencyKey},
        ${"2".repeat(64)},
        ${`${correlationId}-rejected`},
        'sales',
        'lead',
        ${leadId}
      )
    `;
    await sql`
      insert into evo_amocrm_operation_attempts (
        id,
        account_id,
        command_receipt_id,
        operation_name,
        lead_id,
        actor_role,
        target_lead_id,
        provider_request_metadata,
        provider_request_sha256,
        prepared_at,
        correlation_id,
        idempotency_key
      ) values (
        ${rejectedAttemptId},
        ${accountId},
        ${rejectedReceiptId},
        'lead_note_create',
        ${leadId},
        'sales',
        '6001',
        ${sql.json({ method: "POST", path: "/api/v4/leads/6001/notes", bodyFields: ["note_type", "params"] })},
        ${"7".repeat(64)},
        '2026-08-29T10:05:30.000Z',
        ${`${correlationId}-rejected`},
        ${rejectedIdempotencyKey}
      )
    `;
    await sql`
      update evo_amocrm_operation_attempts
      set
        status = 'rejected',
        failure_code = 'provider_validation_failed',
        provider_readback = ${sql.json({ status: 400, title: "Bad Request" })},
        provider_readback_sha256 = ${"3".repeat(64)},
        provider_readback_at = '2026-08-29T10:06:00.000Z',
        provider_dispatched_at = '2026-08-29T10:05:45.000Z',
        provider_responded_at = '2026-08-29T10:05:46.000Z',
        provider_http_status = 400,
        provider_request_id = 'request-lead-note-rejected',
        settled_at = '2026-08-29T10:06:00.000Z',
        updated_at = '2026-08-29T10:06:00.000Z'
      where id = ${rejectedAttemptId}
    `;
    await sql`
      update evo_command_receipts
      set
        status = 'failed',
        failure_code = 'provider_validation_failed',
        completed_at = '2026-08-29T10:06:00.000Z',
        updated_at = '2026-08-29T10:06:00.000Z'
      where id = ${rejectedReceiptId}
    `;

    await assert.rejects(
      sql`
        insert into evo_amocrm_lead_bindings (
          id,
          account_id,
          lead_id,
          provider_lead_id,
          created_by_attempt_id,
          created_by_attempt_status,
          last_verified_at
        ) values (
          ${randomUUID()},
          ${accountId},
          ${leadId},
          '6002',
          ${unknownAttemptId},
          'accepted',
          '2026-08-29T10:06:10.000Z'
        )
      `,
      postgresError("23503"),
    );
    await assert.rejects(
      sql`
        insert into evo_amocrm_lead_bindings (
          id,
          account_id,
          lead_id,
          provider_lead_id,
          created_by_attempt_id,
          created_by_attempt_status,
          last_verified_at
        ) values (
          ${randomUUID()},
          ${accountId},
          ${leadId},
          '6001',
          ${rejectedAttemptId},
          'accepted',
          '2026-08-29T10:06:11.000Z'
        )
      `,
      postgresError("23503"),
    );

    await sql`
      insert into evo_amocrm_contact_bindings (
        id,
        account_id,
        person_id,
        provider_contact_id,
        created_by_attempt_id,
        created_by_attempt_status,
        last_verified_at
      ) values (
        ${randomUUID()},
        ${accountId},
        ${personId},
        '5001',
        ${attemptId},
        'accepted',
        '2026-08-29T10:03:00.000Z'
      )
    `;
    await sql`
      insert into evo_amocrm_lead_bindings (
        id,
        account_id,
        lead_id,
        provider_lead_id,
        created_by_attempt_id,
        created_by_attempt_status,
        last_verified_at
      ) values (
        ${randomUUID()},
        ${accountId},
        ${leadId},
        '6001',
        null,
        null,
        '2026-08-29T10:03:00.000Z'
      )
    `;

    const invalidTargetReceiptId = randomUUID();
    const invalidTargetIdempotencyKey = `amocrm-invalid-target-${runId}`;
    await sql`
      insert into evo_command_receipts (
        id,
        command_name,
        idempotency_key,
        request_hash,
        correlation_id,
        actor_role
      ) values (
        ${invalidTargetReceiptId},
        'amocrm.lead.update',
        ${invalidTargetIdempotencyKey},
        ${"4".repeat(64)},
        ${`${correlationId}-bad-target`},
        'sales'
      )
    `;
    await assert.rejects(
      sql`
        insert into evo_amocrm_contact_bindings (
          id,
          account_id,
          person_id,
          provider_contact_id,
          last_verified_at
        ) values (
          ${randomUUID()},
          ${accountId},
          ${personId},
          '5002',
          '2026-08-29T10:04:00.000Z'
        )
      `,
      postgresError("23505"),
    );

    await assert.rejects(
      sql`
        insert into evo_amocrm_operation_attempts (
          id,
          account_id,
          command_receipt_id,
          operation_name,
          lead_id,
          actor_role,
          provider_request_metadata,
          provider_request_sha256,
          prepared_at,
          correlation_id,
          idempotency_key
        ) values (
          ${randomUUID()},
          ${accountId},
          ${invalidTargetReceiptId},
          'lead_update',
          ${leadId},
          'sales',
          ${sql.json({ method: "PATCH", path: "/api/v4/leads/6001", bodyFields: ["name"] })},
          ${"8".repeat(64)},
          '2026-08-29T10:07:00.000Z',
          ${`${correlationId}-bad-target`},
          ${invalidTargetIdempotencyKey}
        )
      `,
      postgresError("23514"),
    );

    const secretColumns = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name like 'evo_amocrm_%'
        and column_name ~* '(token|secret|authorization|api_key)'
      order by table_name, column_name
    `;
    assert.equal(secretColumns.length, 0);

    const persisted = await sql`
      select
        attempts.status,
        attempts.result_contact_id,
        attempts.provider_http_status,
        attempts.provider_request_id,
        contacts.person_id,
        leads.lead_id,
        leads.created_by_attempt_id as lead_creation_attempt_id,
        leads.created_by_attempt_status as lead_creation_attempt_status,
        snapshots.snapshot_sha256
      from evo_amocrm_operation_attempts attempts
      join evo_amocrm_contact_bindings contacts
        on contacts.created_by_attempt_id = attempts.id
      join evo_amocrm_lead_bindings leads
        on leads.account_id = attempts.account_id
      join evo_amocrm_discovery_snapshots snapshots
        on snapshots.account_id = attempts.account_id
      where attempts.id = ${attemptId}
    `;
    assert.deepEqual(Array.from(persisted), [
      {
        status: "accepted",
        result_contact_id: "5001",
        provider_http_status: 201,
        provider_request_id: "request-contact-create",
        person_id: personId,
        lead_id: leadId,
        lead_creation_attempt_id: null,
        lead_creation_attempt_status: null,
        snapshot_sha256: "a".repeat(64),
      },
    ]);

    const providerStatuses = await sql`
      select status, count(*)::int as count
      from evo_amocrm_operation_attempts
      where account_id = ${accountId}
      group by status
      order by status
    `;
    assert.deepEqual(Array.from(providerStatuses), [
      { status: "accepted", count: 1 },
      { status: "rejected", count: 1 },
      { status: "unknown", count: 1 },
    ]);

    const retainedTargets = await sql`
      select
        status,
        target_lead_id,
        result_lead_id,
        provider_request_metadata ->> 'method' as request_method,
        provider_request_sha256,
        provider_dispatched_at is not null as dispatched,
        provider_responded_at is not null as responded,
        provider_http_status,
        provider_request_id
      from evo_amocrm_operation_attempts
      where id in (${unknownAttemptId}, ${rejectedAttemptId})
      order by status
    `;
    assert.deepEqual(Array.from(retainedTargets), [
      {
        status: "rejected",
        target_lead_id: "6002",
        result_lead_id: "6002",
        request_method: "POST",
        provider_request_sha256: "7".repeat(64),
        dispatched: true,
        responded: true,
        provider_http_status: 400,
        provider_request_id: "request-lead-note-rejected",
      },
      {
        status: "unknown",
        target_lead_id: "6001",
        result_lead_id: null,
        request_method: "PATCH",
        provider_request_sha256: "6".repeat(64),
        dispatched: true,
        responded: true,
        provider_http_status: 200,
        provider_request_id: "request-lead-update-unknown",
      },
    ]);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
