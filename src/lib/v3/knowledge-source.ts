import "server-only";

import {
  listPlatformStudentCases,
  type PlatformAdmissionsCursor,
} from "@/lib/platform-admissions";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { listPlatformDocumentQueue } from "@/lib/platform-private-documents";
import { ORG_TIMEZONE } from "@/lib/v3/period";

export type KnowledgeStudent = Readonly<{
  id: string;
  name: string;
}>;

export type KnowledgeDocument = Readonly<{
  id: string;
  caseId: string;
  name: string;
  size: string;
  addedAt: string;
  addedBy: string | null;
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
      id: row.documentSlotId,
      caseId: row.studentCaseId,
      name: row.currentOriginalFilename,
      size: humanSize(row.currentByteSize),
      addedAt: DAY_MONTH.format(new Date(row.currentVersionFinalizedAt)),
      // The queue does not expose a creator identity or role. Do not invent one.
      addedBy: null,
    } satisfies KnowledgeDocument];
  });
}
