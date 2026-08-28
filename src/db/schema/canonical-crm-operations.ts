import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  evoConversations,
  evoStudentCases,
} from "./canonical-crm-core.ts";

export const evoAdmissionsTasks = pgTable(
  "evo_admissions_tasks",
  {
    id: text("id").primaryKey(),
    studentCaseId: text("student_case_id")
      .notNull()
      .references(() => evoStudentCases.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    details: text("details"),
    status: text("status").default("open").notNull(),
    assignedRole: text("assigned_role").default("admissions").notNull(),
    dueAt: timestamp("due_at", {
      withTimezone: true,
      mode: "date",
    }),
    closedAt: timestamp("closed_at", {
      withTimezone: true,
      mode: "date",
    }),
    closedByRole: text("closed_by_role"),
    closureReason: text("closure_reason"),
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
    index("evo_admissions_tasks_case_idx").on(table.studentCaseId),
    index("evo_admissions_tasks_status_due_idx").on(table.status, table.dueAt),
    check(
      "evo_admissions_tasks_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_admissions_tasks_title_check",
      sql`char_length(btrim(${table.title})) > 0`,
    ),
    check(
      "evo_admissions_tasks_status_check",
      sql`${table.status} in ('open', 'completed', 'cancelled')`,
    ),
    check(
      "evo_admissions_tasks_assigned_role_check",
      sql`${table.assignedRole} = 'admissions'`,
    ),
    check(
      "evo_admissions_tasks_closure_check",
      sql`(${table.status} = 'open' and ${table.closedAt} is null and ${table.closedByRole} is null and ${table.closureReason} is null) or (${table.status} = 'completed' and ${table.closedAt} is not null and ${table.closedByRole} is not null and ${table.closedByRole} in ('admin', 'admissions')) or (${table.status} = 'cancelled' and ${table.closedAt} is not null and ${table.closedByRole} is not null and ${table.closedByRole} in ('admin', 'admissions') and ${table.closureReason} is not null and char_length(btrim(${table.closureReason})) > 0)`,
    ),
    check("evo_admissions_tasks_version_check", sql`${table.version} > 0`),
  ],
);

export const evoUniversityApplications = pgTable(
  "evo_university_applications",
  {
    id: text("id").primaryKey(),
    studentCaseId: text("student_case_id")
      .notNull()
      .references(() => evoStudentCases.id, { onDelete: "restrict" }),
    institutionName: text("institution_name").notNull(),
    programName: text("program_name").notNull(),
    targetIntake: text("target_intake").notNull(),
    status: text("status").default("draft").notNull(),
    ownerRole: text("owner_role").default("admissions").notNull(),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", {
      withTimezone: true,
      mode: "date",
    }),
    submittedAt: timestamp("submitted_at", {
      withTimezone: true,
      mode: "date",
    }),
    decidedAt: timestamp("decided_at", {
      withTimezone: true,
      mode: "date",
    }),
    decisionReason: text("decision_reason"),
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
    unique("evo_university_applications_target_unique").on(
      table.studentCaseId,
      table.institutionName,
      table.programName,
      table.targetIntake,
    ),
    index("evo_university_applications_case_idx").on(table.studentCaseId),
    check(
      "evo_university_applications_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_university_applications_names_check",
      sql`char_length(btrim(${table.institutionName})) > 0 and char_length(btrim(${table.programName})) > 0 and char_length(btrim(${table.targetIntake})) > 0`,
    ),
    check(
      "evo_university_applications_status_check",
      sql`${table.status} in ('draft', 'submitted', 'accepted', 'rejected', 'withdrawn')`,
    ),
    check(
      "evo_university_applications_owner_role_check",
      sql`${table.ownerRole} = 'admissions'`,
    ),
    check(
      "evo_university_applications_next_action_check",
      sql`${table.nextActionAt} is null or (${table.nextAction} is not null and char_length(btrim(${table.nextAction})) > 0)`,
    ),
    check(
      "evo_university_applications_timeline_check",
      sql`(${table.status} = 'draft' and ${table.submittedAt} is null and ${table.decidedAt} is null) or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.decidedAt} is null) or (${table.status} in ('accepted', 'rejected') and ${table.submittedAt} is not null and ${table.decidedAt} is not null and ${table.decidedAt} >= ${table.submittedAt}) or (${table.status} = 'withdrawn' and ${table.decidedAt} is not null)`,
    ),
    check(
      "evo_university_applications_reason_check",
      sql`${table.status} not in ('rejected', 'withdrawn') or (${table.decisionReason} is not null and char_length(btrim(${table.decisionReason})) > 0)`,
    ),
    check(
      "evo_university_applications_version_check",
      sql`${table.version} > 0`,
    ),
  ],
);

