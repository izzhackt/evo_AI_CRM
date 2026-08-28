import "server-only";

import { randomUUID } from "node:crypto";

import { eq, max } from "drizzle-orm";

import {
  evoPrivateDocuments,
  evoPrivateDocumentVersions,
} from "../../db/schema/index.ts";
import { fixedRoleCan, type FixedRole } from "../fixed-role-policy.ts";
import { getDatabase } from "./database.ts";
import {
  preparePrivateDocumentFile,
  readPrivateDocumentObject,
  removePrivateDocumentObject,
  writePrivateDocumentObject,
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

export async function createPrivateDocument(input: Readonly<{
  actorRole: FixedRole;
  caseId: string;
  originalFilename: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}>): Promise<PrivateDocumentVersionMetadata> {
  assertDocumentRole(input.actorRole, "documents.write");
  const caseId = parseUuid(input.caseId);
  if (!caseId) throw new PrivateDocumentRepositoryError("invalid_input");

  const prepared = preparePrivateDocumentFile({
    originalFilename: input.originalFilename,
    declaredMimeType: input.declaredMimeType,
    bytes: input.bytes,
  });
  const stored = await writePrivateDocumentObject(prepared);
  const documentId = randomUUID();
  const versionId = randomUUID();

  try {
    const row = await getDatabase().transaction(async (transaction) => {
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
          objectKey: stored.objectKey,
          originalFilename: prepared.originalFilename,
          declaredMimeType: prepared.declaredMimeType,
          byteLength: stored.byteLength,
          sha256: stored.sha256,
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
    await cleanupUncommittedObject(stored.objectKey);
    if (error instanceof PrivateDocumentRepositoryError) throw error;
    throw new PrivateDocumentRepositoryError("unavailable");
  }
}

export async function resubmitPrivateDocument(input: Readonly<{
  actorRole: FixedRole;
  documentId: string;
  originalFilename: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}>): Promise<PrivateDocumentVersionMetadata> {
  assertDocumentRole(input.actorRole, "documents.write");
  const documentId = parseUuid(input.documentId);
  if (!documentId) throw new PrivateDocumentRepositoryError("invalid_input");

  const [existing] = await getDatabase()
    .select({ id: evoPrivateDocuments.id })
    .from(evoPrivateDocuments)
    .where(eq(evoPrivateDocuments.id, documentId))
    .limit(1);
  if (!existing) throw new PrivateDocumentRepositoryError("not_found");

  const prepared = preparePrivateDocumentFile({
    originalFilename: input.originalFilename,
    declaredMimeType: input.declaredMimeType,
    bytes: input.bytes,
  });
  const stored = await writePrivateDocumentObject(prepared);
  const versionId = randomUUID();

  try {
    const row = await getDatabase().transaction(async (transaction) => {
      const [document] = await transaction
        .select({
          id: evoPrivateDocuments.id,
          caseId: evoPrivateDocuments.caseId,
        })
        .from(evoPrivateDocuments)
        .where(eq(evoPrivateDocuments.id, documentId))
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
          objectKey: stored.objectKey,
          originalFilename: prepared.originalFilename,
          declaredMimeType: prepared.declaredMimeType,
          byteLength: stored.byteLength,
          sha256: stored.sha256,
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
    await cleanupUncommittedObject(stored.objectKey);
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
      .where(eq(evoPrivateDocumentVersions.id, versionId))
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
