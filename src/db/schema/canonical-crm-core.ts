import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const EVO_TECHNICAL_ROLES = ["admin", "sales", "admissions"] as const;
export type EvoTechnicalRole = (typeof EVO_TECHNICAL_ROLES)[number];

export const evoPeople = pgTable(
  "evo_people",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    phoneE164: text("phone_e164"),
    email: text("email"),
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
    unique("evo_people_phone_unique").on(table.phoneE164),
    unique("evo_people_email_unique").on(table.email),
    check(
      "evo_people_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_people_full_name_check",
      sql`char_length(btrim(${table.fullName})) > 0`,
    ),
    check(
      "evo_people_contact_check",
      sql`${table.phoneE164} is not null or ${table.email} is not null`,
    ),
    check(
      "evo_people_phone_check",
      sql`${table.phoneE164} is null or ${table.phoneE164} ~ '^[+][1-9][0-9]{6,14}$'`,
    ),
    check(
      "evo_people_email_check",
      sql`${table.email} is null or ${table.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`,
    ),
    check("evo_people_version_check", sql`${table.version} > 0`),
  ],
);

export const evoLeads = pgTable(
  "evo_leads",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => evoPeople.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    stage: text("stage").default("new").notNull(),
    ownerRole: text("owner_role").default("sales").notNull(),
    qualificationSummary: text("qualification_summary"),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    index("evo_leads_person_idx").on(table.personId),
    index("evo_leads_stage_idx").on(table.stage),
    check(
      "evo_leads_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_leads_source_check",
      sql`char_length(btrim(${table.source})) > 0`,
    ),
    check(
      "evo_leads_stage_check",
      sql`${table.stage} in ('new', 'qualifying', 'qualified', 'disqualified', 'handoff_ready', 'handed_off')`,
    ),
    check("evo_leads_owner_role_check", sql`${table.ownerRole} = 'sales'`),
    check(
      "evo_leads_next_action_check",
      sql`${table.nextActionAt} is null or (${table.nextAction} is not null and char_length(btrim(${table.nextAction})) > 0)`,
    ),
    check("evo_leads_version_check", sql`${table.version} > 0`),
  ],
);

export const evoStudentCases = pgTable(
  "evo_student_cases",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => evoPeople.id, { onDelete: "restrict" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => evoLeads.id, { onDelete: "restrict" }),
    status: text("status").default("active").notNull(),
    ownerRole: text("owner_role").default("admissions").notNull(),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    unique("evo_student_cases_lead_unique").on(table.leadId),
    index("evo_student_cases_person_idx").on(table.personId),
    check(
      "evo_student_cases_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_student_cases_status_check",
      sql`${table.status} in ('active', 'paused', 'closed')`,
    ),
    check(
      "evo_student_cases_owner_role_check",
      sql`${table.ownerRole} = 'admissions'`,
    ),
    check(
      "evo_student_cases_next_action_check",
      sql`${table.nextActionAt} is null or (${table.nextAction} is not null and char_length(btrim(${table.nextAction})) > 0)`,
    ),
    check("evo_student_cases_version_check", sql`${table.version} > 0`),
  ],
);

export const evoSalesGateEvidence = pgTable(
  "evo_sales_gate_evidence",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => evoLeads.id, { onDelete: "restrict" }),
    evidenceType: text("evidence_type").notNull(),
    decision: text("decision").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    recordedByRole: text("recorded_by_role").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    reason: text("reason"),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_sales_gate_evidence_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("evo_sales_gate_evidence_lead_idx").on(table.leadId),
    check(
      "evo_sales_gate_evidence_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_sales_gate_evidence_type_check",
      sql`${table.evidenceType} in ('contract', 'first_payment')`,
    ),
    check(
      "evo_sales_gate_evidence_decision_check",
      sql`${table.decision} in ('confirmed', 'rejected')`,
    ),
    check(
      "evo_sales_gate_evidence_reference_check",
      sql`char_length(btrim(${table.evidenceReference})) > 0`,
    ),
    check(
      "evo_sales_gate_evidence_payment_check",
      sql`(${table.evidenceType} = 'contract' and ${table.amountMinor} is null and ${table.currency} is null) or (${table.evidenceType} = 'first_payment' and ${table.amountMinor} is not null and ${table.amountMinor} > 0 and ${table.currency} is not null and ${table.currency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "evo_sales_gate_evidence_role_check",
      sql`${table.recordedByRole} in ('admin', 'sales')`,
    ),
    check(
      "evo_sales_gate_evidence_reason_check",
      sql`${table.decision} = 'confirmed' or (${table.reason} is not null and char_length(btrim(${table.reason})) > 0)`,
    ),
    check(
      "evo_sales_gate_evidence_correlation_check",
      sql`char_length(btrim(${table.correlationId})) > 0`,
    ),
    check(
      "evo_sales_gate_evidence_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
  ],
);

export const evoSalesAdmissionsHandoffs = pgTable(
  "evo_sales_admissions_handoffs",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id")
      .notNull()
      .references(() => evoLeads.id, { onDelete: "restrict" }),
    studentCaseId: text("student_case_id")
      .notNull()
      .references(() => evoStudentCases.id, { onDelete: "restrict" }),
    contractEvidenceId: text("contract_evidence_id").references(
      () => evoSalesGateEvidence.id,
      { onDelete: "restrict" },
    ),
    firstPaymentEvidenceId: text("first_payment_evidence_id").references(
      () => evoSalesGateEvidence.id,
      { onDelete: "restrict" },
    ),
    isOverride: boolean("is_override").default(false).notNull(),
    overrideReason: text("override_reason"),
    executedByRole: text("executed_by_role").notNull(),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    executedAt: timestamp("executed_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_sales_admissions_handoffs_lead_unique").on(table.leadId),
    unique("evo_sales_admissions_handoffs_case_unique").on(
      table.studentCaseId,
    ),
    unique("evo_sales_admissions_handoffs_idempotency_unique").on(
      table.idempotencyKey,
    ),
    check(
      "evo_sales_admissions_handoffs_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_sales_admissions_handoffs_gate_check",
      sql`(${table.isOverride} and ${table.contractEvidenceId} is null and ${table.firstPaymentEvidenceId} is null) or (not ${table.isOverride} and ${table.contractEvidenceId} is not null and ${table.firstPaymentEvidenceId} is not null)`,
    ),
    check(
      "evo_sales_admissions_handoffs_override_check",
      sql`(${table.isOverride} and ${table.executedByRole} = 'admin' and ${table.overrideReason} is not null and char_length(btrim(${table.overrideReason})) > 0) or (not ${table.isOverride} and ${table.executedByRole} in ('admin', 'sales') and ${table.overrideReason} is null)`,
    ),
    check(
      "evo_sales_admissions_handoffs_correlation_check",
      sql`char_length(btrim(${table.correlationId})) > 0`,
    ),
    check(
      "evo_sales_admissions_handoffs_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
  ],
);
