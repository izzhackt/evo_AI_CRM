import "server-only";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { KNOWLEDGE_UUID } from "@/lib/knowledge-library-contract";
import { KNOWLEDGE_CANONICAL_KINDS, type KnowledgeCanonicalKind, type KnowledgeCanonicalPage, type KnowledgeCanonicalResult } from "@/lib/knowledge-canonical-search-contract";
import { KnowledgeError, knowledgeRpcError, requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";

export async function searchKnowledgeCanonical(actor: ActivePlatformActor, url: URL): Promise<KnowledgeCanonicalPage> {
  requireKnowledgeAdmin(actor);
  const query = Object.fromEntries(url.searchParams);
  const limit = Number(query.limit ?? 50);
  if (!query.search?.trim() || query.search.trim().length > 240 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new KnowledgeError("knowledge_invalid", 400);
  const cursorPresent = [query.afterTitle, query.afterKind, query.afterId].some((value) => value !== undefined);
  if (cursorPresent && (typeof query.afterTitle !== "string" || query.afterTitle.length > 1024 || !KNOWLEDGE_CANONICAL_KINDS.includes(query.afterKind as KnowledgeCanonicalKind) || !KNOWLEDGE_UUID.test(query.afterId ?? ""))) throw new KnowledgeError("knowledge_invalid", 400);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("kb_search_canonical_v1", {
    p_organization_id: actor.organizationId, p_query: { ...query, search: query.search.trim(), limit },
  });
  if (error) knowledgeRpcError(error);
  if (!data || data.organizationId !== actor.organizationId || !Array.isArray(data.items) || typeof data.hasMore !== "boolean") throw new KnowledgeError("knowledge_response_invalid");
  const items: KnowledgeCanonicalResult[] = data.items.slice(0, limit).map((value: Record<string, unknown>) => {
    const { id, source_kind: kind, title, context, case_id: caseId, folder_id: folderId, updated_at: updatedAt } = value;
    if (typeof id !== "string" || !KNOWLEDGE_UUID.test(id) || !KNOWLEDGE_CANONICAL_KINDS.includes(kind as KnowledgeCanonicalKind)
      || typeof title !== "string" || typeof context !== "string" || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))
      || (caseId !== null && (typeof caseId !== "string" || !KNOWLEDGE_UUID.test(caseId)))
      || (folderId !== null && (typeof folderId !== "string" || !KNOWLEDGE_UUID.test(folderId)))
      || ((kind === "case" || kind === "document") && !caseId)) throw new KnowledgeError("knowledge_response_invalid");
    const href = kind === "document" || kind === "case" ? `/v3/knowledge?area=clients&case=${caseId}`
      : kind === "snippet" ? `/v3/knowledge?section=snippets#reply-snippet-${id}`
      : `/v3/knowledge?section=documents${folderId ? `&documentFolder=${folderId}` : ""}`;
    const downloadHref = kind === "document" ? `/api/v2/document-versions/${id}/download`
      : kind === "company" ? `/api/v3/company-file-versions/${id}/download` : null;
    return { id, kind: kind as KnowledgeCanonicalKind, title, context, href, downloadHref, updatedAt };
  });
  const last = items.at(-1);
  return { items, hasMore: data.hasMore, nextCursor: data.hasMore && last ? { id: last.id, kind: last.kind, title: last.title } : null };
}
