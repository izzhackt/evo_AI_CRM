import "server-only";

import {
  listPlatformStudentCases,
  type PlatformAdmissionsCursor,
} from "@/lib/platform-admissions";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  listPlatformCompanyKnowledgeFiles,
  listPlatformCompanyKnowledgeFolders,
} from "@/lib/platform-company-knowledge";
import { listPlatformDocumentQueue } from "@/lib/platform-private-documents";
import { ORG_TIMEZONE } from "@/lib/v3/period";

export type KnowledgeStudent = Readonly<{
  id: string;
  name: string;
}>;

export type KnowledgeDocument = Readonly<{
  versionId: string;
  caseId: string;
  name: string;
  size: string;
  addedAt: string;
}>;

export type KnowledgeCompanyFolder = Readonly<{
  id: string;
  parentId: string | null;
  name: string;
  version: number;
}>;

export type KnowledgeCompanyFile = Readonly<{
  id: string;
  folderId: string | null;
  name: string;
  version: number;
  currentVersionId: string;
  size: string;
  addedAt: string;
}>;

export type KnowledgeCompanyWorkspace = Readonly<{
  folders: readonly KnowledgeCompanyFolder[];
  files: readonly KnowledgeCompanyFile[];
}>;

const PAGE_SIZE = 100;
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", {
  timeZone: ORG_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
});

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} КБ`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Real handed-off cases visible to the actor; each becomes one student folder. */
export async function readKnowledgeStudents(
  actor: ActivePlatformActor,
): Promise<readonly KnowledgeStudent[]> {
  const students: KnowledgeStudent[] = [];
  let cursor: PlatformAdmissionsCursor | null = null;

  do {
    const page = await listPlatformStudentCases(actor, {
      cursor,
      pageSize: PAGE_SIZE,
    });

    for (const item of page.rows) {
      if (item.access !== "full") {
        throw new Error("V3 knowledge received a non-Admissions case projection.");
      }
      if (
        item.studentCase.handoffAt !== null &&
        (item.studentCase.state === "active" || item.studentCase.state === "closed")
      ) {
        students.push({
          id: item.studentCase.studentCaseId,
          name: item.studentCase.studentDisplayName,
        });
      }
    }

    if (!page.hasNext) break;
    if (page.nextCursor === null) {
      throw new Error("V3 knowledge case pagination is unavailable.");
    }
    cursor = page.nextCursor;
  } while (true);

  return students.toSorted((left, right) =>
    left.name.localeCompare(right.name, "ru"));
}

/** Finalized private document versions exposed by the canonical queue. */
export async function readKnowledgeDocuments(
  actor: ActivePlatformActor,
): Promise<readonly KnowledgeDocument[]> {
  const queue = await listPlatformDocumentQueue(actor, PAGE_SIZE);
  if (queue.hasMore) {
    throw new Error("V3 knowledge document queue exceeds its canonical read window.");
  }

  return queue.rows.flatMap((row) => {
    if (
      row.currentVersionId === null ||
      row.currentOriginalFilename === null ||
      row.currentByteSize === null ||
      row.currentVersionFinalizedAt === null
    ) {
      return [];
    }

    return [{
      versionId: row.currentVersionId,
      caseId: row.studentCaseId,
      name: row.currentOriginalFilename,
      size: humanSize(row.currentByteSize),
      addedAt: DAY_MONTH.format(new Date(row.currentVersionFinalizedAt)),
    } satisfies KnowledgeDocument];
  });
}

/**
 * Canonical company folders and immutable current file versions.
 * Student case documents deliberately remain in their existing authority.
 */
export async function readCompanyKnowledge(
  actor: ActivePlatformActor,
): Promise<KnowledgeCompanyWorkspace> {
  const [folders, files] = await Promise.all([
    listPlatformCompanyKnowledgeFolders(actor),
    listPlatformCompanyKnowledgeFiles(actor),
  ]);
  const folderIds = new Set(folders.map((folder) => folder.folderId));
  const parentByFolderId = new Map(
    folders.map((folder) => [folder.folderId, folder.parentFolderId] as const),
  );

  for (const folder of folders) {
    if (
      folder.parentFolderId !== null
      && !folderIds.has(folder.parentFolderId)
    ) {
      throw new Error("V3 company knowledge received an orphan folder.");
    }
    const visited = new Set([folder.folderId]);
    let parentId = folder.parentFolderId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        throw new Error("V3 company knowledge received a folder cycle.");
      }
      visited.add(parentId);
      parentId = parentByFolderId.get(parentId) ?? null;
    }
  }
  for (const file of files) {
    if (file.folderId !== null && !folderIds.has(file.folderId)) {
      throw new Error("V3 company knowledge received an orphan file.");
    }
  }

  return {
    folders: folders.map((folder) => ({
      id: folder.folderId,
      parentId: folder.parentFolderId,
      name: folder.name,
      version: folder.version,
    })),
    files: files.map((file) => ({
      id: file.fileId,
      folderId: file.folderId,
      name: file.name,
      version: file.version,
      currentVersionId: file.currentFileVersionId,
      size: humanSize(file.byteSize),
      addedAt: DAY_MONTH.format(new Date(file.currentVersionCreatedAt)),
    })),
  };
}
