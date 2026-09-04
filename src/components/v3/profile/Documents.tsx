import { randomUUID } from "node:crypto";

import { Pill } from "@/components/v3/Pill";

import { Card } from "./Card";
import type {
  ActiveDocumentGroup,
  DocumentGroup,
  DocumentUploadAccess,
  RemovedDocumentGroup,
} from "./document-types";
import { ProfileDocumentsClient } from "./ProfileDocumentsClient";

/**
 * Server-backed projection of the canonical checklist and current private file.
 * The client child only reports success after the canonical route confirms the
 * Supabase Storage write; refreshing the route remains the read authority.
 */
export function Documents({
  groups,
  uploadAccess,
  studentCaseId,
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
  studentCaseId: string | null;
}>) {
  const activeGroups = groups.filter(
    (group): group is ActiveDocumentGroup => group.kind === "active",
  );
  const historyGroups = groups.filter(
    (group): group is RemovedDocumentGroup => group.kind === "removed",
  );
  const total = activeGroups.reduce((count, group) => count + group.items.length, 0);
  const present = activeGroups.reduce(
    (count, group) => count + group.items.filter((item) => item.presence === "present").length,
    0,
  );
  const createRequestId = uploadAccess === "allowed" && studentCaseId
    ? randomUUID()
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Чеклист" aside={<Pill>{present}/{total}</Pill>}>
        <ProfileDocumentsClient
          groups={activeGroups}
          historyGroups={historyGroups}
          uploadAccess={uploadAccess}
          studentCaseId={studentCaseId}
          createRequestId={createRequestId}
        />
      </Card>
    </div>
  );
}
