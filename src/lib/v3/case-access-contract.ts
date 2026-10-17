export type CaseSectionAccess = Readonly<{
  documents: boolean;
  finance: boolean;
  studentProfile: boolean;
  contract: boolean;
}>;

/** This case-bound read projection never authorizes a subsequent mutation. */
export function parseCaseSectionAccess(value: unknown, organizationId: string, studentCaseId: string): CaseSectionAccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("case_access_unavailable");
  const row = value as Record<string, unknown>;
  const keys = ["organizationId", "studentCaseId", "documents", "finance", "studentProfile", "contract", "handoff", "applications", "visa"];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))
    || row.organizationId !== organizationId || row.studentCaseId !== studentCaseId
    || row.handoff !== true || row.applications !== true || row.visa !== true
    || typeof row.documents !== "boolean" || typeof row.finance !== "boolean"
    || typeof row.studentProfile !== "boolean" || typeof row.contract !== "boolean") throw new Error("case_access_unavailable");
  return { documents: row.documents, finance: row.finance, studentProfile: row.studentProfile, contract: row.contract };
}

/**
 * The document workspace (113, `staff_student_case_document_workspace`) reads only a case in
 * work: `active` or `closed`, with its curator's handoff. A case «Ждёт куратора» (`pending`) has
 * no checklist yet and the database answers that read 42501 to everyone, the Admin included,
 * while the access snapshot (156), which checks the permission and not the state, still says
 * `documents: true`. Such a section is not read and not promised. This only narrows what the
 * snapshot said: no permission is granted, and for `active` and `closed` the snapshot stands, so
 * a refusal of the workspace read there stays an error.
 */
export function caseSectionAccessForState(
  access: CaseSectionAccess,
  state: "pending" | "active" | "closed",
): CaseSectionAccess {
  return state === "pending" && access.documents ? { ...access, documents: false } : access;
}

/** Preserve unavailable sections as null; an authorized reader failure must propagate. */
export async function readCaseProfileSections<TFinance, TProfile, TDocuments, TContract>(
  access: CaseSectionAccess,
  readers: Readonly<{
    finance: () => Promise<TFinance>;
    studentProfile: () => Promise<TProfile>;
    documents: () => Promise<TDocuments>;
    contract: () => Promise<TContract>;
  }>,
) {
  const [finance, studentProfile, documents, contract] = await Promise.all([
    access.finance ? readers.finance() : null,
    access.studentProfile ? readers.studentProfile() : null,
    access.documents ? readers.documents() : null,
    access.contract ? readers.contract() : null,
  ]);
  return { access, finance, studentProfile, documents, contract };
}
