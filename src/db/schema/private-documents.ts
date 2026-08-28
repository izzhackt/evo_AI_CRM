import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const PRIVATE_DOCUMENT_MAX_BYTE_LENGTH = 25 * 1024 * 1024;

export const evoPrivateDocuments = pgTable(
  "evo_private_documents",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
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
    check(
      "evo_private_documents_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_private_documents_case_id_uuid_check",
      sql`${table.caseId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_private_documents_created_by_role_check",
      sql`${table.createdByRole} in ('admin', 'admissions')`,
    ),
  ],
);

export const evoPrivateDocumentVersions = pgTable(
  "evo_private_document_versions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => evoPrivateDocuments.id),
    versionNumber: integer("version_number").notNull(),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    createdByRole: text("created_by_role").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("evo_private_document_versions_document_version_unique").on(
      table.documentId,
      table.versionNumber,
    ),
    unique("evo_private_document_versions_object_key_unique").on(table.objectKey),
    check(
      "evo_private_document_versions_id_uuid_check",
      sql`${table.id} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_private_document_versions_object_key_uuid_check",
      sql`${table.objectKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "evo_private_document_versions_version_number_check",
      sql`${table.versionNumber} > 0`,
    ),
    check(
      "evo_private_document_versions_original_filename_check",
      sql`char_length(${table.originalFilename}) > 0`,
    ),
    check(
      "evo_private_document_versions_declared_mime_type_check",
      sql`${table.declaredMimeType} in ('application/pdf', 'image/jpeg', 'image/png')`,
    ),
    check(
      "evo_private_document_versions_byte_length_check",
      sql`${table.byteLength} > 0 and ${table.byteLength} <= ${sql.raw(String(PRIVATE_DOCUMENT_MAX_BYTE_LENGTH))}`,
    ),
    check(
      "evo_private_document_versions_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "evo_private_document_versions_created_by_role_check",
      sql`${table.createdByRole} in ('admin', 'admissions')`,
    ),
  ],
);
