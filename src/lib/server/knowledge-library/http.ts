import "server-only";
import { readKnowledgeDossier, readKnowledgeDossiers } from "./dossiers";
import { knowledgeSecretsStatus, readKnowledgeSecret, saveKnowledgeSecret } from "./secrets";
import { after } from "next/server";
import { buildKnowledgeExport, cleanupKnowledgeExports, knowledgeExportAction, knowledgeExportStream } from "./export";
import { resolvePlatformActor } from "@/lib/platform-auth";
import { PRODUCTION_STAFF_ORIGIN } from "@/lib/platform-public-origin";
import { KNOWLEDGE_PART_SIZE, KNOWLEDGE_UUID, type KnowledgeCommand, type KnowledgeQuery } from "@/lib/knowledge-library-contract";
import { KnowledgeError, knowledgeQuery, readKnowledgeBlob, readKnowledgeHistory, readKnowledgeItem, readKnowledgePage, requireKnowledgeAdmin, runKnowledgeCommand } from "@/lib/v3/knowledge-library-source";
import { completeKnowledgeBlob, knowledgeBlobStream, uploadKnowledgePart } from "./storage";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new KnowledgeError("knowledge_request_too_large", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new KnowledgeError("knowledge_request_too_large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function sameOrigin(request: Request) {
  const expected = process.env.NODE_ENV === "production" ? PRODUCTION_STAFF_ORIGIN : new URL(request.url).origin;
  if (request.headers.get("origin") !== expected) throw new KnowledgeError("knowledge_origin_forbidden", 403);
}
function json(value: unknown) { return Response.json(value, { headers: PRIVATE_HEADERS }); }
function contentDisposition(filename: string, inline = false) {
  const clean = filename.replace(/[\x00-\x1f\x7f/\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
}
export async function knowledgeHttp(request: Request, segments: string[]): Promise<Response> {
  try {
    const resolved = await resolvePlatformActor();
    if (resolved.status === "anonymous") throw new KnowledgeError("authentication_required", 401);
    if (resolved.status !== "authenticated") throw new KnowledgeError("knowledge_auth_unavailable", 503);
    const actor = resolved.actor;
    requireKnowledgeAdmin(actor);
    const [route, id, option] = segments;
    const url = new URL(request.url);
    if (request.method === "POST") sameOrigin(request);
    if (route === "source" && request.method === "GET" && id && /^[0-9a-f]{64}$/.test(id) && segments.length === 2) {
      return json(await knowledgeQuery(actor, { mode: "source", key: id }));
    }
    if (route === "secrets") {
      if (request.method === "GET" && id === "status") return json(await knowledgeSecretsStatus(actor));
      if (request.method === "GET" && id && KNOWLEDGE_UUID.test(id) && !option) return json(await readKnowledgeSecret(actor, id, false));
      if (request.method === "POST" && id && KNOWLEDGE_UUID.test(id) && option === "reveal") return json(await readKnowledgeSecret(actor, id, true));
      if (request.method === "POST" && !id) {
        const payload = JSON.parse(new TextDecoder().decode(await boundedBody(request, 100_000)));
        return json(await saveKnowledgeSecret(actor, payload));
      }
    }
    if (route === "clients" && request.method === "GET") {
      if (!id && segments.length === 1) return json(await readKnowledgeDossiers(actor, url));
      if (id && segments.length <= 3) return json(await readKnowledgeDossier(actor, id, option, url));
    }
    if (route === "exports") {
      if (request.method === "GET" && !id) {
        after(() => cleanupKnowledgeExports(actor.organizationId));
        return json(await knowledgeExportAction(actor, "list"));
      }
      if (request.method === "POST" && !id) {
        const value = JSON.parse(new TextDecoder().decode(await boundedBody(request, 65_536)));
        if (!KNOWLEDGE_UUID.test(value.requestId)) throw new KnowledgeError("knowledge_invalid", 400);
        const job = await knowledgeExportAction(actor, "start", value.requestId, value.options);
        if (job.state === "queued") after(() => buildKnowledgeExport(job.id));
        return json(job);
      }
      if (id && KNOWLEDGE_UUID.test(id)) {
        if (request.method === "GET" && option === "download") {
          const job = await knowledgeExportAction(actor, "download", id);
          return new Response(knowledgeExportStream(job), { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/zip",
            "Content-Length": String(job.written_bytes), "Content-Disposition": contentDisposition("База знаний EVO.zip") } });
        }
        if (request.method === "GET" && !option) return json(await knowledgeExportAction(actor, "status", id));
        if (request.method === "POST" && option === "retry") {
          const job = await knowledgeExportAction(actor, "retry", id);
          if (job.state === "queued") after(() => buildKnowledgeExport(job.id));
          return json(job);
        }
      }
    }
    if (request.method === "GET" && route === "list" && segments.length === 1) {
      const query = Object.fromEntries(url.searchParams) as KnowledgeQuery;
      if (url.searchParams.has("limit")) query.limit = Number(url.searchParams.get("limit"));
      return json(await readKnowledgePage(actor, query));
    }
    if (request.method === "GET" && route === "item" && id && KNOWLEDGE_UUID.test(id) && segments.length <= 3) {
      if (!option) return json(await readKnowledgeItem(actor, id));
      if (option === "history") return json(await readKnowledgeHistory(actor, id, Number(url.searchParams.get("before")) || undefined));
    }
    if (request.method === "POST" && route === "command" && segments.length === 1) {
      let value: { requestId: string; command: KnowledgeCommand };
      try { value = JSON.parse(new TextDecoder().decode(await boundedBody(request, 2_500_000))); }
      catch (error) { if (error instanceof KnowledgeError) throw error; throw new KnowledgeError("knowledge_invalid", 400); }
      if (!value || typeof value.requestId !== "string" || !value.command || typeof value.command.op !== "string") throw new KnowledgeError("knowledge_invalid", 400);
      // Plaintext credentials never use the generic material endpoint.
      if (value.command.area === "secrets" && value.command.op !== "create") throw new KnowledgeError("knowledge_encrypted_operation_required", 400);
      if (value.command.area === "secrets" && value.command.kind !== "folder") throw new KnowledgeError("knowledge_encrypted_operation_required", 400);
      return json(await runKnowledgeCommand(actor, value.requestId, value.command));
    }
    if (route === "blob" && id && KNOWLEDGE_UUID.test(id)) {
      if (request.method === "GET" && segments.length === 2) return json(await readKnowledgeBlob(actor, id));
      if (request.method === "POST" && option === "complete" && segments.length === 3) return json(await completeKnowledgeBlob(actor, id));
      if (request.method === "POST" && option && /^\d+$/.test(option) && segments.length === 3) {
        return json(await uploadKnowledgePart(actor, id, Number(option), await boundedBody(request, KNOWLEDGE_PART_SIZE)));
      }
    }
    if (request.method === "GET" && route === "download" && id && KNOWLEDGE_UUID.test(id) && segments.length === 2) {
      const item = await readKnowledgeItem(actor, id);
      if (item.kind === "folder") throw new KnowledgeError("knowledge_invalid", 400);
      if (item.kind === "page" && url.searchParams.get("original") !== "1") {
        return new Response(item.body ?? "", { headers: { ...PRIVATE_HEADERS, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": contentDisposition(item.title + ".md") } });
      }
      const blobId = url.searchParams.get("original") === "1" ? item.source_blob_id : item.blob_id;
      if (!blobId) throw new KnowledgeError("knowledge_not_found", 404);
      const blob = await readKnowledgeBlob(actor, blobId);
      const inline = url.searchParams.get("preview") === "1" && blob.scan_status === "clean" && ["application/pdf", "image/png", "image/jpeg"].includes(item.mime_type);
      return new Response(knowledgeBlobStream(blob), { headers: { ...PRIVATE_HEADERS,
        "Content-Length": String(blob.byte_size), "Content-Type": inline ? item.mime_type : "application/octet-stream",
        "Content-Security-Policy": "sandbox; default-src 'none'", "Content-Disposition": contentDisposition(item.title, inline),
      } });
    }
    throw new KnowledgeError("knowledge_not_found", 404);
  } catch (error) {
    const known = error instanceof KnowledgeError ? error : new KnowledgeError("knowledge_unavailable");
    return Response.json({ error: known.code }, { status: known.status, headers: PRIVATE_HEADERS });
  }
}
