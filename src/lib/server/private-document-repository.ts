import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, max, sql } from "drizzle-orm";

import {
  evoLeads,
  evoPeople,
  evoStudentCases,
} from "../../db/schema/canonical-crm-core.ts";
import {
  evoPrivateDocuments,
  evoPrivateDocumentVersions,
} from "../../db/schema/index.ts";
import { fixedRoleCan, type FixedRole } from "../fixed-role-policy.ts";
import { getDatabase } from "./database.ts";
import {
  readPrivateDocumentObject,
  removePrivateDocumentObject,
  requireStoredPrivateDocumentUpload,
  type StoredPrivateDocumentUpload,
} from "./private-document-files.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type PrivateDocumentVersionMetadata = Readonly<{
  documentId: string;
  caseId: string;
  versionId: string;
  versionNumber: number;
  originalFilename: string;
  declaredMimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
}>;

export type PrivateDocumentDownload = Readonly<{
  metadata: PrivateDocumentVersionMetadata;
  bytes: Buffer;
}>;

export type PrivateDocumentCaseStatus = "active" | "paused" | "closed";

export type PrivateDocumentRecord = Readonly<{
  documentId: string;
  caseId: string;
  leadId: string;
  personId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  caseStatus: PrivateDocumentCaseStatus;
  createdAt: string;
  updatedAt: string;
  versions: readonly PrivateDocumentVersionMetadata[];
}>;

export type PrivateDocumentQueueRow = Readonly<{
  documentId: string;
  caseId: string;
  leadId: string;
  personId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  caseStatus: PrivateDocumentCaseStatus;
  createdAt: string;
  updatedAt: string;
  latestVersion: PrivateDocumentVersionMetadata;
}>;

export class PrivateDocumentRepositoryError extends Error {
  readonly code: "invalid_input" | "not_found" | "unavailable";

  constructor(code: "invalid_input" | "not_found" | "unavailable") {
    super("Private document repository is unavailable.");
    this.name = "PrivateDocumentRepositoryError";
    this.code = code;
  }
}

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function assertDocumentRole(
  actorRole: FixedRole,
  capability: "documents.read" | "documents.write",
): void {
  if (!fixedRoleCan(actorRole, capability)) {
    throw new PrivateDocumentRepositoryError("not_found");
  }
}

function databaseCaseStatus(value: string): PrivateDocumentCaseStatus {
  if (value === "active" || value === "paused" || value === "closed") {
    return value;
  }
  throw new PrivateDocumentRepositoryError("unavailable");
}

function owningLeadJoin() {
  return and(
    eq(evoLeads.id, evoStudentCases.leadId),
    eq(evoLeads.personId, evoStudentCases.personId),
  );
}

async function assertReadableCase(
  caseId: string,
  requireActive: boolean,
): Promise<void> {
  let row;
  try {
    [row] = await getDatabase()
      .select({ id: evoStudentCases.id })
      .from(evoStudentCases)
      .innerJoin(evoLeads, owningLeadJoin())
      .where(
        and(
          eq(evoStudentCases.id, caseId),
          eq(evoLeads.stage, "handed_off"),
          requireActive ? eq(evoStudentCases.status, "active") : undefined,
        ),
      )
      .limit(1);
  } catch {
    throw new PrivateDocumentRepositoryError("unavailable");
  }
  if (!row) throw new PrivateDocumentRepositoryError("not_found");
}

async function assertReadableDocument(
  documentId: string,
  requireActive: boolean,
): Promise<void> {
  let row;
  try {
    [row] = await getDatabase()
      .select({ id: evoPrivateDocuments.id })
      .from(evoPrivateDocuments)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoPrivateDocuments.caseId),
      )
      .innerJoin(evoLeads, owningLeadJoin())
      .where(
        and(
          eq(evoPrivateDocuments.id, documentId),
          eq(evoLeads.stage, "handed_off"),
          requireActive ? eq(evoStudentCases.status, "active") : undefined,
        ),
      )
      .limit(1);
  } catch {
    throw new PrivateDocumentRepositoryError("unavailable");
  }
  if (!row) throw new PrivateDocumentRepositoryError("not_found");
}

