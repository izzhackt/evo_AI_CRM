import type { DocumentPresence } from "@/lib/v3/wording";

type DocumentItemBase = Readonly<{
  /** Canonical platform.document_slots id; never shown to staff. */
  id: string;
  name: string;
  /** Server-generated idempotency key. null means uploads must fail closed. */
  uploadRequestId: string | null;
  /** Server-generated command ids; null means metadata writes must fail closed. */
  metadataRequestId: string | null;
  removalRequestId: string | null;
  groupLabel: string;
  intentKind: "baseline" | "custom";
  version: number;
}>;

export type AbsentDocumentItem = DocumentItemBase & Readonly<{
  presence: Extract<DocumentPresence, "absent">;
  currentVersionId: null;
  downloadReady: false;
}>;

export type PresentDocumentItem = DocumentItemBase & Readonly<{
  presence: Extract<DocumentPresence, "present">;
  /** The current canonical platform.document_versions id. */
  currentVersionId: string;
  currentVersionNumber: number;
  currentFilename: string;
  /** True only after the server confirms private-Storage download readiness. */
  downloadReady: boolean;
}>;

/**
 * The union prevents an absent document from accidentally receiving a download
 * link and prevents a present document from existing without a canonical
 * current version.
 */
export type DocumentItem = AbsentDocumentItem | PresentDocumentItem;

export type ActiveDocumentGroup = Readonly<{
  kind: "active";
  title: string;
  items: readonly DocumentItem[];
}>;

export type RemovedDocumentVersion = Readonly<{
  /** Canonical platform.document_versions id. */
  id: string;
  versionNumber: number;
  filename: string;
  submittedBy: string;
  submittedAt: string;
  /** True only after canonical private Storage confirms safe download. */
  downloadReady: boolean;
}>;

/**
 * Read-only projection of a removed case-local checklist item. It intentionally
 * has no upload, metadata, removal or other command request identifiers.
 */
export type RemovedDocumentItem = Readonly<{
  id: string;
  name: string;
  groupLabel: string;
  intentKind: "baseline" | "custom";
  removedAt: string;
  removalReason: string;
  versions: readonly RemovedDocumentVersion[];
}>;

export type RemovedDocumentGroup = Readonly<{
  kind: "removed";
  title: string;
  items: readonly RemovedDocumentItem[];
}>;

export type DocumentGroup = ActiveDocumentGroup | RemovedDocumentGroup;

export type DocumentUploadAccess = "allowed" | "forbidden" | "closed";
