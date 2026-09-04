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
}: Readonly<{
  groups: readonly DocumentGroup[];
  uploadAccess: DocumentUploadAccess;
}>) {
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const present = groups.reduce(
    (count, group) => count + group.items.filter((item) => item.presence === "present").length,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="Чеклист" aside={<Pill>{present}/{total}</Pill>}>
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-3">
            Для этого дела требования к документам ещё не назначены.
          </p>
        ) : (
          <ProfileDocumentsClient groups={groups} uploadAccess={uploadAccess} />
        )}
      </Card>
    </div>
  );
}
