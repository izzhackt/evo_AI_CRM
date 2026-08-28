CREATE TABLE "evo_private_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_private_document_versions_document_version_unique" UNIQUE("document_id","version_number"),
	CONSTRAINT "evo_private_document_versions_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "evo_private_document_versions_id_uuid_check" CHECK ("evo_private_document_versions"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_private_document_versions_object_key_uuid_check" CHECK ("evo_private_document_versions"."object_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_private_document_versions_version_number_check" CHECK ("evo_private_document_versions"."version_number" > 0),
	CONSTRAINT "evo_private_document_versions_original_filename_check" CHECK (char_length("evo_private_document_versions"."original_filename") > 0),
	CONSTRAINT "evo_private_document_versions_declared_mime_type_check" CHECK ("evo_private_document_versions"."declared_mime_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "evo_private_document_versions_byte_length_check" CHECK ("evo_private_document_versions"."byte_length" > 0 and "evo_private_document_versions"."byte_length" <= 26214400),
	CONSTRAINT "evo_private_document_versions_sha256_check" CHECK ("evo_private_document_versions"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evo_private_document_versions_created_by_role_check" CHECK ("evo_private_document_versions"."created_by_role" in ('admin', 'admissions'))
);
--> statement-breakpoint
CREATE TABLE "evo_private_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"created_by_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evo_private_documents_id_uuid_check" CHECK ("evo_private_documents"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_private_documents_case_id_uuid_check" CHECK ("evo_private_documents"."case_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "evo_private_documents_created_by_role_check" CHECK ("evo_private_documents"."created_by_role" in ('admin', 'admissions'))
);
--> statement-breakpoint
ALTER TABLE "evo_private_document_versions" ADD CONSTRAINT "evo_private_document_versions_document_id_evo_private_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."evo_private_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
UPDATE "evo_database_contract"
SET "version" = 2,
	"authority" = 'postgresql',
	"updated_at" = now()
WHERE "id" = 1;
