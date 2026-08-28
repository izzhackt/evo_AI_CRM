CREATE TABLE "evo_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"external_conversation_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"owning_role" text DEFAULT 'sales' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_conversations_external_unique" UNIQUE("channel","external_conversation_id"),
	CONSTRAINT "evo_conversations_id_uuid_check" CHECK ("evo_conversations"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_conversations_channel_check" CHECK ("evo_conversations"."channel" = 'whatsapp'),
	CONSTRAINT "evo_conversations_external_id_check" CHECK ("evo_conversations"."external_conversation_id" is null or char_length(btrim("evo_conversations"."external_conversation_id")) > 0),
	CONSTRAINT "evo_conversations_status_check" CHECK ("evo_conversations"."status" in ('open', 'closed')),
	CONSTRAINT "evo_conversations_owning_role_check" CHECK ("evo_conversations"."owning_role" in ('sales', 'admissions')),
	CONSTRAINT "evo_conversations_version_check" CHECK ("evo_conversations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"source" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"owner_role" text DEFAULT 'sales' NOT NULL,
	"qualification_summary" text,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_leads_id_uuid_check" CHECK ("evo_leads"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_leads_source_check" CHECK (char_length(btrim("evo_leads"."source")) > 0),
	CONSTRAINT "evo_leads_stage_check" CHECK ("evo_leads"."stage" in ('new', 'qualifying', 'qualified', 'disqualified', 'handoff_ready', 'handed_off')),
	CONSTRAINT "evo_leads_owner_role_check" CHECK ("evo_leads"."owner_role" = 'sales'),
	CONSTRAINT "evo_leads_next_action_check" CHECK ("evo_leads"."next_action_at" is null or ("evo_leads"."next_action" is not null and char_length(btrim("evo_leads"."next_action")) > 0)),
	CONSTRAINT "evo_leads_version_check" CHECK ("evo_leads"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"external_message_id" text,
	"body" text NOT NULL,
	"author_role" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_messages_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_messages_external_unique" UNIQUE("conversation_id","external_message_id"),
	CONSTRAINT "evo_messages_id_uuid_check" CHECK ("evo_messages"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_messages_direction_check" CHECK ("evo_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "evo_messages_external_id_check" CHECK (("evo_messages"."direction" = 'inbound' and "evo_messages"."external_message_id" is not null and char_length(btrim("evo_messages"."external_message_id")) > 0) or ("evo_messages"."direction" = 'outbound' and ("evo_messages"."external_message_id" is null or char_length(btrim("evo_messages"."external_message_id")) > 0))),
	CONSTRAINT "evo_messages_author_role_check" CHECK (("evo_messages"."direction" = 'inbound' and "evo_messages"."author_role" is null) or ("evo_messages"."direction" = 'outbound' and "evo_messages"."author_role" is not null and "evo_messages"."author_role" in ('admin', 'sales', 'admissions'))),
	CONSTRAINT "evo_messages_body_check" CHECK (char_length(btrim("evo_messages"."body")) > 0),
	CONSTRAINT "evo_messages_correlation_check" CHECK (char_length(btrim("evo_messages"."correlation_id")) > 0),
	CONSTRAINT "evo_messages_idempotency_check" CHECK (char_length(btrim("evo_messages"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_people" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_people_phone_unique" UNIQUE("phone_e164"),
	CONSTRAINT "evo_people_email_unique" UNIQUE("email"),
	CONSTRAINT "evo_people_id_uuid_check" CHECK ("evo_people"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_people_full_name_check" CHECK (char_length(btrim("evo_people"."full_name")) > 0),
	CONSTRAINT "evo_people_contact_check" CHECK ("evo_people"."phone_e164" is not null or "evo_people"."email" is not null),
	CONSTRAINT "evo_people_phone_check" CHECK ("evo_people"."phone_e164" is null or "evo_people"."phone_e164" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "evo_people_email_check" CHECK ("evo_people"."email" is null or "evo_people"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
	CONSTRAINT "evo_people_version_check" CHECK ("evo_people"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_sales_admissions_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"student_case_id" text NOT NULL,
	"contract_evidence_id" text,
	"first_payment_evidence_id" text,
	"is_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"executed_by_role" text NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_sales_admissions_handoffs_lead_unique" UNIQUE("lead_id"),
	CONSTRAINT "evo_sales_admissions_handoffs_case_unique" UNIQUE("student_case_id"),
	CONSTRAINT "evo_sales_admissions_handoffs_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_sales_admissions_handoffs_id_uuid_check" CHECK ("evo_sales_admissions_handoffs"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_sales_admissions_handoffs_gate_check" CHECK (("evo_sales_admissions_handoffs"."is_override" and "evo_sales_admissions_handoffs"."contract_evidence_id" is null and "evo_sales_admissions_handoffs"."first_payment_evidence_id" is null) or (not "evo_sales_admissions_handoffs"."is_override" and "evo_sales_admissions_handoffs"."contract_evidence_id" is not null and "evo_sales_admissions_handoffs"."first_payment_evidence_id" is not null)),
	CONSTRAINT "evo_sales_admissions_handoffs_override_check" CHECK (("evo_sales_admissions_handoffs"."is_override" and "evo_sales_admissions_handoffs"."executed_by_role" = 'admin' and "evo_sales_admissions_handoffs"."override_reason" is not null and char_length(btrim("evo_sales_admissions_handoffs"."override_reason")) > 0) or (not "evo_sales_admissions_handoffs"."is_override" and "evo_sales_admissions_handoffs"."executed_by_role" in ('admin', 'sales') and "evo_sales_admissions_handoffs"."override_reason" is null)),
	CONSTRAINT "evo_sales_admissions_handoffs_correlation_check" CHECK (char_length(btrim("evo_sales_admissions_handoffs"."correlation_id")) > 0),
	CONSTRAINT "evo_sales_admissions_handoffs_idempotency_check" CHECK (char_length(btrim("evo_sales_admissions_handoffs"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_sales_gate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"decision" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"amount_minor" integer,
	"currency" text,
	"recorded_by_role" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_sales_gate_evidence_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_sales_gate_evidence_id_uuid_check" CHECK ("evo_sales_gate_evidence"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_sales_gate_evidence_type_check" CHECK ("evo_sales_gate_evidence"."evidence_type" in ('contract', 'first_payment')),
	CONSTRAINT "evo_sales_gate_evidence_decision_check" CHECK ("evo_sales_gate_evidence"."decision" in ('confirmed', 'rejected')),
	CONSTRAINT "evo_sales_gate_evidence_reference_check" CHECK (char_length(btrim("evo_sales_gate_evidence"."evidence_reference")) > 0),
	CONSTRAINT "evo_sales_gate_evidence_payment_check" CHECK (("evo_sales_gate_evidence"."evidence_type" = 'contract' and "evo_sales_gate_evidence"."amount_minor" is null and "evo_sales_gate_evidence"."currency" is null) or ("evo_sales_gate_evidence"."evidence_type" = 'first_payment' and "evo_sales_gate_evidence"."amount_minor" is not null and "evo_sales_gate_evidence"."amount_minor" > 0 and "evo_sales_gate_evidence"."currency" is not null and "evo_sales_gate_evidence"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "evo_sales_gate_evidence_role_check" CHECK ("evo_sales_gate_evidence"."recorded_by_role" in ('admin', 'sales')),
	CONSTRAINT "evo_sales_gate_evidence_reason_check" CHECK ("evo_sales_gate_evidence"."decision" = 'confirmed' or ("evo_sales_gate_evidence"."reason" is not null and char_length(btrim("evo_sales_gate_evidence"."reason")) > 0)),
	CONSTRAINT "evo_sales_gate_evidence_correlation_check" CHECK (char_length(btrim("evo_sales_gate_evidence"."correlation_id")) > 0),
	CONSTRAINT "evo_sales_gate_evidence_idempotency_check" CHECK (char_length(btrim("evo_sales_gate_evidence"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_student_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"owner_role" text DEFAULT 'admissions' NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_student_cases_lead_unique" UNIQUE("lead_id"),
	CONSTRAINT "evo_student_cases_id_uuid_check" CHECK ("evo_student_cases"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_student_cases_status_check" CHECK ("evo_student_cases"."status" in ('active', 'paused', 'closed')),
	CONSTRAINT "evo_student_cases_owner_role_check" CHECK ("evo_student_cases"."owner_role" = 'admissions'),
	CONSTRAINT "evo_student_cases_next_action_check" CHECK ("evo_student_cases"."next_action_at" is null or ("evo_student_cases"."next_action" is not null and char_length(btrim("evo_student_cases"."next_action")) > 0)),
	CONSTRAINT "evo_student_cases_version_check" CHECK ("evo_student_cases"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_business_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_role" text NOT NULL,
	"business_object_type" text NOT NULL,
	"business_object_id" text NOT NULL,
	"transition" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"reason" text,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_sequence" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_business_events_idempotency_sequence_unique" UNIQUE("idempotency_key","event_sequence"),
	CONSTRAINT "evo_business_events_id_uuid_check" CHECK ("evo_business_events"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_business_events_actor_role_check" CHECK ("evo_business_events"."actor_role" in ('admin', 'sales', 'admissions')),
	CONSTRAINT "evo_business_events_object_type_check" CHECK ("evo_business_events"."business_object_type" in ('person', 'lead', 'conversation', 'message', 'student_case', 'gate_evidence', 'handoff', 'task', 'document', 'application', 'visa_milestone', 'finance_stop', 'ai_proposal')),
	CONSTRAINT "evo_business_events_object_id_check" CHECK ("evo_business_events"."business_object_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_business_events_transition_check" CHECK (char_length(btrim("evo_business_events"."transition")) > 0),
	CONSTRAINT "evo_business_events_reason_check" CHECK ("evo_business_events"."transition" !~ '(override|reject|stop|release|close|cancel|disqual)' or ("evo_business_events"."reason" is not null and char_length(btrim("evo_business_events"."reason")) > 0)),
	CONSTRAINT "evo_business_events_correlation_check" CHECK (char_length(btrim("evo_business_events"."correlation_id")) > 0),
	CONSTRAINT "evo_business_events_idempotency_check" CHECK (char_length(btrim("evo_business_events"."idempotency_key")) > 0),
	CONSTRAINT "evo_business_events_sequence_check" CHECK ("evo_business_events"."event_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_command_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"command_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"business_object_type" text,
	"business_object_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"result_payload" jsonb,
	"failure_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_command_receipts_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_command_receipts_id_uuid_check" CHECK ("evo_command_receipts"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_command_receipts_command_name_check" CHECK (char_length(btrim("evo_command_receipts"."command_name")) > 0),
	CONSTRAINT "evo_command_receipts_idempotency_check" CHECK (char_length(btrim("evo_command_receipts"."idempotency_key")) > 0),
	CONSTRAINT "evo_command_receipts_request_hash_check" CHECK ("evo_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evo_command_receipts_correlation_check" CHECK (char_length(btrim("evo_command_receipts"."correlation_id")) > 0),
	CONSTRAINT "evo_command_receipts_actor_role_check" CHECK ("evo_command_receipts"."actor_role" in ('admin', 'sales', 'admissions')),
	CONSTRAINT "evo_command_receipts_object_check" CHECK (("evo_command_receipts"."business_object_type" is null and "evo_command_receipts"."business_object_id" is null) or ("evo_command_receipts"."business_object_type" is not null and char_length(btrim("evo_command_receipts"."business_object_type")) > 0 and "evo_command_receipts"."business_object_id" is not null and "evo_command_receipts"."business_object_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
	CONSTRAINT "evo_command_receipts_status_check" CHECK ("evo_command_receipts"."status" in ('processing', 'succeeded', 'failed')),
	CONSTRAINT "evo_command_receipts_completion_check" CHECK (("evo_command_receipts"."status" = 'processing' and "evo_command_receipts"."result_payload" is null and "evo_command_receipts"."failure_code" is null and "evo_command_receipts"."completed_at" is null) or ("evo_command_receipts"."status" = 'succeeded' and "evo_command_receipts"."result_payload" is not null and jsonb_typeof("evo_command_receipts"."result_payload") = 'object' and "evo_command_receipts"."failure_code" is null and "evo_command_receipts"."completed_at" is not null) or ("evo_command_receipts"."status" = 'failed' and "evo_command_receipts"."result_payload" is null and "evo_command_receipts"."failure_code" is not null and char_length(btrim("evo_command_receipts"."failure_code")) > 0 and "evo_command_receipts"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "evo_admissions_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"student_case_id" text NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_role" text DEFAULT 'admissions' NOT NULL,
	"due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by_role" text,
	"closure_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_admissions_tasks_id_uuid_check" CHECK ("evo_admissions_tasks"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_admissions_tasks_title_check" CHECK (char_length(btrim("evo_admissions_tasks"."title")) > 0),
	CONSTRAINT "evo_admissions_tasks_status_check" CHECK ("evo_admissions_tasks"."status" in ('open', 'completed', 'cancelled')),
	CONSTRAINT "evo_admissions_tasks_assigned_role_check" CHECK ("evo_admissions_tasks"."assigned_role" = 'admissions'),
	CONSTRAINT "evo_admissions_tasks_closure_check" CHECK (("evo_admissions_tasks"."status" = 'open' and "evo_admissions_tasks"."closed_at" is null and "evo_admissions_tasks"."closed_by_role" is null and "evo_admissions_tasks"."closure_reason" is null) or ("evo_admissions_tasks"."status" = 'completed' and "evo_admissions_tasks"."closed_at" is not null and "evo_admissions_tasks"."closed_by_role" is not null and "evo_admissions_tasks"."closed_by_role" in ('admin', 'admissions')) or ("evo_admissions_tasks"."status" = 'cancelled' and "evo_admissions_tasks"."closed_at" is not null and "evo_admissions_tasks"."closed_by_role" is not null and "evo_admissions_tasks"."closed_by_role" in ('admin', 'admissions') and "evo_admissions_tasks"."closure_reason" is not null and char_length(btrim("evo_admissions_tasks"."closure_reason")) > 0)),
	CONSTRAINT "evo_admissions_tasks_version_check" CHECK ("evo_admissions_tasks"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_ai_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"student_case_id" text,
	"provider" text DEFAULT 'gemini' NOT NULL,
	"model" text NOT NULL,
	"proposal_text" text NOT NULL,
	"source_context" jsonb NOT NULL,
	"review_decision" text DEFAULT 'pending' NOT NULL,
	"reviewed_text" text,
	"reviewed_by_role" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"provider_created_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_ai_proposals_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_ai_proposals_id_uuid_check" CHECK ("evo_ai_proposals"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_ai_proposals_provider_check" CHECK ("evo_ai_proposals"."provider" = 'gemini'),
	CONSTRAINT "evo_ai_proposals_model_check" CHECK (char_length(btrim("evo_ai_proposals"."model")) > 0),
	CONSTRAINT "evo_ai_proposals_text_check" CHECK (char_length(btrim("evo_ai_proposals"."proposal_text")) > 0),
	CONSTRAINT "evo_ai_proposals_source_context_check" CHECK (jsonb_typeof("evo_ai_proposals"."source_context") = 'object'),
	CONSTRAINT "evo_ai_proposals_decision_check" CHECK ("evo_ai_proposals"."review_decision" in ('pending', 'accepted', 'edited', 'rejected')),
	CONSTRAINT "evo_ai_proposals_review_check" CHECK (("evo_ai_proposals"."review_decision" = 'pending' and "evo_ai_proposals"."reviewed_text" is null and "evo_ai_proposals"."reviewed_by_role" is null and "evo_ai_proposals"."reviewed_at" is null and "evo_ai_proposals"."review_reason" is null) or ("evo_ai_proposals"."review_decision" in ('accepted', 'edited') and "evo_ai_proposals"."reviewed_text" is not null and char_length(btrim("evo_ai_proposals"."reviewed_text")) > 0 and "evo_ai_proposals"."reviewed_by_role" is not null and "evo_ai_proposals"."reviewed_by_role" in ('admin', 'sales', 'admissions') and "evo_ai_proposals"."reviewed_at" is not null) or ("evo_ai_proposals"."review_decision" = 'rejected' and "evo_ai_proposals"."reviewed_text" is null and "evo_ai_proposals"."reviewed_by_role" is not null and "evo_ai_proposals"."reviewed_by_role" in ('admin', 'sales', 'admissions') and "evo_ai_proposals"."reviewed_at" is not null and "evo_ai_proposals"."review_reason" is not null and char_length(btrim("evo_ai_proposals"."review_reason")) > 0)),
	CONSTRAINT "evo_ai_proposals_correlation_check" CHECK (char_length(btrim("evo_ai_proposals"."correlation_id")) > 0),
	CONSTRAINT "evo_ai_proposals_idempotency_check" CHECK (char_length(btrim("evo_ai_proposals"."idempotency_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_finance_stop_states" (
	"id" text PRIMARY KEY NOT NULL,
	"student_case_id" text NOT NULL,
	"is_stopped" boolean NOT NULL,
	"reason" text NOT NULL,
	"changed_by_role" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_finance_stop_states_case_unique" UNIQUE("student_case_id"),
	CONSTRAINT "evo_finance_stop_states_id_uuid_check" CHECK ("evo_finance_stop_states"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_finance_stop_states_reason_check" CHECK (char_length(btrim("evo_finance_stop_states"."reason")) > 0),
	CONSTRAINT "evo_finance_stop_states_role_check" CHECK ("evo_finance_stop_states"."changed_by_role" in ('admin', 'admissions')),
	CONSTRAINT "evo_finance_stop_states_version_check" CHECK ("evo_finance_stop_states"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_university_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"student_case_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"program_name" text NOT NULL,
	"target_intake" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_role" text DEFAULT 'admissions' NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_university_applications_target_unique" UNIQUE("student_case_id","institution_name","program_name","target_intake"),
	CONSTRAINT "evo_university_applications_id_uuid_check" CHECK ("evo_university_applications"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_university_applications_names_check" CHECK (char_length(btrim("evo_university_applications"."institution_name")) > 0 and char_length(btrim("evo_university_applications"."program_name")) > 0 and char_length(btrim("evo_university_applications"."target_intake")) > 0),
	CONSTRAINT "evo_university_applications_status_check" CHECK ("evo_university_applications"."status" in ('draft', 'submitted', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "evo_university_applications_owner_role_check" CHECK ("evo_university_applications"."owner_role" = 'admissions'),
	CONSTRAINT "evo_university_applications_next_action_check" CHECK ("evo_university_applications"."next_action_at" is null or ("evo_university_applications"."next_action" is not null and char_length(btrim("evo_university_applications"."next_action")) > 0)),
	CONSTRAINT "evo_university_applications_timeline_check" CHECK (("evo_university_applications"."status" = 'draft' and "evo_university_applications"."submitted_at" is null and "evo_university_applications"."decided_at" is null) or ("evo_university_applications"."status" = 'submitted' and "evo_university_applications"."submitted_at" is not null and "evo_university_applications"."decided_at" is null) or ("evo_university_applications"."status" in ('accepted', 'rejected') and "evo_university_applications"."submitted_at" is not null and "evo_university_applications"."decided_at" is not null and "evo_university_applications"."decided_at" >= "evo_university_applications"."submitted_at") or ("evo_university_applications"."status" = 'withdrawn' and "evo_university_applications"."decided_at" is not null)),
	CONSTRAINT "evo_university_applications_reason_check" CHECK ("evo_university_applications"."status" not in ('rejected', 'withdrawn') or ("evo_university_applications"."decision_reason" is not null and char_length(btrim("evo_university_applications"."decision_reason")) > 0)),
	CONSTRAINT "evo_university_applications_version_check" CHECK ("evo_university_applications"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_visa_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"student_case_id" text NOT NULL,
	"milestone_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_role" text DEFAULT 'admissions' NOT NULL,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"blocked_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_visa_milestones_case_kind_unique" UNIQUE("student_case_id","milestone_kind"),
	CONSTRAINT "evo_visa_milestones_id_uuid_check" CHECK ("evo_visa_milestones"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_visa_milestones_kind_check" CHECK ("evo_visa_milestones"."milestone_kind" in ('document_preparation', 'appointment', 'submission', 'biometrics', 'interview', 'decision')),
	CONSTRAINT "evo_visa_milestones_status_check" CHECK ("evo_visa_milestones"."status" in ('pending', 'in_progress', 'completed', 'blocked')),
	CONSTRAINT "evo_visa_milestones_owner_role_check" CHECK ("evo_visa_milestones"."owner_role" = 'admissions'),
	CONSTRAINT "evo_visa_milestones_next_action_check" CHECK ("evo_visa_milestones"."next_action_at" is null or ("evo_visa_milestones"."next_action" is not null and char_length(btrim("evo_visa_milestones"."next_action")) > 0)),
	CONSTRAINT "evo_visa_milestones_completion_check" CHECK (("evo_visa_milestones"."status" = 'completed' and "evo_visa_milestones"."completed_at" is not null) or ("evo_visa_milestones"."status" <> 'completed' and "evo_visa_milestones"."completed_at" is null)),
	CONSTRAINT "evo_visa_milestones_blocked_check" CHECK (("evo_visa_milestones"."status" = 'blocked' and "evo_visa_milestones"."blocked_reason" is not null and char_length(btrim("evo_visa_milestones"."blocked_reason")) > 0) or ("evo_visa_milestones"."status" <> 'blocked' and "evo_visa_milestones"."blocked_reason" is null)),
	CONSTRAINT "evo_visa_milestones_version_check" CHECK ("evo_visa_milestones"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "evo_conversations" ADD CONSTRAINT "evo_conversations_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_leads" ADD CONSTRAINT "evo_leads_person_id_evo_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."evo_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_messages" ADD CONSTRAINT "evo_messages_conversation_id_evo_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."evo_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_sales_admissions_handoffs" ADD CONSTRAINT "evo_sales_admissions_handoffs_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_sales_admissions_handoffs" ADD CONSTRAINT "evo_sales_admissions_handoffs_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_sales_admissions_handoffs" ADD CONSTRAINT "evo_sales_admissions_handoffs_contract_evidence_id_evo_sales_gate_evidence_id_fk" FOREIGN KEY ("contract_evidence_id") REFERENCES "public"."evo_sales_gate_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_sales_admissions_handoffs" ADD CONSTRAINT "evo_sales_admissions_handoffs_first_payment_evidence_id_evo_sales_gate_evidence_id_fk" FOREIGN KEY ("first_payment_evidence_id") REFERENCES "public"."evo_sales_gate_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_sales_gate_evidence" ADD CONSTRAINT "evo_sales_gate_evidence_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_student_cases" ADD CONSTRAINT "evo_student_cases_person_id_evo_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."evo_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_student_cases" ADD CONSTRAINT "evo_student_cases_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_admissions_tasks" ADD CONSTRAINT "evo_admissions_tasks_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_ai_proposals" ADD CONSTRAINT "evo_ai_proposals_conversation_id_evo_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."evo_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_ai_proposals" ADD CONSTRAINT "evo_ai_proposals_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_finance_stop_states" ADD CONSTRAINT "evo_finance_stop_states_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_university_applications" ADD CONSTRAINT "evo_university_applications_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_visa_milestones" ADD CONSTRAINT "evo_visa_milestones_student_case_id_evo_student_cases_id_fk" FOREIGN KEY ("student_case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evo_conversations_lead_idx" ON "evo_conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "evo_leads_person_idx" ON "evo_leads" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "evo_leads_stage_idx" ON "evo_leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "evo_messages_conversation_idx" ON "evo_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "evo_sales_gate_evidence_lead_idx" ON "evo_sales_gate_evidence" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "evo_student_cases_person_idx" ON "evo_student_cases" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "evo_business_events_object_idx" ON "evo_business_events" USING btree ("business_object_type","business_object_id","occurred_at");--> statement-breakpoint
CREATE INDEX "evo_business_events_correlation_idx" ON "evo_business_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "evo_command_receipts_correlation_idx" ON "evo_command_receipts" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "evo_admissions_tasks_case_idx" ON "evo_admissions_tasks" USING btree ("student_case_id");--> statement-breakpoint
CREATE INDEX "evo_admissions_tasks_status_due_idx" ON "evo_admissions_tasks" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "evo_ai_proposals_conversation_idx" ON "evo_ai_proposals" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "evo_university_applications_case_idx" ON "evo_university_applications" USING btree ("student_case_id");--> statement-breakpoint
CREATE INDEX "evo_visa_milestones_case_idx" ON "evo_visa_milestones" USING btree ("student_case_id");--> statement-breakpoint
ALTER TABLE "evo_private_documents" ADD CONSTRAINT "evo_private_documents_case_id_evo_student_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."evo_student_cases"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "evo_reject_business_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'evo_business_events is append-only';
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "evo_business_events_reject_update_delete"
BEFORE UPDATE OR DELETE ON "evo_business_events"
FOR EACH ROW
EXECUTE FUNCTION "evo_reject_business_event_mutation"();
--> statement-breakpoint
CREATE TRIGGER "evo_business_events_reject_truncate"
BEFORE TRUNCATE ON "evo_business_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "evo_reject_business_event_mutation"();
--> statement-breakpoint
UPDATE "evo_database_contract"
SET "version" = 3,
	"authority" = 'postgresql',
	"updated_at" = now()
WHERE "id" = 1;