function toMetadata(row: Readonly<{
  documentId: string;
  caseId: string;
  versionId: string;
  versionNumber: number;
  originalFilename: string;
  declaredMimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: Date;
}>): PrivateDocumentVersionMetadata {
  return {
    documentId: row.documentId,
    caseId: row.caseId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    originalFilename: row.originalFilename,
    declaredMimeType: row.declaredMimeType,
    byteLength: row.byteLength,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };
}

async function cleanupUncommittedObject(objectKey: string): Promise<void> {
  try {
    await removePrivateDocumentObject(objectKey);
  } catch {
    // The row is never committed, so an unsuccessful cleanup can leave only an
    // unreachable private orphan. Do not replace the original safe DB error.
  }
}

export async function assertPrivateDocumentCreateTargetWritable(input: Readonly<{
  actorRole: FixedRole;
  caseId: string;
}>): Promise<string> {
  assertDocumentRole(input.actorRole, "documents.write");
  const caseId = parseUuid(input.caseId);
  if (!caseId) throw new PrivateDocumentRepositoryError("invalid_input");
  await assertReadableCase(caseId, true);
  return caseId;
}

export async function assertPrivateDocumentResubmitTargetWritable(input: Readonly<{
  actorRole: FixedRole;
  documentId: string;
}>): Promise<string> {
  assertDocumentRole(input.actorRole, "documents.write");
  const documentId = parseUuid(input.documentId);
  if (!documentId) throw new PrivateDocumentRepositoryError("invalid_input");
  await assertReadableDocument(documentId, true);
  return documentId;
}

export async function listPrivateDocumentsForCase(input: Readonly<{
  actorRole: FixedRole;
  caseId: string;
}>): Promise<readonly PrivateDocumentRecord[]> {
  assertDocumentRole(input.actorRole, "documents.read");
  const caseId = parseUuid(input.caseId);
  if (!caseId) throw new PrivateDocumentRepositoryError("invalid_input");
  await assertReadableCase(caseId, false);

  let rows;
  try {
    rows = await getDatabase()
      .select({
        documentId: evoPrivateDocuments.id,
        caseId: evoStudentCases.id,
        leadId: evoLeads.id,
        personId: evoPeople.id,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
        caseStatus: evoStudentCases.status,
        documentCreatedAt: evoPrivateDocuments.createdAt,
        documentUpdatedAt: evoPrivateDocuments.updatedAt,
        versionId: evoPrivateDocumentVersions.id,
        versionNumber: evoPrivateDocumentVersions.versionNumber,
        originalFilename: evoPrivateDocumentVersions.originalFilename,
        declaredMimeType: evoPrivateDocumentVersions.declaredMimeType,
        byteLength: evoPrivateDocumentVersions.byteLength,
        sha256: evoPrivateDocumentVersions.sha256,
        versionCreatedAt: evoPrivateDocumentVersions.createdAt,
      })
      .from(evoPrivateDocuments)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoPrivateDocuments.caseId),
      )
      .innerJoin(evoLeads, owningLeadJoin())
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .innerJoin(
        evoPrivateDocumentVersions,
        eq(evoPrivateDocumentVersions.documentId, evoPrivateDocuments.id),
      )
      .where(
        and(
          eq(evoStudentCases.id, caseId),
          eq(evoLeads.stage, "handed_off"),
        ),
      )
      .orderBy(
        desc(evoPrivateDocuments.updatedAt),
        desc(evoPrivateDocuments.id),
        desc(evoPrivateDocumentVersions.versionNumber),
        desc(evoPrivateDocumentVersions.id),
      );
  } catch (error) {
    if (error instanceof PrivateDocumentRepositoryError) throw error;
    throw new PrivateDocumentRepositoryError("unavailable");
  }

  const documents = new Map<
    string,
    Omit<PrivateDocumentRecord, "versions"> & {
      versions: PrivateDocumentVersionMetadata[];
    }
  >();
  for (const row of rows) {
    let document = documents.get(row.documentId);
    if (!document) {
      document = {
        documentId: row.documentId,
        caseId: row.caseId,
        leadId: row.leadId,
        personId: row.personId,
        displayName: row.displayName,
        email: row.email,
        phone: row.phone,
        caseStatus: databaseCaseStatus(row.caseStatus),
        createdAt: row.documentCreatedAt.toISOString(),
        updatedAt: row.documentUpdatedAt.toISOString(),
        versions: [],
      };
      documents.set(row.documentId, document);
    }
    document.versions.push(
      toMetadata({
        documentId: row.documentId,
        caseId: row.caseId,
        versionId: row.versionId,
        versionNumber: row.versionNumber,
        originalFilename: row.originalFilename,
        declaredMimeType: row.declaredMimeType,
        byteLength: row.byteLength,
        sha256: row.sha256,
        createdAt: row.versionCreatedAt,
      }),
    );
  }
  return [...documents.values()];
}

