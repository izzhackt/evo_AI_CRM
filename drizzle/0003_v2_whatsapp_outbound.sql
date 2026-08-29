CREATE TABLE "evo_whatsapp_send_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"source_proposal_id" text,
	"provider" text DEFAULT 'waha' NOT NULL,
	"session_name" text NOT NULL,
	"recipient_chat_id" text NOT NULL,
	"reply_to_external_message_id" text,
	"final_text" text NOT NULL,
	"actor_role" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"provider_message_id" text,
	"provider_occurred_at" timestamp with time zone,
	"provider_source" text,
	"ack" integer,
	"ack_name" text,
	"failure_code" text,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	CONSTRAINT "evo_whatsapp_send_attempts_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_whatsapp_send_attempts_message_unique" UNIQUE("message_id"),
	CONSTRAINT "evo_whatsapp_send_attempts_provider_message_unique" UNIQUE("provider","session_name","provider_message_id"),
	CONSTRAINT "evo_whatsapp_send_attempts_id_uuid_check" CHECK ("evo_whatsapp_send_attempts"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_whatsapp_send_attempts_provider_check" CHECK ("evo_whatsapp_send_attempts"."provider" = 'waha'),
	CONSTRAINT "evo_whatsapp_send_attempts_session_check" CHECK (char_length(btrim("evo_whatsapp_send_attempts"."session_name")) between 1 and 128),
	CONSTRAINT "evo_whatsapp_send_attempts_recipient_check" CHECK ("evo_whatsapp_send_attempts"."recipient_chat_id" ~ '^[1-9][0-9]{4,31}@(c[.]us|lid)$'),
	CONSTRAINT "evo_whatsapp_send_attempts_reply_check" CHECK ("evo_whatsapp_send_attempts"."reply_to_external_message_id" is null or char_length(btrim("evo_whatsapp_send_attempts"."reply_to_external_message_id")) between 1 and 255),
	CONSTRAINT "evo_whatsapp_send_attempts_text_check" CHECK (char_length(btrim("evo_whatsapp_send_attempts"."final_text")) between 1 and 3000),
	CONSTRAINT "evo_whatsapp_send_attempts_role_check" CHECK ("evo_whatsapp_send_attempts"."actor_role" in ('admin', 'sales', 'admissions')),
	CONSTRAINT "evo_whatsapp_send_attempts_status_check" CHECK ("evo_whatsapp_send_attempts"."status" in ('prepared', 'accepted', 'unknown', 'rejected')),
	CONSTRAINT "evo_whatsapp_send_attempts_provider_message_check" CHECK ("evo_whatsapp_send_attempts"."provider_message_id" is null or char_length(btrim("evo_whatsapp_send_attempts"."provider_message_id")) between 1 and 1024),
	CONSTRAINT "evo_whatsapp_send_attempts_source_check" CHECK ("evo_whatsapp_send_attempts"."provider_source" is null or char_length(btrim("evo_whatsapp_send_attempts"."provider_source")) between 1 and 32),
	CONSTRAINT "evo_whatsapp_send_attempts_ack_check" CHECK (("evo_whatsapp_send_attempts"."ack" is null and "evo_whatsapp_send_attempts"."ack_name" is null) or ("evo_whatsapp_send_attempts"."ack" = -1 and "evo_whatsapp_send_attempts"."ack_name" = 'ERROR') or ("evo_whatsapp_send_attempts"."ack" = 0 and "evo_whatsapp_send_attempts"."ack_name" = 'PENDING') or ("evo_whatsapp_send_attempts"."ack" = 1 and "evo_whatsapp_send_attempts"."ack_name" = 'SERVER') or ("evo_whatsapp_send_attempts"."ack" = 2 and "evo_whatsapp_send_attempts"."ack_name" = 'DEVICE') or ("evo_whatsapp_send_attempts"."ack" = 3 and "evo_whatsapp_send_attempts"."ack_name" = 'READ') or ("evo_whatsapp_send_attempts"."ack" = 4 and "evo_whatsapp_send_attempts"."ack_name" = 'PLAYED')),
	CONSTRAINT "evo_whatsapp_send_attempts_failure_check" CHECK ("evo_whatsapp_send_attempts"."failure_code" is null or char_length(btrim("evo_whatsapp_send_attempts"."failure_code")) between 1 and 80),
	CONSTRAINT "evo_whatsapp_send_attempts_correlation_check" CHECK (char_length(btrim("evo_whatsapp_send_attempts"."correlation_id")) > 0),
	CONSTRAINT "evo_whatsapp_send_attempts_idempotency_check" CHECK (char_length(btrim("evo_whatsapp_send_attempts"."idempotency_key")) > 0),
	CONSTRAINT "evo_whatsapp_send_attempts_version_check" CHECK ("evo_whatsapp_send_attempts"."version" > 0),
	CONSTRAINT "evo_whatsapp_send_attempts_state_check" CHECK (("evo_whatsapp_send_attempts"."status" = 'prepared' and "evo_whatsapp_send_attempts"."message_id" is null and "evo_whatsapp_send_attempts"."provider_message_id" is null and "evo_whatsapp_send_attempts"."provider_occurred_at" is null and "evo_whatsapp_send_attempts"."provider_source" is null and "evo_whatsapp_send_attempts"."ack" is null and "evo_whatsapp_send_attempts"."ack_name" is null and "evo_whatsapp_send_attempts"."failure_code" is null and "evo_whatsapp_send_attempts"."settled_at" is null and "evo_whatsapp_send_attempts"."last_reconciled_at" is null) or ("evo_whatsapp_send_attempts"."status" = 'accepted' and "evo_whatsapp_send_attempts"."message_id" is not null and "evo_whatsapp_send_attempts"."provider_message_id" is not null and "evo_whatsapp_send_attempts"."provider_occurred_at" is not null and "evo_whatsapp_send_attempts"."ack" is not null and "evo_whatsapp_send_attempts"."ack_name" is not null and "evo_whatsapp_send_attempts"."failure_code" is null and "evo_whatsapp_send_attempts"."settled_at" is not null) or ("evo_whatsapp_send_attempts"."status" in ('unknown', 'rejected') and "evo_whatsapp_send_attempts"."message_id" is null and "evo_whatsapp_send_attempts"."provider_message_id" is null and "evo_whatsapp_send_attempts"."provider_occurred_at" is null and "evo_whatsapp_send_attempts"."provider_source" is null and "evo_whatsapp_send_attempts"."ack" is null and "evo_whatsapp_send_attempts"."ack_name" is null and "evo_whatsapp_send_attempts"."failure_code" is not null and "evo_whatsapp_send_attempts"."settled_at" is not null and "evo_whatsapp_send_attempts"."last_reconciled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "evo_business_events" DROP CONSTRAINT "evo_business_events_object_type_check";--> statement-breakpoint
ALTER TABLE "evo_whatsapp_send_attempts" ADD CONSTRAINT "evo_whatsapp_send_attempts_conversation_id_evo_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."evo_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_whatsapp_send_attempts" ADD CONSTRAINT "evo_whatsapp_send_attempts_message_id_evo_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."evo_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_whatsapp_send_attempts" ADD CONSTRAINT "evo_whatsapp_send_attempts_source_proposal_id_evo_ai_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."evo_ai_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evo_whatsapp_send_attempts_conversation_created_idx" ON "evo_whatsapp_send_attempts" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "evo_business_events" ADD CONSTRAINT "evo_business_events_object_type_check" CHECK ("evo_business_events"."business_object_type" in ('person', 'lead', 'conversation', 'message', 'student_case', 'gate_evidence', 'handoff', 'task', 'document', 'application', 'visa_milestone', 'finance_stop', 'ai_proposal', 'whatsapp_send_attempt'));
