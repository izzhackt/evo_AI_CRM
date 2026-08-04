import { createHash } from "node:crypto";

export function deriveCatalogSourceRecordKey(
  organizationId: string,
  sourceRecordReference: string,
): string {
  return `rec_${createHash("sha256")
    .update([organizationId, sourceRecordReference].join("\u001f"))
    .digest("hex")}`;
}