export async function listPrivateDocuments(input: Readonly<{
  actorRole: FixedRole;
}>): Promise<readonly PrivateDocumentQueueRow[]> {
  assertDocumentRole(input.actorRole, "documents.read");

  try {
    const rows = await getDatabase()
      .select({
        documentId: evoPrivateDocuments.id,
        caseId: evoStudentCases.id,
        leadId: evoLeads.id,
        personId: evoPeople.id,
        displayName: evoPeople.fullName,
        email: evoPeople.email,
        phone: evoPeople.phoneE164,
        caseStatus: evoStudentCases.status,
        documentCreatedAt: evoPrivateDocuments.createdAt,
        documentUpdatedAt: evoPrivateDocuments.updatedAt,
        versionId: evoPrivateDocumentVersions.id,
        versionNumber: evoPrivateDocumentVersions.versionNumber,
        originalFilename: evoPrivateDocumentVersions.originalFilename,
        declaredMimeType: evoPrivateDocumentVersions.declaredMimeType,
        byteLength: evoPrivateDocumentVersions.byteLength,
        sha256: evoPrivateDocumentVersions.sha256,
        versionCreatedAt: evoPrivateDocumentVersions.createdAt,
      })
      .from(evoPrivateDocuments)
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoPrivateDocuments.caseId),
      )
      .innerJoin(evoLeads, owningLeadJoin())
      .innerJoin(evoPeople, eq(evoPeople.id, evoStudentCases.personId))
      .innerJoin(
        evoPrivateDocumentVersions,
        eq(evoPrivateDocumentVersions.documentId, evoPrivateDocuments.id),
      )
      .where(
        and(
          eq(evoLeads.stage, "handed_off"),
          sql<boolean>`${evoPrivateDocumentVersions.versionNumber} = (
            select max(private_document_latest.version_number)
            from evo_private_document_versions as private_document_latest
            where private_document_latest.document_id = ${evoPrivateDocuments.id}
          )`,
        ),
      )
      .orderBy(
        desc(evoPrivateDocuments.updatedAt),
        desc(evoPrivateDocuments.id),
      );

    return rows.map((row) => ({
      documentId: row.documentId,
      caseId: row.caseId,
      leadId: row.leadId,
      personId: row.personId,
      displayName: row.displayName,
      email: row.email,
      phone: row.phone,
      caseStatus: databaseCaseStatus(row.caseStatus),
      createdAt: row.documentCreatedAt.toISOString(),
      updatedAt: row.documentUpdatedAt.toISOString(),
      latestVersion: toMetadata({
        documentId: row.documentId,
        caseId: row.caseId,
        versionId: row.versionId,
        versionNumber: row.versionNumber,
        originalFilename: row.originalFilename,
        declaredMimeType: row.declaredMimeType,
        byteLength: row.byteLength,
        sha256: row.sha256,
        createdAt: row.versionCreatedAt,
      }),
    }));
  } catch (error) {
    if (error instanceof PrivateDocumentRepositoryError) throw error;
    throw new PrivateDocumentRepositoryError("unavailable");
  }
}

