import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { KNOWLEDGE_PART_SIZE, knowledgeMessage, type KnowledgeArea, type KnowledgeBlob, type KnowledgeCommand, type KnowledgeItem } from "@/lib/knowledge-library-contract";
export class KnowledgeClientError extends Error {
  constructor(public code: string, public status: number) { super(knowledgeMessage(code)); }
}
export async function knowledgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v3/knowledge/${path}`, { ...init, cache: "no-store" });
  let data;
  try { data = await response.json(); } catch { throw new KnowledgeClientError("knowledge_unavailable", response.status); }
  if (!response.ok) throw new KnowledgeClientError(typeof data.error === "string" ? data.error : "knowledge_unavailable", response.status);
  return data as T;
}
const pendingCommands = new Map<string, string>();
let commandScope = "";
export function configureKnowledgeCommands(scope: string) { commandScope = scope; }
export async function command<T = KnowledgeItem>(value: KnowledgeCommand, requestId?: string) {
  if (!commandScope) throw new Error("Обновите страницу перед сохранением.");
  const key = `evo:knowledge-command:${commandScope}:${knowledgeSourceKey(value)}`;
  if (!requestId) {
    try { requestId = sessionStorage.getItem(key) ?? undefined; } catch { /* Storage may be disabled. */ }
    requestId ??= pendingCommands.get(key) ?? crypto.randomUUID();
    pendingCommands.set(key, requestId);
    try { sessionStorage.setItem(key, requestId); } catch { /* Retain the in-memory receipt key. */ }
  }
  const result = await knowledgeFetch<T>("command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, command: value }) });
  pendingCommands.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* No source content is stored here. */ }
  return result;
}
export const knowledgeSourceKey = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export async function uploadKnowledgeFile(file: File, area: KnowledgeArea, parentId: string | null, progress: (done: number, total: number) => void, caseId: string | null = null) {
  const digest = sha256.create();
  for (let offset = 0; offset < file.size; offset += KNOWLEDGE_PART_SIZE) {
    digest.update(new Uint8Array(await file.slice(offset, offset + KNOWLEDGE_PART_SIZE).arrayBuffer()));
  }
  const hash = bytesToHex(digest.digest());
  const reserved = await command<KnowledgeBlob>({ op: "reserve_blob", area, sha256: hash, byteSize: file.size });
  const blob = await knowledgeFetch<KnowledgeBlob>(`blob/${reserved.id}`);
  for (let offset = 0, index = 0; offset < file.size; offset += KNOWLEDGE_PART_SIZE, index++) {
    if (!blob.parts?.some((part) => part.part_index === index)) {
      await knowledgeFetch(`blob/${blob.id}/${index}`, { method: "POST", body: file.slice(offset, offset + KNOWLEDGE_PART_SIZE) });
    }
    progress(Math.min(file.size, offset + KNOWLEDGE_PART_SIZE), file.size);
  }
  await knowledgeFetch(`blob/${blob.id}/complete`, { method: "POST" });
  const sourceKey = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(["upload", area, parentId, file.name, hash]))));
  return command({ op: "create", kind: "file", area, parentId, caseId, title: file.name, blobId: blob.id,
    mimeType: file.type || "application/octet-stream", sourceKey,
    source: { originalFilename: file.name, sha256: hash, byteSize: file.size, uploadedAt: new Date().toISOString() },
  });
}
