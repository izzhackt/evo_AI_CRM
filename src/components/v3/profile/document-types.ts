import type { DocumentPresence } from "@/lib/v3/wording";

type DocumentItemBase = Readonly<{
  /** Canonical platform.document_slots id; never shown to staff. */
  id: string;
  name: string;
  /** Server-generated idempotency key. null means uploads must fail closed. */
  uploadRequestId: string | null;
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

export type DocumentGroup = Readonly<{
  title: string;
  items: readonly DocumentItem[];
}>;

export type DocumentUploadAccess = "allowed" | "forbidden" | "closed";
