import { randomUUID } from "node:crypto";

import { Pill } from "@/components/v3/Pill";

import { Card } from "./Card";
import type { DocumentGroup, DocumentUploadAccess } from "./document-types";
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
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const present = groups.reduce(
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
          groups={groups}
          uploadAccess={uploadAccess}
          studentCaseId={studentCaseId}
          createRequestId={createRequestId}
        />
      </Card>
    </div>
  );
}
