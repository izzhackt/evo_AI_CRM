import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  KNOWLEDGE_AREAS, KNOWLEDGE_PART_SIZE, KNOWLEDGE_SHA256, KNOWLEDGE_UUID,
  type KnowledgeBlob, type KnowledgeCommand, type KnowledgeItem, type KnowledgePage,
  type KnowledgeQuery, type KnowledgeVersion,
} from "@/lib/knowledge-library-contract";

export class KnowledgeError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code); }
}
export function requireKnowledgeAdmin(actor: ActivePlatformActor) {
  if (actor.systemRole !== "admin" || isStaffPreview(actor)) throw new KnowledgeError("knowledge_forbidden", 403);
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeError("knowledge_response_invalid");
  return value as Record<string, unknown>;
}
function checkedItem(value: unknown, organizationId: string): KnowledgeItem {
  const item = row(value);
  if (typeof item.id !== "string" || !KNOWLEDGE_UUID.test(item.id) || item.organization_id !== organizationId
    || !KNOWLEDGE_AREAS.includes(item.area as never) || !["folder", "page", "file", "secret"].includes(String(item.kind))
    || typeof item.title !== "string" || typeof item.version !== "number" || !Number.isSafeInteger(item.version)
    || item.version < 1 || (item.body !== undefined && typeof item.body !== "string")) {
    throw new KnowledgeError("knowledge_response_invalid");
  }
  return item as KnowledgeItem;
}
export function checkedBlob(value: unknown, organizationId: string): KnowledgeBlob {
  const blob = row(value);
  if (typeof blob.id !== "string" || !KNOWLEDGE_UUID.test(blob.id) || blob.organization_id !== organizationId
    || !KNOWLEDGE_AREAS.includes(blob.area as never) || typeof blob.sha256 !== "string" || !KNOWLEDGE_SHA256.test(blob.sha256)
    || typeof blob.byte_size !== "number" || !Number.isSafeInteger(blob.byte_size) || blob.byte_size < 0
    || blob.part_size !== KNOWLEDGE_PART_SIZE || !["uploading", "ready"].includes(String(blob.state))) {
    throw new KnowledgeError("knowledge_response_invalid");
  }
  if (blob.parts !== undefined && (!Array.isArray(blob.parts) || blob.parts.some((v) => {
    const p = row(v);
    return !Number.isSafeInteger(p.part_index) || Number(p.part_index) < 0 || !Number.isSafeInteger(p.byte_size)
      || Number(p.byte_size) < 1 || Number(p.byte_size) > KNOWLEDGE_PART_SIZE
      || typeof p.sha256 !== "string" || !KNOWLEDGE_SHA256.test(p.sha256);
  }))) throw new KnowledgeError("knowledge_response_invalid");
  return blob as KnowledgeBlob;
}
export function knowledgeRpcError(error: { code?: string; message?: string }): never {
  const allowed = /^knowledge_[a-z_]+$/;
  const code = error.message && allowed.test(error.message) ? error.message : "knowledge_unavailable";
  const status = error.code === "42501" ? 403 : error.code === "PT409" ? 409
    : error.code === "P0002" ? 404 : ["22023", "22P02", "23514", "23503"].includes(error.code ?? "") ? 400 : 503;
  throw new KnowledgeError(code, status);
}
export async function knowledgeQuery(actor: ActivePlatformActor, query: Record<string, unknown>, suppliedClient?: SupabaseClient): Promise<unknown> {
  requireKnowledgeAdmin(actor);
  const client = suppliedClient ?? await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("kb_query_v1", { p_organization_id: actor.organizationId, p_query: query });
  if (error) knowledgeRpcError(error);
  return data;
}
export async function readKnowledgePage(actor: ActivePlatformActor, query: KnowledgeQuery = {}): Promise<KnowledgePage> {
  const result = row(await knowledgeQuery(actor, query));
  if (!Array.isArray(result.items) || typeof result.hasMore !== "boolean") throw new KnowledgeError("knowledge_response_invalid");
  const limit = Math.min(200, Math.max(1, query.limit ?? 100));
  const items = result.items.slice(0, limit).map((item) => checkedItem(item, actor.organizationId));
  const last = items.at(-1);
  return { items, hasMore: result.hasMore, nextCursor: result.hasMore && last ? { title: last.title, id: last.id } : null };
}
export async function readKnowledgeItem(actor: ActivePlatformActor, id: string): Promise<KnowledgeItem> {
  if (!KNOWLEDGE_UUID.test(id)) throw new KnowledgeError("knowledge_not_found", 404);
  return checkedItem(await knowledgeQuery(actor, { mode: "item", id }), actor.organizationId);
}
export async function readKnowledgeHistory(actor: ActivePlatformActor, id: string, beforeVersion?: number) {
  const result = row(await knowledgeQuery(actor, { mode: "history", id, beforeVersion, limit: 50 }));
  if (!Array.isArray(result.items) || typeof result.hasMore !== "boolean") throw new KnowledgeError("knowledge_response_invalid");
  const items = result.items.slice(0, 50).map((value) => {
    const version = row(value);
    return { ...version, snapshot: checkedItem(version.snapshot, actor.organizationId) } as KnowledgeVersion;
  });
  return { items, hasMore: result.hasMore };
}
export async function readKnowledgeBlob(actor: ActivePlatformActor, id: string, client?: SupabaseClient): Promise<KnowledgeBlob> {
  return checkedBlob(await knowledgeQuery(actor, { mode: "blob", id }, client), actor.organizationId);
}
export async function runKnowledgeCommand(actor: ActivePlatformActor, requestId: string, command: KnowledgeCommand, suppliedClient?: SupabaseClient) {
  requireKnowledgeAdmin(actor);
  if (!KNOWLEDGE_UUID.test(requestId)) throw new KnowledgeError("knowledge_invalid", 400);
  const client = suppliedClient ?? await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("kb_command_v1", {
    p_organization_id: actor.organizationId, p_request_id: requestId, p_command: command,
  });
  if (error) knowledgeRpcError(error);
  return command.op === "reserve_blob" ? checkedBlob(data, actor.organizationId) : checkedItem(data, actor.organizationId);
}
