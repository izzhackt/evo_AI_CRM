CREATE TABLE "evo_amocrm_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'amocrm' NOT NULL,
	"provider_account_id" text NOT NULL,
	"account_base_url" text NOT NULL,
	"account_subdomain" text NOT NULL,
	"account_name" text NOT NULL,
	"timezone" text NOT NULL,
	"country" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_amocrm_accounts_provider_id_unique" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "evo_amocrm_accounts_base_url_unique" UNIQUE("account_base_url"),
	CONSTRAINT "evo_amocrm_accounts_subdomain_unique" UNIQUE("account_subdomain"),
	CONSTRAINT "evo_amocrm_accounts_id_uuid_check" CHECK ("evo_amocrm_accounts"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_amocrm_accounts_provider_check" CHECK ("evo_amocrm_accounts"."provider" = 'amocrm'),
	CONSTRAINT "evo_amocrm_accounts_provider_id_check" CHECK ("evo_amocrm_accounts"."provider_account_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "evo_amocrm_accounts_base_url_check" CHECK ("evo_amocrm_accounts"."account_base_url" ~ '^https://[a-z0-9][a-z0-9-]{0,62}[.](amocrm[.]ru|kommo[.]com)$'),
	CONSTRAINT "evo_amocrm_accounts_subdomain_check" CHECK ("evo_amocrm_accounts"."account_subdomain" ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "evo_amocrm_accounts_name_check" CHECK (char_length(btrim("evo_amocrm_accounts"."account_name")) between 1 and 255),
	CONSTRAINT "evo_amocrm_accounts_timezone_check" CHECK (char_length(btrim("evo_amocrm_accounts"."timezone")) between 1 and 128),
	CONSTRAINT "evo_amocrm_accounts_country_check" CHECK ("evo_amocrm_accounts"."country" is null or char_length(btrim("evo_amocrm_accounts"."country")) between 1 and 128),
	CONSTRAINT "evo_amocrm_accounts_version_check" CHECK ("evo_amocrm_accounts"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_amocrm_contact_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"person_id" text NOT NULL,
	"provider_contact_id" text NOT NULL,
	"created_by_attempt_id" text,
	"created_by_attempt_status" text,
	"provider_updated_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_amocrm_contacts_account_person_unique" UNIQUE("account_id","person_id"),
	CONSTRAINT "evo_amocrm_contacts_account_provider_unique" UNIQUE("account_id","provider_contact_id"),
	CONSTRAINT "evo_amocrm_contacts_attempt_unique" UNIQUE("created_by_attempt_id"),
	CONSTRAINT "evo_amocrm_contacts_id_uuid_check" CHECK ("evo_amocrm_contact_bindings"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_amocrm_contacts_provider_id_check" CHECK ("evo_amocrm_contact_bindings"."provider_contact_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "evo_amocrm_contacts_creation_status_check" CHECK (("evo_amocrm_contact_bindings"."created_by_attempt_id" is null and "evo_amocrm_contact_bindings"."created_by_attempt_status" is null) or ("evo_amocrm_contact_bindings"."created_by_attempt_id" is not null and "evo_amocrm_contact_bindings"."created_by_attempt_status" = 'accepted')),
	CONSTRAINT "evo_amocrm_contacts_version_check" CHECK ("evo_amocrm_contact_bindings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_amocrm_discovery_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"pipeline_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_custom_field_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_custom_field_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redaction_version" integer DEFAULT 1 NOT NULL,
	"correlation_id" text NOT NULL,
	"discovered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_amocrm_discovery_account_hash_unique" UNIQUE("account_id","snapshot_sha256"),
	CONSTRAINT "evo_amocrm_discovery_id_uuid_check" CHECK ("evo_amocrm_discovery_snapshots"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_amocrm_discovery_snapshot_hash_check" CHECK ("evo_amocrm_discovery_snapshots"."snapshot_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evo_amocrm_discovery_catalog_shape_check" CHECK (jsonb_typeof("evo_amocrm_discovery_snapshots"."pipeline_catalog") = 'array' and jsonb_typeof("evo_amocrm_discovery_snapshots"."user_catalog") = 'array' and jsonb_typeof("evo_amocrm_discovery_snapshots"."lead_custom_field_catalog") = 'array' and jsonb_typeof("evo_amocrm_discovery_snapshots"."contact_custom_field_catalog") = 'array'),
	CONSTRAINT "evo_amocrm_discovery_catalog_size_check" CHECK (octet_length("evo_amocrm_discovery_snapshots"."pipeline_catalog"::text) <= 1048576 and octet_length("evo_amocrm_discovery_snapshots"."user_catalog"::text) <= 1048576 and octet_length("evo_amocrm_discovery_snapshots"."lead_custom_field_catalog"::text) <= 1048576 and octet_length("evo_amocrm_discovery_snapshots"."contact_custom_field_catalog"::text) <= 1048576),
	CONSTRAINT "evo_amocrm_discovery_catalog_secret_check" CHECK (("evo_amocrm_discovery_snapshots"."pipeline_catalog"::text || "evo_amocrm_discovery_snapshots"."user_catalog"::text || "evo_amocrm_discovery_snapshots"."lead_custom_field_catalog"::text || "evo_amocrm_discovery_snapshots"."contact_custom_field_catalog"::text) !~* '"[^"]*(token|secret|authorization|api[_-]?key)[^"]*"[[:space:]]*:'),
	CONSTRAINT "evo_amocrm_discovery_redaction_check" CHECK ("evo_amocrm_discovery_snapshots"."redaction_version" = 1),
	CONSTRAINT "evo_amocrm_discovery_correlation_check" CHECK (char_length(btrim("evo_amocrm_discovery_snapshots"."correlation_id")) between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "evo_amocrm_lead_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"provider_lead_id" text NOT NULL,
	"created_by_attempt_id" text,
	"created_by_attempt_status" text,
	"provider_updated_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_amocrm_leads_account_lead_unique" UNIQUE("account_id","lead_id"),
	CONSTRAINT "evo_amocrm_leads_account_provider_unique" UNIQUE("account_id","provider_lead_id"),
	CONSTRAINT "evo_amocrm_leads_attempt_unique" UNIQUE("created_by_attempt_id"),
	CONSTRAINT "evo_amocrm_leads_id_uuid_check" CHECK ("evo_amocrm_lead_bindings"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_amocrm_leads_provider_id_check" CHECK ("evo_amocrm_lead_bindings"."provider_lead_id" ~ '^[1-9][0-9]{0,19}$'),
	CONSTRAINT "evo_amocrm_leads_creation_status_check" CHECK (("evo_amocrm_lead_bindings"."created_by_attempt_id" is null and "evo_amocrm_lead_bindings"."created_by_attempt_status" is null) or ("evo_amocrm_lead_bindings"."created_by_attempt_id" is not null and "evo_amocrm_lead_bindings"."created_by_attempt_status" = 'accepted')),
	CONSTRAINT "evo_amocrm_leads_version_check" CHECK ("evo_amocrm_lead_bindings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "evo_amocrm_operation_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"command_receipt_id" text NOT NULL,
	"provider" text DEFAULT 'amocrm' NOT NULL,
	"operation_name" text NOT NULL,
	"person_id" text,
	"lead_id" text,
	"actor_role" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"provider_request_metadata" jsonb NOT NULL,
	"provider_request_sha256" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_contact_id" text,
	"target_lead_id" text,
	"result_contact_id" text,
	"result_lead_id" text,
	"provider_http_status" integer,
	"provider_request_id" text,
	"provider_dispatched_at" timestamp with time zone,
	"provider_responded_at" timestamp with time zone,
	"provider_readback" jsonb,
	"provider_readback_sha256" text,
	"provider_readback_at" timestamp with time zone,
	"failure_code" text,
	"correlation_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	CONSTRAINT "evo_amocrm_attempts_receipt_unique" UNIQUE("command_receipt_id"),
	CONSTRAINT "evo_amocrm_attempts_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "evo_amocrm_attempts_contact_binding_unique" UNIQUE("account_id","id","status","person_id","result_contact_id"),
	CONSTRAINT "evo_amocrm_attempts_lead_binding_unique" UNIQUE("account_id","id","status","lead_id","result_lead_id"),
	CONSTRAINT "evo_amocrm_attempts_id_uuid_check" CHECK ("evo_amocrm_operation_attempts"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_amocrm_attempts_provider_check" CHECK ("evo_amocrm_operation_attempts"."provider" = 'amocrm'),
	CONSTRAINT "evo_amocrm_attempts_operation_check" CHECK ("evo_amocrm_operation_attempts"."operation_name" in ('contact_create', 'contact_update', 'lead_create', 'lead_update', 'contact_lead_link', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update')),
	CONSTRAINT "evo_amocrm_attempts_object_target_check" CHECK (("evo_amocrm_operation_attempts"."operation_name" in ('contact_create', 'contact_update') and "evo_amocrm_operation_attempts"."person_id" is not null and "evo_amocrm_operation_attempts"."lead_id" is null) or ("evo_amocrm_operation_attempts"."operation_name" in ('lead_create', 'lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and "evo_amocrm_operation_attempts"."person_id" is null and "evo_amocrm_operation_attempts"."lead_id" is not null) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_lead_link' and "evo_amocrm_operation_attempts"."person_id" is not null and "evo_amocrm_operation_attempts"."lead_id" is not null)),
	CONSTRAINT "evo_amocrm_attempts_role_check" CHECK ("evo_amocrm_operation_attempts"."actor_role" in ('admin', 'sales', 'admissions')),
	CONSTRAINT "evo_amocrm_attempts_status_check" CHECK ("evo_amocrm_operation_attempts"."status" in ('prepared', 'accepted', 'unknown', 'rejected')),
	CONSTRAINT "evo_amocrm_attempts_request_shape_check" CHECK (jsonb_typeof("evo_amocrm_operation_attempts"."provider_request_metadata") = 'object' and octet_length("evo_amocrm_operation_attempts"."provider_request_metadata"::text) <= 65536),
	CONSTRAINT "evo_amocrm_attempts_request_secret_check" CHECK ("evo_amocrm_operation_attempts"."provider_request_metadata"::text !~* '"[^"]*(token|secret|authorization|api[_-]?key|header)[^"]*"[[:space:]]*:'),
	CONSTRAINT "evo_amocrm_attempts_request_hash_check" CHECK ("evo_amocrm_operation_attempts"."provider_request_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evo_amocrm_attempts_provider_id_check" CHECK (("evo_amocrm_operation_attempts"."target_contact_id" is null or "evo_amocrm_operation_attempts"."target_contact_id" ~ '^[1-9][0-9]{0,19}$') and ("evo_amocrm_operation_attempts"."target_lead_id" is null or "evo_amocrm_operation_attempts"."target_lead_id" ~ '^[1-9][0-9]{0,19}$') and ("evo_amocrm_operation_attempts"."result_contact_id" is null or "evo_amocrm_operation_attempts"."result_contact_id" ~ '^[1-9][0-9]{0,19}$') and ("evo_amocrm_operation_attempts"."result_lead_id" is null or "evo_amocrm_operation_attempts"."result_lead_id" ~ '^[1-9][0-9]{0,19}$')),
	CONSTRAINT "evo_amocrm_attempts_provider_target_check" CHECK (("evo_amocrm_operation_attempts"."operation_name" in ('contact_create', 'lead_create') and "evo_amocrm_operation_attempts"."target_contact_id" is null and "evo_amocrm_operation_attempts"."target_lead_id" is null) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_update' and "evo_amocrm_operation_attempts"."target_contact_id" is not null and "evo_amocrm_operation_attempts"."target_lead_id" is null) or ("evo_amocrm_operation_attempts"."operation_name" in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and "evo_amocrm_operation_attempts"."target_contact_id" is null and "evo_amocrm_operation_attempts"."target_lead_id" is not null) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_lead_link' and "evo_amocrm_operation_attempts"."target_contact_id" is not null and "evo_amocrm_operation_attempts"."target_lead_id" is not null)),
	CONSTRAINT "evo_amocrm_attempts_provider_result_check" CHECK (("evo_amocrm_operation_attempts"."operation_name" = 'contact_create' and "evo_amocrm_operation_attempts"."result_lead_id" is null) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_update' and "evo_amocrm_operation_attempts"."result_lead_id" is null and ("evo_amocrm_operation_attempts"."result_contact_id" is null or "evo_amocrm_operation_attempts"."result_contact_id" = "evo_amocrm_operation_attempts"."target_contact_id")) or ("evo_amocrm_operation_attempts"."operation_name" = 'lead_create' and "evo_amocrm_operation_attempts"."result_contact_id" is null) or ("evo_amocrm_operation_attempts"."operation_name" in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and "evo_amocrm_operation_attempts"."result_contact_id" is null and ("evo_amocrm_operation_attempts"."result_lead_id" is null or "evo_amocrm_operation_attempts"."result_lead_id" = "evo_amocrm_operation_attempts"."target_lead_id")) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_lead_link' and (("evo_amocrm_operation_attempts"."result_contact_id" is null and "evo_amocrm_operation_attempts"."result_lead_id" is null) or ("evo_amocrm_operation_attempts"."result_contact_id" = "evo_amocrm_operation_attempts"."target_contact_id" and "evo_amocrm_operation_attempts"."result_lead_id" = "evo_amocrm_operation_attempts"."target_lead_id")))),
	CONSTRAINT "evo_amocrm_attempts_transport_check" CHECK (("evo_amocrm_operation_attempts"."provider_dispatched_at" is null and "evo_amocrm_operation_attempts"."provider_responded_at" is null and "evo_amocrm_operation_attempts"."provider_http_status" is null and "evo_amocrm_operation_attempts"."provider_request_id" is null) or ("evo_amocrm_operation_attempts"."provider_dispatched_at" is not null and "evo_amocrm_operation_attempts"."provider_responded_at" is null and "evo_amocrm_operation_attempts"."provider_http_status" is null and "evo_amocrm_operation_attempts"."provider_request_id" is null) or ("evo_amocrm_operation_attempts"."provider_dispatched_at" is not null and "evo_amocrm_operation_attempts"."provider_responded_at" is not null and "evo_amocrm_operation_attempts"."provider_http_status" between 100 and 599)),
	CONSTRAINT "evo_amocrm_attempts_request_id_check" CHECK ("evo_amocrm_operation_attempts"."provider_request_id" is null or (char_length(btrim("evo_amocrm_operation_attempts"."provider_request_id")) between 1 and 255 and "evo_amocrm_operation_attempts"."provider_request_id" !~ '[[:cntrl:]]')),
	CONSTRAINT "evo_amocrm_attempts_timestamp_order_check" CHECK (("evo_amocrm_operation_attempts"."provider_dispatched_at" is null or "evo_amocrm_operation_attempts"."provider_dispatched_at" >= "evo_amocrm_operation_attempts"."prepared_at") and ("evo_amocrm_operation_attempts"."provider_responded_at" is null or "evo_amocrm_operation_attempts"."provider_responded_at" >= "evo_amocrm_operation_attempts"."provider_dispatched_at") and ("evo_amocrm_operation_attempts"."settled_at" is null or "evo_amocrm_operation_attempts"."settled_at" >= "evo_amocrm_operation_attempts"."prepared_at") and ("evo_amocrm_operation_attempts"."last_reconciled_at" is null or ("evo_amocrm_operation_attempts"."settled_at" is not null and "evo_amocrm_operation_attempts"."last_reconciled_at" >= "evo_amocrm_operation_attempts"."settled_at"))),
	CONSTRAINT "evo_amocrm_attempts_readback_tuple_check" CHECK (("evo_amocrm_operation_attempts"."provider_readback" is null and "evo_amocrm_operation_attempts"."provider_readback_sha256" is null and "evo_amocrm_operation_attempts"."provider_readback_at" is null) or ("evo_amocrm_operation_attempts"."provider_readback" is not null and "evo_amocrm_operation_attempts"."provider_readback_sha256" ~ '^[0-9a-f]{64}$' and "evo_amocrm_operation_attempts"."provider_readback_at" is not null)),
	CONSTRAINT "evo_amocrm_attempts_readback_shape_check" CHECK ("evo_amocrm_operation_attempts"."provider_readback" is null or jsonb_typeof("evo_amocrm_operation_attempts"."provider_readback") = 'object'),
	CONSTRAINT "evo_amocrm_attempts_readback_size_check" CHECK ("evo_amocrm_operation_attempts"."provider_readback" is null or octet_length("evo_amocrm_operation_attempts"."provider_readback"::text) <= 1048576),
	CONSTRAINT "evo_amocrm_attempts_readback_secret_check" CHECK ("evo_amocrm_operation_attempts"."provider_readback" is null or "evo_amocrm_operation_attempts"."provider_readback"::text !~* '"[^"]*(token|secret|authorization|api[_-]?key)[^"]*"[[:space:]]*:'),
	CONSTRAINT "evo_amocrm_attempts_failure_check" CHECK ("evo_amocrm_operation_attempts"."failure_code" is null or char_length(btrim("evo_amocrm_operation_attempts"."failure_code")) between 1 and 80),
	CONSTRAINT "evo_amocrm_attempts_correlation_check" CHECK (char_length(btrim("evo_amocrm_operation_attempts"."correlation_id")) between 1 and 255),
	CONSTRAINT "evo_amocrm_attempts_idempotency_check" CHECK (char_length(btrim("evo_amocrm_operation_attempts"."idempotency_key")) between 1 and 255),
	CONSTRAINT "evo_amocrm_attempts_version_check" CHECK ("evo_amocrm_operation_attempts"."version" > 0),
	CONSTRAINT "evo_amocrm_attempts_state_check" CHECK (("evo_amocrm_operation_attempts"."status" = 'prepared' and "evo_amocrm_operation_attempts"."result_contact_id" is null and "evo_amocrm_operation_attempts"."result_lead_id" is null and "evo_amocrm_operation_attempts"."provider_responded_at" is null and "evo_amocrm_operation_attempts"."provider_http_status" is null and "evo_amocrm_operation_attempts"."provider_request_id" is null and "evo_amocrm_operation_attempts"."provider_readback" is null and "evo_amocrm_operation_attempts"."provider_readback_sha256" is null and "evo_amocrm_operation_attempts"."provider_readback_at" is null and "evo_amocrm_operation_attempts"."failure_code" is null and "evo_amocrm_operation_attempts"."settled_at" is null and "evo_amocrm_operation_attempts"."last_reconciled_at" is null) or ("evo_amocrm_operation_attempts"."status" = 'accepted' and "evo_amocrm_operation_attempts"."provider_dispatched_at" is not null and "evo_amocrm_operation_attempts"."provider_responded_at" is not null and "evo_amocrm_operation_attempts"."provider_http_status" between 200 and 299 and "evo_amocrm_operation_attempts"."provider_readback" is not null and "evo_amocrm_operation_attempts"."provider_readback_sha256" is not null and "evo_amocrm_operation_attempts"."provider_readback_at" is not null and "evo_amocrm_operation_attempts"."failure_code" is null and "evo_amocrm_operation_attempts"."settled_at" is not null and (("evo_amocrm_operation_attempts"."operation_name" = 'contact_create' and "evo_amocrm_operation_attempts"."result_contact_id" is not null) or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_update' and "evo_amocrm_operation_attempts"."result_contact_id" = "evo_amocrm_operation_attempts"."target_contact_id") or ("evo_amocrm_operation_attempts"."operation_name" = 'lead_create' and "evo_amocrm_operation_attempts"."result_lead_id" is not null) or ("evo_amocrm_operation_attempts"."operation_name" in ('lead_update', 'lead_pipeline_status_update', 'lead_responsible_update', 'lead_note_create', 'lead_tag_update') and "evo_amocrm_operation_attempts"."result_lead_id" = "evo_amocrm_operation_attempts"."target_lead_id") or ("evo_amocrm_operation_attempts"."operation_name" = 'contact_lead_link' and "evo_amocrm_operation_attempts"."result_contact_id" = "evo_amocrm_operation_attempts"."target_contact_id" and "evo_amocrm_operation_attempts"."result_lead_id" = "evo_amocrm_operation_attempts"."target_lead_id"))) or ("evo_amocrm_operation_attempts"."status" = 'unknown' and "evo_amocrm_operation_attempts"."provider_dispatched_at" is not null and "evo_amocrm_operation_attempts"."failure_code" is not null and "evo_amocrm_operation_attempts"."settled_at" is not null) or ("evo_amocrm_operation_attempts"."status" = 'rejected' and "evo_amocrm_operation_attempts"."provider_dispatched_at" is not null and "evo_amocrm_operation_attempts"."provider_responded_at" is not null and "evo_amocrm_operation_attempts"."provider_http_status" between 300 and 599 and "evo_amocrm_operation_attempts"."result_contact_id" is null and "evo_amocrm_operation_attempts"."result_lead_id" is null and "evo_amocrm_operation_attempts"."failure_code" is not null and "evo_amocrm_operation_attempts"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "evo_amocrm_contact_bindings" ADD CONSTRAINT "evo_amocrm_contact_bindings_account_id_evo_amocrm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."evo_amocrm_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_contact_bindings" ADD CONSTRAINT "evo_amocrm_contact_bindings_person_id_evo_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."evo_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_contact_bindings" ADD CONSTRAINT "evo_amocrm_contacts_creation_attempt_fk" FOREIGN KEY ("account_id","created_by_attempt_id","created_by_attempt_status","person_id","provider_contact_id") REFERENCES "public"."evo_amocrm_operation_attempts"("account_id","id","status","person_id","result_contact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_discovery_snapshots" ADD CONSTRAINT "evo_amocrm_discovery_snapshots_account_id_evo_amocrm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."evo_amocrm_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_lead_bindings" ADD CONSTRAINT "evo_amocrm_lead_bindings_account_id_evo_amocrm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."evo_amocrm_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_lead_bindings" ADD CONSTRAINT "evo_amocrm_lead_bindings_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_lead_bindings" ADD CONSTRAINT "evo_amocrm_leads_creation_attempt_fk" FOREIGN KEY ("account_id","created_by_attempt_id","created_by_attempt_status","lead_id","provider_lead_id") REFERENCES "public"."evo_amocrm_operation_attempts"("account_id","id","status","lead_id","result_lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_operation_attempts" ADD CONSTRAINT "evo_amocrm_operation_attempts_account_id_evo_amocrm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."evo_amocrm_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_operation_attempts" ADD CONSTRAINT "evo_amocrm_operation_attempts_command_receipt_id_evo_command_receipts_id_fk" FOREIGN KEY ("command_receipt_id") REFERENCES "public"."evo_command_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_operation_attempts" ADD CONSTRAINT "evo_amocrm_operation_attempts_person_id_evo_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."evo_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evo_amocrm_operation_attempts" ADD CONSTRAINT "evo_amocrm_operation_attempts_lead_id_evo_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."evo_leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evo_amocrm_contacts_person_idx" ON "evo_amocrm_contact_bindings" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "evo_amocrm_discovery_account_time_idx" ON "evo_amocrm_discovery_snapshots" USING btree ("account_id","discovered_at");--> statement-breakpoint
CREATE INDEX "evo_amocrm_leads_lead_idx" ON "evo_amocrm_lead_bindings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "evo_amocrm_attempts_account_status_idx" ON "evo_amocrm_operation_attempts" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "evo_amocrm_attempts_person_created_idx" ON "evo_amocrm_operation_attempts" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "evo_amocrm_attempts_lead_created_idx" ON "evo_amocrm_operation_attempts" USING btree ("lead_id","created_at");--> statement-breakpoint
UPDATE "evo_database_contract"
SET "version" = 4,
	"authority" = 'postgresql',
	"updated_at" = now()
WHERE "id" = 1;