export const evoVisaMilestones = pgTable(
  "evo_visa_milestones",
  {
    id: text("id").primaryKey(),
    studentCaseId: text("student_case_id")
      .notNull()
      .references(() => evoStudentCases.id, { onDelete: "restrict" }),
    milestoneKind: text("milestone_kind").notNull(),
    status: text("status").default("pending").notNull(),
    ownerRole: text("owner_role").default("admissions").notNull(),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", {
      withTimezone: true,
      mode: "date",
    }),
    dueAt: timestamp("due_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    blockedReason: text("blocked_reason"),
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
    unique("evo_visa_milestones_case_kind_unique").on(
      table.studentCaseId,
      table.milestoneKind,
    ),
    index("evo_visa_milestones_case_idx").on(table.studentCaseId),
    check(
      "evo_visa_milestones_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_visa_milestones_kind_check",
      sql`${table.milestoneKind} in ('document_preparation', 'appointment', 'submission', 'biometrics', 'interview', 'decision')`,
    ),
    check(
      "evo_visa_milestones_status_check",
      sql`${table.status} in ('pending', 'in_progress', 'completed', 'blocked')`,
    ),
    check(
      "evo_visa_milestones_owner_role_check",
      sql`${table.ownerRole} = 'admissions'`,
    ),
    check(
      "evo_visa_milestones_next_action_check",
      sql`${table.nextActionAt} is null or (${table.nextAction} is not null and char_length(btrim(${table.nextAction})) > 0)`,
    ),
    check(
      "evo_visa_milestones_completion_check",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
    check(
      "evo_visa_milestones_blocked_check",
      sql`(${table.status} = 'blocked' and ${table.blockedReason} is not null and char_length(btrim(${table.blockedReason})) > 0) or (${table.status} <> 'blocked' and ${table.blockedReason} is null)`,
    ),
    check("evo_visa_milestones_version_check", sql`${table.version} > 0`),
  ],
);

export const evoFinanceStopStates = pgTable(
  "evo_finance_stop_states",
  {
    id: text("id").primaryKey(),
    studentCaseId: text("student_case_id")
      .notNull()
      .references(() => evoStudentCases.id, { onDelete: "restrict" }),
    isStopped: boolean("is_stopped").notNull(),
    reason: text("reason").notNull(),
    changedByRole: text("changed_by_role").notNull(),
    version: integer("version").default(1).notNull(),
    changedAt: timestamp("changed_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_finance_stop_states_case_unique").on(table.studentCaseId),
    check(
      "evo_finance_stop_states_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_finance_stop_states_reason_check",
      sql`char_length(btrim(${table.reason})) > 0`,
    ),
    check(
      "evo_finance_stop_states_role_check",
      sql`${table.changedByRole} in ('admin', 'admissions')`,
    ),
    check(
      "evo_finance_stop_states_version_check",
      sql`${table.version} > 0`,
    ),
  ],
);

export const evoAiProposals = pgTable(
  "evo_ai_proposals",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => evoConversations.id, { onDelete: "restrict" }),
    studentCaseId: text("student_case_id").references(() => evoStudentCases.id, {
      onDelete: "restrict",
    }),
    provider: text("provider").default("gemini").notNull(),
    model: text("model").notNull(),
    proposalText: text("proposal_text").notNull(),
    sourceContext: jsonb("source_context")
      .$type<Record<string, unknown>>()
      .notNull(),
    reviewDecision: text("review_decision").default("pending").notNull(),
    reviewedText: text("reviewed_text"),
    reviewedByRole: text("reviewed_by_role"),
    reviewedAt: timestamp("reviewed_at", {
      withTimezone: true,
      mode: "date",
    }),
    reviewReason: text("review_reason"),
    providerCreatedAt: timestamp("provider_created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
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
    unique("evo_ai_proposals_idempotency_unique").on(table.idempotencyKey),
    index("evo_ai_proposals_conversation_idx").on(table.conversationId),
    check(
      "evo_ai_proposals_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check("evo_ai_proposals_provider_check", sql`${table.provider} = 'gemini'`),
    check(
      "evo_ai_proposals_model_check",
      sql`char_length(btrim(${table.model})) > 0`,
    ),
    check(
      "evo_ai_proposals_text_check",
      sql`char_length(btrim(${table.proposalText})) > 0`,
    ),
    check(
      "evo_ai_proposals_source_context_check",
      sql`jsonb_typeof(${table.sourceContext}) = 'object'`,
    ),
    check(
      "evo_ai_proposals_decision_check",
      sql`${table.reviewDecision} in ('pending', 'accepted', 'edited', 'rejected')`,
    ),
    check(
      "evo_ai_proposals_review_check",
      sql`(${table.reviewDecision} = 'pending' and ${table.reviewedText} is null and ${table.reviewedByRole} is null and ${table.reviewedAt} is null and ${table.reviewReason} is null) or (${table.reviewDecision} in ('accepted', 'edited') and ${table.reviewedText} is not null and char_length(btrim(${table.reviewedText})) > 0 and ${table.reviewedByRole} is not null and ${table.reviewedByRole} in ('admin', 'sales', 'admissions') and ${table.reviewedAt} is not null) or (${table.reviewDecision} = 'rejected' and ${table.reviewedText} is null and ${table.reviewedByRole} is not null and ${table.reviewedByRole} in ('admin', 'sales', 'admissions') and ${table.reviewedAt} is not null and ${table.reviewReason} is not null and char_length(btrim(${table.reviewReason})) > 0)`,
    ),
    check(
      "evo_ai_proposals_correlation_check",
      sql`char_length(btrim(${table.correlationId})) > 0`,
    ),
    check(
      "evo_ai_proposals_idempotency_check",
      sql`char_length(btrim(${table.idempotencyKey})) > 0`,
    ),
  ],
);
