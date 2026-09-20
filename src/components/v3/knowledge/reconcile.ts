import type { KnowledgeImportPlan } from "@/lib/knowledge-import-contract";
import { knowledgeFetch } from "./client";
type Stored = { id: string; sourceKey: string; area: string; sha256: string; byteSize: number; blobId: string; blobReady: boolean; version: number; archived: boolean; trashed: boolean };
export async function reconcileKnowledgeImport(plan: KnowledgeImportPlan, progress: (done: number) => void) {
  const rows = []; const material = plan.entries.filter((e) => e.action !== "retain_outside_crm");
  const blobs = new Set<string>(); let reused = 0;
  for (let offset = 0; offset < material.length; offset += 200) {
    const batch = material.slice(offset, offset + 200);
    const stored = await knowledgeFetch<Stored[]>("source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: batch.map((e) => e.sourceKey) }) });
    const byKey = new Map(stored.map((e) => [e.sourceKey, e]));
    for (const entry of batch) {
      const item = byKey.get(entry.sourceKey!);
      const status = !item ? "missing" : item.sha256 !== entry.sha256 || item.byteSize !== entry.bytes || item.area !== entry.area || !item.blobReady ? "mismatch" : "verified";
      if (status === "verified" && item) { if (blobs.has(item.blobId)) reused++; blobs.add(item.blobId); }
      rows.push({ relativePath: entry.relativePath, sourceKey: entry.sourceKey, expectedSha256: entry.sha256, expectedBytes: entry.bytes, status, item: item ?? null });
    }
    progress(rows.length);
  }
  return { format: 1, checkedAt: new Date().toISOString(), inventorySha256: plan.inventorySha256, sourceCount: plan.entries.length,
    verified: rows.filter((r) => r.status === "verified").length, missing: rows.filter((r) => r.status === "missing").length,
    mismatched: rows.filter((r) => r.status === "mismatch").length, uniqueBlobs: blobs.size, reusedSourceLocations: reused,
    retainedOutside: plan.entries.filter((e) => e.action === "retain_outside_crm").map((e) => ({ relativePath: e.relativePath, reason: e.reason })), rows };
}
