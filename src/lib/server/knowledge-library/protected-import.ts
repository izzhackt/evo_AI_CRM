import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { KNOWLEDGE_SHA256, KNOWLEDGE_UUID, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import { KnowledgeError, knowledgeQuery, requireKnowledgeAdmin, runKnowledgeCommand } from "@/lib/v3/knowledge-library-source";
import { sops, saveKnowledgeSecret } from "./secrets";
import { persistKnowledgeCiphertext } from "./storage";

type ProtectedEnvelope = { format: 1; kind: "file"; sourceKey: string; nodeId: string; title: string; relativePath: string; sha256: string; byteSize: number; data: string };
export async function importKnowledgeProtected(actor: ActivePlatformActor, payload: Record<string, unknown>) {
  requireKnowledgeAdmin(actor);
  if (typeof payload.ciphertext !== "string" || typeof payload.id !== "string" || !KNOWLEDGE_UUID.test(payload.id)
    || (payload.parentId != null && (typeof payload.parentId !== "string" || !KNOWLEDGE_UUID.test(payload.parentId)))) throw new KnowledgeError("knowledge_invalid", 400);
  const cipher = Buffer.from(payload.ciphertext);
  const plaintext = await sops("decrypt", cipher, 40 * 1024 * 1024);
  try {
    const envelope = JSON.parse(plaintext.toString("utf8"));
    if (envelope.format !== 1 || envelope.nodeId !== payload.id) throw new KnowledgeError("knowledge_invalid", 400);
    if (envelope.kind === "record") {
      return { item: await saveKnowledgeSecret(actor, { id: envelope.nodeId, requestId: envelope.nodeId,
        expectedVersion: 0, parentId: payload.parentId ?? null, fields: envelope.fields, keepValue: false }) };
    }
    const value = envelope as ProtectedEnvelope;
    if (value.kind !== "file" || !KNOWLEDGE_SHA256.test(value.sha256) || !KNOWLEDGE_SHA256.test(value.sourceKey)
      || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0 || value.byteSize > 25 * 1024 * 1024
      || typeof value.data !== "string" || /[^A-Za-z0-9+/=]/.test(value.data)
      || typeof value.title !== "string" || value.title.length > 225
      || typeof value.relativePath !== "string" || value.relativePath.length > 4000) throw new KnowledgeError("knowledge_invalid", 400);
    const original = Buffer.from(value.data, "base64");
    try {
      if (original.toString("base64") !== value.data || original.length !== value.byteSize || createHash("sha256").update(original).digest("hex") !== value.sha256) throw new KnowledgeError("knowledge_integrity_failed");
    } finally { original.fill(0); }
    const existing = await knowledgeQuery(actor, { mode: "source", key: value.sourceKey }) as KnowledgeItem | null;
    if (existing) {
      if (existing.area !== "secrets" || existing.source?.sha256 !== value.sha256 || existing.source?.byteSize !== value.byteSize) throw new KnowledgeError("knowledge_request_conflict", 409);
      return { item: existing, reused: true };
    }
    const blob = await persistKnowledgeCiphertext(actor, cipher);
    const item = await runKnowledgeCommand(actor, randomUUID(), { op: "create", id: value.nodeId, area: "secrets", kind: "file",
      parentId: payload.parentId ?? null, title: `${value.title}.enc.json`, mimeType: "application/json", blobId: blob.id, sourceKey: value.sourceKey,
      source: { format: "sops-original-v1", relativePath: value.relativePath, originalFilename: value.title, sha256: value.sha256, byteSize: value.byteSize } });
    return { item, reused: false };
  } finally { plaintext.fill(0); }
}
