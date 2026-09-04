import "server-only";

import {
  listPlatformStudentCases,
  type PlatformAdmissionsCursor,
} from "@/lib/platform-admissions";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformCompanyFileWorkspace } from "@/lib/platform-company-files";
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

export type KnowledgeDocumentWorkspace = Readonly<{
  documents: readonly KnowledgeDocument[];
  complete: boolean;
}>;

export type KnowledgeCompanyFolder = Readonly<{
  id: string;
  parentId: string | null;
  name: string;
  version: string;
}>;

export type KnowledgeCompanyFile = Readonly<{
  id: string;
  folderId: string | null;
  name: string;
  version: string;
  currentVersionId: string | null;
  size: string | null;
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
): Promise<KnowledgeDocumentWorkspace> {
  const queue = await listPlatformDocumentQueue(actor, PAGE_SIZE);
  if (queue.hasMore) {
    return { documents: [], complete: false };
  }

  const documents = queue.rows.flatMap((row) => {
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
  return { documents, complete: true };
}

/**
 * Canonical company folders and immutable current file versions.
 * Student case documents deliberately remain in their existing authority.
 */
export async function readCompanyKnowledge(
  actor: ActivePlatformActor,
): Promise<KnowledgeCompanyWorkspace> {
  const workspace = await getPlatformCompanyFileWorkspace(actor);

  return {
    folders: workspace.folders.map((folder) => ({
      id: folder.folderId,
      parentId: folder.parentFolderId,
      name: folder.name,
      version: folder.version,
    })),
    files: workspace.files.map((file) => ({
      id: file.companyFileId,
      folderId: file.folderId,
      name: file.displayName,
      version: file.version,
      currentVersionId: file.currentVersion?.companyFileVersionId ?? null,
      size: file.currentVersion === null
        ? null
        : humanSize(file.currentVersion.byteSize),
      addedAt: DAY_MONTH.format(new Date(
        file.currentVersion?.finalizedAt ?? file.updatedAt,
      )),
    })),
  };
}
