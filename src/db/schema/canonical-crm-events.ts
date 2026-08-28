import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const evoCommandReceipts = pgTable(
  "evo_command_receipts",
  {
    id: text("id").primaryKey(),
    commandName: text("command_name").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    actorRole: text("actor_role").notNull(),
    businessObjectType: text("business_object_type"),
    businessObjectId: text("business_object_id"),
    status: text("status").default("processing").notNull(),
    resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
    failureCode: text("failure_code"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_command_receipts_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("evo_command_receipts_correlation_idx").on(table.correlationId),
    check(
      "evo_command_receipts_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_command_receipts_command_name_check",
      sql`char_length(btrim(${table.commandName})) > 0`,
    ),
    check(
      "evo_command_receipts_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check(
      "evo_command_receipts_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "evo_command_receipts_correlation_check",
      sql`char_length(btrim(${table.correlationId})) > 0`,
    ),
    check(
      "evo_command_receipts_actor_role_check",
      sql`${table.actorRole} in ('admin', 'sales', 'admissions')`,
    ),
    check(
      "evo_command_receipts_object_check",
      sql`(${table.businessObjectType} is null and ${table.businessObjectId} is null) or (${table.businessObjectType} is not null and char_length(btrim(${table.businessObjectType})) > 0 and ${table.businessObjectId} is not null and ${table.businessObjectId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`,
    ),
    check(
      "evo_command_receipts_status_check",
      sql`${table.status} in ('processing', 'succeeded', 'failed')`,
    ),
    check(
      "evo_command_receipts_completion_check",
      sql`(${table.status} = 'processing' and ${table.resultPayload} is null and ${table.failureCode} is null and ${table.completedAt} is null) or (${table.status} = 'succeeded' and ${table.resultPayload} is not null and jsonb_typeof(${table.resultPayload}) = 'object' and ${table.failureCode} is null and ${table.completedAt} is not null) or (${table.status} = 'failed' and ${table.resultPayload} is null and ${table.failureCode} is not null and char_length(btrim(${table.failureCode})) > 0 and ${table.completedAt} is not null)`,
    ),
  ],
);

export const evoBusinessEvents = pgTable(
  "evo_business_events",
  {
    id: text("id").primaryKey(),
    actorRole: text("actor_role").notNull(),
    businessObjectType: text("business_object_type").notNull(),
    businessObjectId: text("business_object_id").notNull(),
    transition: text("transition").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    reason: text("reason"),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    eventSequence: integer("event_sequence").default(1).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_business_events_idempotency_sequence_unique").on(
      table.idempotencyKey,
      table.eventSequence,
    ),
    index("evo_business_events_object_idx").on(
      table.businessObjectType,
      table.businessObjectId,
      table.occurredAt,
    ),
    index("evo_business_events_correlation_idx").on(table.correlationId),
    check(
      "evo_business_events_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_business_events_actor_role_check",
      sql`${table.actorRole} in ('admin', 'sales', 'admissions')`,
    ),
    check(
      "evo_business_events_object_type_check",
      sql`${table.businessObjectType} in ('person', 'lead', 'conversation', 'message', 'student_case', 'gate_evidence', 'handoff', 'task', 'document', 'application', 'visa_milestone', 'finance_stop', 'ai_proposal')`,
    ),
    check(
      "evo_business_events_object_id_check",
      sql`${table.businessObjectId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_business_events_transition_check",
      sql`char_length(btrim(${table.transition})) > 0`,
    ),
    check(
      "evo_business_events_reason_check",
      sql`${table.transition} !~ '(override|reject|stop|release|close|cancel|disqual)' or (${table.reason} is not null and char_length(btrim(${table.reason})) > 0)`,
    ),
    check(
      "evo_business_events_correlation_check",
      sql`char_length(btrim(${table.correlationId})) > 0`,
    ),
    check(
      "evo_business_events_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
    check(
      "evo_business_events_sequence_check",
      sql`${table.eventSequence} > 0`,
    ),
  ],
);
