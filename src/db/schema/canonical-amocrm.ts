import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { evoLeads, evoPeople } from "./canonical-crm-core.ts";
import { evoCommandReceipts } from "./canonical-crm-events.ts";

export const EVO_AMOCRM_OPERATION_NAMES = [
  "contact_create",
  "contact_update",
  "lead_create",
  "lead_update",
  "contact_lead_link",
  "lead_pipeline_status_update",
  "lead_responsible_update",
  "lead_note_create",
  "lead_tag_update",
] as const;
export type EvoAmoCrmOperationName =
  (typeof EVO_AMOCRM_OPERATION_NAMES)[number];

export const EVO_AMOCRM_ATTEMPT_STATUSES = [
  "prepared",
  "accepted",
  "unknown",
  "rejected",
] as const;
export type EvoAmoCrmAttemptStatus =
  (typeof EVO_AMOCRM_ATTEMPT_STATUSES)[number];

export const evoAmoCrmAccounts = pgTable(
  "evo_amocrm_accounts",
  {
    id: text("id").primaryKey(),
    provider: text("provider").default("amocrm").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accountBaseUrl: text("account_base_url").notNull(),
    accountSubdomain: text("account_subdomain").notNull(),
    accountName: text("account_name").notNull(),
    timezone: text("timezone").notNull(),
    country: text("country"),
    version: integer("version").default(1).notNull(),
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
    unique("evo_amocrm_accounts_provider_id_unique").on(
      table.provider,
      table.providerAccountId,
    ),
    unique("evo_amocrm_accounts_base_url_unique").on(table.accountBaseUrl),
    unique("evo_amocrm_accounts_subdomain_unique").on(table.accountSubdomain),
    check(
      "evo_amocrm_accounts_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_amocrm_accounts_provider_check",
      sql`${table.provider} = 'amocrm'`,
    ),
    check(
      "evo_amocrm_accounts_provider_id_check",
      sql`${table.providerAccountId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check(
      "evo_amocrm_accounts_base_url_check",
      sql`${table.accountBaseUrl} ~ '^https://[a-z0-9][a-z0-9-]{0,62}[.](amocrm[.]ru|kommo[.]com)$'`,
    ),
    check(
      "evo_amocrm_accounts_subdomain_check",
      sql`${table.accountSubdomain} ~ '^[a-z0-9][a-z0-9-]{0,62}$'`,
    ),
    check(
      "evo_amocrm_accounts_name_check",
      sql`char_length(btrim(${table.accountName})) between 1 and 255`,
    ),
    check(
      "evo_amocrm_accounts_timezone_check",
      sql`char_length(btrim(${table.timezone})) between 1 and 128`,
    ),
    check(
      "evo_amocrm_accounts_country_check",
      sql`${table.country} is null or char_length(btrim(${table.country})) between 1 and 128`,
    ),
    check("evo_amocrm_accounts_version_check", sql`${table.version} > 0`),
  ],
);

export const evoAmoCrmDiscoverySnapshots = pgTable(
  "evo_amocrm_discovery_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => evoAmoCrmAccounts.id, { onDelete: "restrict" }),
    snapshotSha256: text("snapshot_sha256").notNull(),
    pipelineCatalog: jsonb("pipeline_catalog")
      .$type<Array<Record<string, unknown>>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    userCatalog: jsonb("user_catalog")
      .$type<Array<Record<string, unknown>>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    leadCustomFieldCatalog: jsonb("lead_custom_field_catalog")
      .$type<Array<Record<string, unknown>>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    contactCustomFieldCatalog: jsonb("contact_custom_field_catalog")
      .$type<Array<Record<string, unknown>>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    redactionVersion: integer("redaction_version").default(1).notNull(),
    correlationId: text("correlation_id").notNull(),
    discoveredAt: timestamp("discovered_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_amocrm_discovery_account_hash_unique").on(
      table.accountId,
      table.snapshotSha256,
    ),
    index("evo_amocrm_discovery_account_time_idx").on(
      table.accountId,
      table.discoveredAt,
    ),
    check(
      "evo_amocrm_discovery_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_amocrm_discovery_snapshot_hash_check",
      sql`${table.snapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "evo_amocrm_discovery_catalog_shape_check",
      sql`jsonb_typeof(${table.pipelineCatalog}) = 'array' and jsonb_typeof(${table.userCatalog}) = 'array' and jsonb_typeof(${table.leadCustomFieldCatalog}) = 'array' and jsonb_typeof(${table.contactCustomFieldCatalog}) = 'array'`,
    ),
    check(
      "evo_amocrm_discovery_catalog_size_check",
      sql`octet_length(${table.pipelineCatalog}::text) <= 1048576 and octet_length(${table.userCatalog}::text) <= 1048576 and octet_length(${table.leadCustomFieldCatalog}::text) <= 1048576 and octet_length(${table.contactCustomFieldCatalog}::text) <= 1048576`,
    ),
    check(
      "evo_amocrm_discovery_catalog_secret_check",
      sql`(${table.pipelineCatalog}::text || ${table.userCatalog}::text || ${table.leadCustomFieldCatalog}::text || ${table.contactCustomFieldCatalog}::text) !~* '"[^"]*(token|secret|authorization|api[_-]?key)[^"]*"[[:space:]]*:'`,
    ),
    check(
      "evo_amocrm_discovery_redaction_check",
      sql`${table.redactionVersion} = 1`,
    ),
    check(
      "evo_amocrm_discovery_correlation_check",
      sql`char_length(btrim(${table.correlationId})) between 1 and 255`,
    ),
  ],
);

export const evoAmoCrmOperationAttempts = pgTable(
  "evo_amocrm_operation_attempts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => evoAmoCrmAccounts.id, { onDelete: "restrict" }),
    commandReceiptId: text("command_receipt_id")
      .notNull()
      .references(() => evoCommandReceipts.id, { onDelete: "restrict" }),
    provider: text("provider").default("amocrm").notNull(),
    operationName: text("operation_name").notNull(),
    personId: text("person_id").references(() => evoPeople.id, {
      onDelete: "restrict",
    }),
    leadId: text("lead_id").references(() => evoLeads.id, {
      onDelete: "restrict",
    }),
    actorRole: text("actor_role").notNull(),
    status: text("status").default("prepared").notNull(),
    providerRequestMetadata: jsonb("provider_request_metadata")
      .$type<Record<string, unknown>>()
      .notNull(),
    providerRequestSha256: text("provider_request_sha256").notNull(),
    preparedAt: timestamp("prepared_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    targetContactId: text("target_contact_id"),
    targetLeadId: text("target_lead_id"),
    resultContactId: text("result_contact_id"),
    resultLeadId: text("result_lead_id"),
    providerHttpStatus: integer("provider_http_status"),
    providerRequestId: text("provider_request_id"),
    providerDispatchedAt: timestamp("provider_dispatched_at", {
      withTimezone: true,
      mode: "date",
    }),
    providerRespondedAt: timestamp("provider_responded_at", {
      withTimezone: true,
      mode: "date",
    }),
    providerReadback: jsonb("provider_readback").$type<Record<string, unknown>>(),
    providerReadbackSha256: text("provider_readback_sha256"),
    providerReadbackAt: timestamp("provider_readback_at", {
      withTimezone: true,
      mode: "date",
    }),
    failureCode: text("failure_code"),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    version: integer("version").default(1).notNull(),
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
    settledAt: timestamp("settled_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastReconciledAt: timestamp("last_reconciled_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("evo_amocrm_attempts_receipt_unique").on(table.commandReceiptId),
    unique("evo_amocrm_attempts_idempotency_unique").on(table.idempotencyKey),
    unique("evo_amocrm_attempts_contact_binding_unique").on(
      table.accountId,
      table.id,
      table.personId,
      table.resultContactId,
    ),
    unique("evo_amocrm_attempts_lead_binding_unique").on(
      table.accountId,
      table.id,
      table.leadId,
      table.resultLeadId,
    ),
    index("evo_amocrm_attempts_account_status_idx").on(
      table.accountId,
      table.status,
      table.createdAt,
    ),
    index("evo_amocrm_attempts_person_created_idx").on(
      table.personId,
      table.createdAt,
    ),
    index("evo_amocrm_attempts_lead_created_idx").on(
      table.leadId,
      table.createdAt,
    ),
    check(
      "evo_amocrm_attempts_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check("evo_amocrm_attempts_provider_check", sql`${table.provider} = 'amocrm'`),
    check(
      "evo_amocrm_attempts_operation_check",
      sql`${table.operationName} in ('contact_create', 'contact_update', 'lead_create', 'lead_update', 'contact_lead_link', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update')`,
    ),
    check(
      "evo_amocrm_attempts_object_target_check",
      sql`(${table.operationName} in ('contact_create', 'contact_update') and ${table.personId} is not null and ${table.leadId} is null) or (${table.operationName} in ('lead_create', 'lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and ${table.personId} is null and ${table.leadId} is not null) or (${table.operationName} = 'contact_lead_link' and ${table.personId} is not null and ${table.leadId} is not null)`,
    ),
    check(
      "evo_amocrm_attempts_role_check",
      sql`${table.actorRole} in ('admin', 'sales', 'admissions')`,
    ),
    check(
      "evo_amocrm_attempts_status_check",
      sql`${table.status} in ('prepared', 'accepted', 'unknown', 'rejected')`,
    ),
    check(
      "evo_amocrm_attempts_request_shape_check",
      sql`jsonb_typeof(${table.providerRequestMetadata}) = 'object' and octet_length(${table.providerRequestMetadata}::text) <= 65536`,
    ),
    check(
      "evo_amocrm_attempts_request_secret_check",
      sql`${table.providerRequestMetadata}::text !~* '"[^\"]*(token|secret|authorization|api[_-]?key|header)[^\"]*"[[:space:]]*:'`,
    ),
    check(
      "evo_amocrm_attempts_request_hash_check",
      sql`${table.providerRequestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "evo_amocrm_attempts_provider_id_check",
      sql`(${table.targetContactId} is null or ${table.targetContactId} ~ '^[1-9][0-9]{0,19}$') and (${table.targetLeadId} is null or ${table.targetLeadId} ~ '^[1-9][0-9]{0,19}$') and (${table.resultContactId} is null or ${table.resultContactId} ~ '^[1-9][0-9]{0,19}$') and (${table.resultLeadId} is null or ${table.resultLeadId} ~ '^[1-9][0-9]{0,19}$')`,
    ),
    check(
      "evo_amocrm_attempts_provider_target_check",
      sql`(${table.operationName} in ('contact_create', 'lead_create') and ${table.targetContactId} is null and ${table.targetLeadId} is null) or (${table.operationName} = 'contact_update' and ${table.targetContactId} is not null and ${table.targetLeadId} is null) or (${table.operationName} in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and ${table.targetContactId} is null and ${table.targetLeadId} is not null) or (${table.operationName} = 'contact_lead_link' and ${table.targetContactId} is not null and ${table.targetLeadId} is not null)`,
    ),
    check(
      "evo_amocrm_attempts_provider_result_check",
      sql`(${table.operationName} = 'contact_create' and ${table.resultLeadId} is null) or (${table.operationName} = 'contact_update' and ${table.resultLeadId} is null and (${table.resultContactId} is null or ${table.resultContactId} = ${table.targetContactId})) or (${table.operationName} = 'lead_create' and ${table.resultContactId} is null) or (${table.operationName} in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and ${table.resultContactId} is null and (${table.resultLeadId} is null or ${table.resultLeadId} = ${table.targetLeadId})) or (${table.operationName} = 'contact_lead_link' and ((${table.resultContactId} is null and ${table.resultLeadId} is null) or (${table.resultContactId} = ${table.targetContactId} and ${table.resultLeadId} = ${table.targetLeadId})))`,
    ),
    check(
      "evo_amocrm_attempts_transport_check",
      sql`(${table.providerDispatchedAt} is null and ${table.providerRespondedAt} is null and ${table.providerHttpStatus} is null and ${table.providerRequestId} is null) or (${table.providerDispatchedAt} is not null and ${table.providerRespondedAt} is null and ${table.providerHttpStatus} is null and ${table.providerRequestId} is null) or (${table.providerDispatchedAt} is not null and ${table.providerRespondedAt} is not null and ${table.providerHttpStatus} between 100 and 599)`,
    ),
    check(
      "evo_amocrm_attempts_request_id_check",
      sql`${table.providerRequestId} is null or (char_length(btrim(${table.providerRequestId})) between 1 and 255 and ${table.providerRequestId} !~ '[[:cntrl:]]')`,
    ),
    check(
      "evo_amocrm_attempts_timestamp_order_check",
      sql`(${table.providerDispatchedAt} is null or ${table.providerDispatchedAt} >= ${table.preparedAt}) and (${table.providerRespondedAt} is null or ${table.providerRespondedAt} >= ${table.providerDispatchedAt}) and (${table.settledAt} is null or ${table.settledAt} >= ${table.preparedAt}) and (${table.lastReconciledAt} is null or (${table.settledAt} is not null and ${table.lastReconciledAt} >= ${table.settledAt}))`,
    ),
    check(
      "evo_amocrm_attempts_readback_tuple_check",
      sql`(${table.providerReadback} is null and ${table.providerReadbackSha256} is null and ${table.providerReadbackAt} is null) or (${table.providerReadback} is not null and ${table.providerReadbackSha256} ~ '^[0-9a-f]{64}$' and ${table.providerReadbackAt} is not null)`,
    ),
    check(
      "evo_amocrm_attempts_readback_shape_check",
      sql`${table.providerReadback} is null or jsonb_typeof(${table.providerReadback}) = 'object'`,
    ),
    check(
      "evo_amocrm_attempts_readback_size_check",
      sql`${table.providerReadback} is null or octet_length(${table.providerReadback}::text) <= 1048576`,
    ),
    check(
      "evo_amocrm_attempts_readback_secret_check",
      sql`${table.providerReadback} is null or ${table.providerReadback}::text !~* '"[^"]*(token|secret|authorization|api[_-]?key)[^"]*"[[:space:]]*:'`,
    ),
    check(
      "evo_amocrm_attempts_failure_check",
      sql`${table.failureCode} is null or char_length(btrim(${table.failureCode})) between 1 and 80`,
    ),
    check(
      "evo_amocrm_attempts_correlation_check",
      sql`char_length(btrim(${table.correlationId})) between 1 and 255`,
    ),
    check(
      "evo_amocrm_attempts_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) between 1 and 255`,
    ),
    check("evo_amocrm_attempts_version_check", sql`${table.version} > 0`),
    check(
      "evo_amocrm_attempts_state_check",
      sql`(${table.status} = 'prepared' and ${table.resultContactId} is null and ${table.resultLeadId} is null and ${table.providerRespondedAt} is null and ${table.providerHttpStatus} is null and ${table.providerRequestId} is null and ${table.providerReadback} is null and ${table.providerReadbackSha256} is null and ${table.providerReadbackAt} is null and ${table.failureCode} is null and ${table.settledAt} is null and ${table.lastReconciledAt} is null) or (${table.status} = 'accepted' and ${table.providerDispatchedAt} is not null and ${table.providerRespondedAt} is not null and ${table.providerHttpStatus} between 200 and 299 and ${table.providerReadback} is not null and ${table.providerReadbackSha256} is not null and ${table.providerReadbackAt} is not null and ${table.failureCode} is null and ${table.settledAt} is not null and ((${table.operationName} = 'contact_create' and ${table.resultContactId} is not null) or (${table.operationName} = 'contact_update' and ${table.resultContactId} = ${table.targetContactId}) or (${table.operationName} = 'lead_create' and ${table.resultLeadId} is not null) or (${table.operationName} in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and ${table.resultLeadId} = ${table.targetLeadId}) or (${table.operationName} = 'contact_lead_link' and ${table.resultContactId} = ${table.targetContactId} and ${table.resultLeadId} = ${table.targetLeadId}))) or (${table.status} = 'unknown' and ${table.providerDispatchedAt} is not null and ${table.failureCode} is not null and ${table.settledAt} is not null) or (${table.status} = 'rejected' and ${table.providerDispatchedAt} is not null and ${table.providerRespondedAt} is not null and ${table.providerHttpStatus} between 300 and 599 and ${table.resultContactId} is null and ${table.resultLeadId} is null and ${table.failureCode} is not null and ${table.settledAt} is not null)`,
    ),
  ],
);

export const evoAmoCrmContactBindings = pgTable(
  "evo_amocrm_contact_bindings",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => evoAmoCrmAccounts.id, { onDelete: "restrict" }),
    personId: text("person_id")
      .notNull()
      .references(() => evoPeople.id, { onDelete: "restrict" }),
    providerContactId: text("provider_contact_id").notNull(),
    createdByAttemptId: text("created_by_attempt_id"),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastVerifiedAt: timestamp("last_verified_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    version: integer("version").default(1).notNull(),
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
    unique("evo_amocrm_contacts_account_person_unique").on(
      table.accountId,
      table.personId,
    ),
    unique("evo_amocrm_contacts_account_provider_unique").on(
      table.accountId,
      table.providerContactId,
    ),
    unique("evo_amocrm_contacts_attempt_unique").on(table.createdByAttemptId),
    foreignKey({
      name: "evo_amocrm_contacts_creation_attempt_fk",
      columns: [
        table.accountId,
        table.createdByAttemptId,
        table.personId,
        table.providerContactId,
      ],
      foreignColumns: [
        evoAmoCrmOperationAttempts.accountId,
        evoAmoCrmOperationAttempts.id,
        evoAmoCrmOperationAttempts.personId,
        evoAmoCrmOperationAttempts.resultContactId,
      ],
    }).onDelete("restrict"),
    index("evo_amocrm_contacts_person_idx").on(table.personId),
    check(
      "evo_amocrm_contacts_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_amocrm_contacts_provider_id_check",
      sql`${table.providerContactId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check("evo_amocrm_contacts_version_check", sql`${table.version} > 0`),
  ],
);

export const evoAmoCrmLeadBindings = pgTable(
  "evo_amocrm_lead_bindings",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => evoAmoCrmAccounts.id, { onDelete: "restrict" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => evoLeads.id, { onDelete: "restrict" }),
    providerLeadId: text("provider_lead_id").notNull(),
    createdByAttemptId: text("created_by_attempt_id"),
    providerUpdatedAt: timestamp("provider_updated_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastVerifiedAt: timestamp("last_verified_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    version: integer("version").default(1).notNull(),
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
    unique("evo_amocrm_leads_account_lead_unique").on(
      table.accountId,
      table.leadId,
    ),
    unique("evo_amocrm_leads_account_provider_unique").on(
      table.accountId,
      table.providerLeadId,
    ),
    unique("evo_amocrm_leads_attempt_unique").on(table.createdByAttemptId),
    foreignKey({
      name: "evo_amocrm_leads_creation_attempt_fk",
      columns: [
        table.accountId,
        table.createdByAttemptId,
        table.leadId,
        table.providerLeadId,
      ],
      foreignColumns: [
        evoAmoCrmOperationAttempts.accountId,
        evoAmoCrmOperationAttempts.id,
        evoAmoCrmOperationAttempts.leadId,
        evoAmoCrmOperationAttempts.resultLeadId,
      ],
    }).onDelete("restrict"),
    index("evo_amocrm_leads_lead_idx").on(table.leadId),
    check(
      "evo_amocrm_leads_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_amocrm_leads_provider_id_check",
      sql`${table.providerLeadId} ~ '^[1-9][0-9]{0,19}$'`,
    ),
    check("evo_amocrm_leads_version_check", sql`${table.version} > 0`),
  ],
);