export async function createPrivateDocument(input: Readonly<{
  actorRole: FixedRole;
  caseId: string;
  upload: StoredPrivateDocumentUpload;
}>): Promise<PrivateDocumentVersionMetadata> {
  const upload = requireStoredPrivateDocumentUpload(input.upload);

  try {
    const caseId = await assertPrivateDocumentCreateTargetWritable(input);

    const documentId = randomUUID();
    const versionId = randomUUID();
    const row = await getDatabase().transaction(async (transaction) => {
      const [studentCase] = await transaction
        .select({ id: evoStudentCases.id })
        .from(evoStudentCases)
        .innerJoin(evoLeads, owningLeadJoin())
        .where(
          and(
            eq(evoStudentCases.id, caseId),
            eq(evoStudentCases.status, "active"),
            eq(evoLeads.stage, "handed_off"),
          ),
        )
        .for("update")
        .limit(1);
      if (!studentCase) throw new PrivateDocumentRepositoryError("not_found");

      await transaction.insert(evoPrivateDocuments).values({
        id: documentId,
        caseId,
        createdByRole: input.actorRole,
      });
      const [version] = await transaction
        .insert(evoPrivateDocumentVersions)
        .values({
          id: versionId,
          documentId,
          versionNumber: 1,
          objectKey: upload.objectKey,
          originalFilename: upload.originalFilename,
          declaredMimeType: upload.declaredMimeType,
          byteLength: upload.byteLength,
          sha256: upload.sha256,
          createdByRole: input.actorRole,
        })
        .returning({
          versionNumber: evoPrivateDocumentVersions.versionNumber,
          originalFilename: evoPrivateDocumentVersions.originalFilename,
          declaredMimeType: evoPrivateDocumentVersions.declaredMimeType,
          byteLength: evoPrivateDocumentVersions.byteLength,
          sha256: evoPrivateDocumentVersions.sha256,
          createdAt: evoPrivateDocumentVersions.createdAt,
        });
      if (!version) throw new PrivateDocumentRepositoryError("unavailable");
      return version;
    });

    return toMetadata({ documentId, caseId, versionId, ...row });
  } catch (error) {
    await cleanupUncommittedObject(upload.objectKey);
    if (error instanceof PrivateDocumentRepositoryError) throw error;
    throw new PrivateDocumentRepositoryError("unavailable");
  }
}

export async function resubmitPrivateDocument(input: Readonly<{
  actorRole: FixedRole;
  documentId: string;
  upload: StoredPrivateDocumentUpload;
}>): Promise<PrivateDocumentVersionMetadata> {
  const upload = requireStoredPrivateDocumentUpload(input.upload);

  try {
    const documentId = await assertPrivateDocumentResubmitTargetWritable(input);

    const versionId = randomUUID();
    const row = await getDatabase().transaction(async (transaction) => {
      const [document] = await transaction
        .select({
          id: evoPrivateDocuments.id,
          caseId: evoPrivateDocuments.caseId,
        })
        .from(evoPrivateDocuments)
        .innerJoin(
          evoStudentCases,
          eq(evoStudentCases.id, evoPrivateDocuments.caseId),
        )
        .innerJoin(evoLeads, owningLeadJoin())
        .where(
          and(
            eq(evoPrivateDocuments.id, documentId),
            eq(evoStudentCases.status, "active"),
            eq(evoLeads.stage, "handed_off"),
          ),
        )
        .for("update")
        .limit(1);
      if (!document) throw new PrivateDocumentRepositoryError("not_found");

      const [latest] = await transaction
        .select({ versionNumber: max(evoPrivateDocumentVersions.versionNumber) })
        .from(evoPrivateDocumentVersions)
        .where(eq(evoPrivateDocumentVersions.documentId, documentId));
      const latestVersion = Number(latest?.versionNumber ?? 0);
      if (!Number.isSafeInteger(latestVersion) || latestVersion < 1) {
        throw new PrivateDocumentRepositoryError("unavailable");
      }

      const [version] = await transaction
        .insert(evoPrivateDocumentVersions)
        .values({
          id: versionId,
          documentId,
          versionNumber: latestVersion + 1,
          objectKey: upload.objectKey,
          originalFilename: upload.originalFilename,
          declaredMimeType: upload.declaredMimeType,
          byteLength: upload.byteLength,
          sha256: upload.sha256,
          createdByRole: input.actorRole,
        })
        .returning({
          versionNumber: evoPrivateDocumentVersions.versionNumber,
          originalFilename: evoPrivateDocumentVersions.originalFilename,
          declaredMimeType: evoPrivateDocumentVersions.declaredMimeType,
          byteLength: evoPrivateDocumentVersions.byteLength,
          sha256: evoPrivateDocumentVersions.sha256,
          createdAt: evoPrivateDocumentVersions.createdAt,
        });
      if (!version) throw new PrivateDocumentRepositoryError("unavailable");

      await transaction
        .update(evoPrivateDocuments)
        .set({ updatedAt: new Date() })
        .where(eq(evoPrivateDocuments.id, documentId));

      return { caseId: document.caseId, ...version };
    });

    return toMetadata({ documentId, versionId, ...row });
  } catch (error) {
    await cleanupUncommittedObject(upload.objectKey);
    if (error instanceof PrivateDocumentRepositoryError) throw error;
    throw new PrivateDocumentRepositoryError("unavailable");
  }
}

export async function downloadPrivateDocumentVersion(input: Readonly<{
  actorRole: FixedRole;
  versionId: string;
}>): Promise<PrivateDocumentDownload> {
  assertDocumentRole(input.actorRole, "documents.read");
  const versionId = parseUuid(input.versionId);
  if (!versionId) throw new PrivateDocumentRepositoryError("invalid_input");

  let row;
  try {
    [row] = await getDatabase()
      .select({
        documentId: evoPrivateDocuments.id,
        caseId: evoPrivateDocuments.caseId,
        versionNumber: evoPrivateDocumentVersions.versionNumber,
        objectKey: evoPrivateDocumentVersions.objectKey,
        originalFilename: evoPrivateDocumentVersions.originalFilename,
        declaredMimeType: evoPrivateDocumentVersions.declaredMimeType,
        byteLength: evoPrivateDocumentVersions.byteLength,
        sha256: evoPrivateDocumentVersions.sha256,
        createdAt: evoPrivateDocumentVersions.createdAt,
      })
      .from(evoPrivateDocumentVersions)
      .innerJoin(
        evoPrivateDocuments,
        eq(evoPrivateDocuments.id, evoPrivateDocumentVersions.documentId),
      )
      .innerJoin(
        evoStudentCases,
        eq(evoStudentCases.id, evoPrivateDocuments.caseId),
      )
      .innerJoin(evoLeads, owningLeadJoin())
      .where(
        and(
          eq(evoPrivateDocumentVersions.id, versionId),
          eq(evoLeads.stage, "handed_off"),
        ),
      )
      .limit(1);
  } catch {
    throw new PrivateDocumentRepositoryError("unavailable");
  }
  if (!row) throw new PrivateDocumentRepositoryError("not_found");

  const bytes = await readPrivateDocumentObject({
    objectKey: row.objectKey,
    expectedByteLength: row.byteLength,
    expectedSha256: row.sha256,
  });
  return {
    metadata: toMetadata({ versionId, ...row }),
    bytes,
  };
}
