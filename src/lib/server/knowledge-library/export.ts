import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { KNOWLEDGE_AREA_NAMES, KNOWLEDGE_PART_SIZE, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkedBlob, KnowledgeError, knowledgeRpcError, requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";
import { createPlatformSupabaseServiceClient } from "../platform-supabase-service-client";
import { getPlatformSupabaseBackendConfig } from "../platform-supabase-backend-config";
import { KNOWLEDGE_BUCKET, knowledgeBlobBytes } from "./storage";
import { knowledgeStorageConflict, knowledgeStorageRequest } from "./storage-retry";

export type KnowledgeExport = {
  id: string; organization_id: string; owner_membership_id: string;
  state: "queued" | "running" | "ready" | "failed" | "expired";
  entry_count: number; completed_entries: number; written_bytes: number;
  created_at: string; expires_at: string; lease_until: string | null; error_code: string | null; sha256: string | null;
  parts?: { path: string; sha256: string; byte_size: number }[];
};
type ExternalFile = { kind: "document" | "company"; id: string; bucket: string; path: string; sha256: string; byteSize: number };
type Snapshot = KnowledgeItem & { exportSelected: boolean; exportHistory?: boolean; exportError?: string; exportExternal?: ExternalFile; exportCiphertext?: string; exportBlob?: { sha256: string; byteSize: number }; exportSourceBlob?: { sha256: string; byteSize: number } };
const service = () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function knowledgeExportAction(actor: ActivePlatformActor, mode: string, id?: string, options = {}): Promise<KnowledgeExport> {
  requireKnowledgeAdmin(actor);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("kb_export_v1", {
    p_organization_id: actor.organizationId, p_mode: mode, p_id: id ?? null, p_options: options,
  });
  if (error) knowledgeRpcError(error);
  return data as KnowledgeExport;
}
async function worker<T>(id: string, lease: string, mode: string, data = {}): Promise<T> {
  const result = await service().schema("platform").rpc("kb_export_worker_v1", { p_id: id, p_lease: lease, p_mode: mode, p_data: data });
  if (result.error) knowledgeRpcError(result.error);
  return result.data as T;
}
function safeName(value: string) {
  const result = value.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/[. ]+$/g, "").slice(0, 180);
  return !result || result === "." || result === ".." ? "Материал" : result;
}
function snapshotPaths(snapshots: Snapshot[]) {
  const current = new Map<string, Snapshot>();
  for (const s of snapshots) if (!s.exportHistory) current.set(s.id, s);
  const paths = new Map<string, string>(); const used = new Map<string, string>();
  function pathOf(id: string, visiting = new Set<string>()): string {
    const known = paths.get(id); if (known) return known;
    const item = current.get(id);
    if (!item || visiting.has(id)) throw new KnowledgeError("knowledge_export_structure_invalid");
    visiting.add(id);
    const parent = item.parent_id && current.has(item.parent_id) ? pathOf(item.parent_id, visiting) : KNOWLEDGE_AREA_NAMES[item.area];
    let name = safeName(item.title);
    if (item.kind === "page" && !/\.md$/i.test(name)) name += ".md";
    if (item.kind === "secret") name += ".enc.json";
    let full = `${parent}/${name}`;
    const normalized = full.toLocaleLowerCase("ru");
    if (used.has(normalized) && used.get(normalized) !== id) {
      const ext = item.kind === "folder" ? "" : posix.extname(name);
      name = `${name.slice(0, name.length - ext.length)} (${id})${ext}`;
      full = `${parent}/${name}`;
    }
    used.set(full.toLocaleLowerCase("ru"), id); paths.set(id, full);
    visiting.delete(id); return full;
  }
  for (const id of current.keys()) pathOf(id);
  return paths;
}
function portableMarkdown(body: string, filePath: string, paths: Map<string, string>, included: Set<string>, originals: Map<string, string>) {
  // Only known CRM routes are rewritten; external links retain their own access boundary.
  return body.replace(/(?:https?:\/\/[^\s)<>]+|\/(?:api\/v3\/knowledge\/download\/|api\/v2\/document-versions\/|v3\/knowledge\?)[^\s)<>]+)/gi, (link) => {
    let url: URL;
    try { url = new URL(link, "https://crm.evoadmissions.com"); } catch { return link; }
    if (url.origin !== "https://crm.evoadmissions.com") return link;
    const id = url.pathname.startsWith("/api/v3/knowledge/download/") ? url.pathname.split("/").at(-1)! : /^\/api\/v2\/document-versions\/[0-9a-f-]+\/download$/.test(url.pathname) ? url.pathname.split("/")[4] : url.pathname === "/v3/knowledge" ? url.searchParams.get("item") : null;
    if (!id || !included.has(id) || !paths.has(id)) return link;
    const target = url.searchParams.get("original") === "1" ? originals.get(id) : paths.get(id);
    if (!target) return link;
    return posix.relative(posix.dirname(filePath), target).split("/").map(encodeURIComponent).join("/") + url.hash;
  });
}
async function verifiedStorage(path: string, expected: { sha256: string; byte_size: number }) {
  const { data, error } = await knowledgeStorageRequest("read", () => service().storage.from(KNOWLEDGE_BUCKET).download(path));
  if (error || !data) throw new KnowledgeError("knowledge_storage_unavailable");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length !== expected.byte_size || sha256(bytes) !== expected.sha256) throw new KnowledgeError("knowledge_integrity_failed");
  return bytes;
}
/** Durable snapshot + lease in Postgres; no source bytes or plaintext credentials on disk. */
export async function buildKnowledgeExport(id: string) {
  const lease = randomUUID();
  const job = await worker<KnowledgeExport | null>(id, lease, "claim");
  if (!job) return;
  let failedItem: Pick<Snapshot, "id" | "title"> | undefined;
  const zip = new ZipFile();
  const stream = zip.outputStream as Readable;
  zip.on("error", (error) => stream.destroy(error));
  try {
    const snapshots: Snapshot[] = []; let ordinal = 0;
    for (;;) {
      const entries = await worker<{ ordinal: number; snapshot: Snapshot }[]>(id, lease, "entries", { after: ordinal });
      if (!entries.length) break;
      if (entries[0].ordinal <= ordinal) throw new KnowledgeError("knowledge_export_structure_invalid");
      snapshots.push(...entries.map((e) => e.snapshot)); ordinal = entries.at(-1)!.ordinal;
    }
    if (snapshots.length !== job.entry_count) throw new KnowledgeError("knowledge_integrity_failed");
    const paths = snapshotPaths(snapshots);
    const originals = new Map(snapshots.filter((s) => !s.exportHistory && s.source_blob_id).map((s) => [s.id, s.source_blob_id === s.blob_id ? paths.get(s.id)! : `Исходники/${s.id}/${s.version}/${safeName(String(s.source?.originalFilename ?? s.title))}`]));
    const included = new Set(snapshots.filter((s) => s.exportSelected && !s.exportHistory).map((s) => s.id));
    let completed = 0;
    const manifest: Record<string, unknown>[] = [];
    const addBlob = (blobId: string, path: string, mtime: Date, item: Snapshot, verified: () => void) => {
      zip.addReadStreamLazy(path, { mtime, compress: false }, (callback) => {
        failedItem = item;
        worker<unknown>(id, lease, "blob", { id: blobId }).then((value) => {
          const blob = checkedBlob(value, job.organization_id);
          const input = Readable.from(knowledgeBlobBytes(blob));
          input.once("end", verified);
          input.on("error", (error) => stream.destroy(error));
          callback(null, input);
        }, (error) => stream.destroy(error));
      });
    };
    for (const item of snapshots) {
      if (!item.exportSelected) { completed++; continue; }
      failedItem = item;
      // Scan proof may become available after the snapshot; the worker checks it live.
      if (item.exportError && !item.exportExternal) throw new KnowledgeError(item.exportError);
      const basePath = paths.get(item.id)!;
      const path = item.exportHistory ? `История/${item.id}/${item.version}/${posix.basename(basePath)}` : basePath;
      const mtime = new Date(item.updated_at);
      let pendingFiles = 0;
      const verified = () => { if (--pendingFiles === 0) completed++; };
      if (item.kind === "folder") zip.addEmptyDirectory(path, { mtime });
      else if (item.kind === "page") zip.addBuffer(Buffer.from(portableMarkdown(item.body ?? "", path, paths, included, originals)), path, { mtime });
      else if (item.kind === "secret" && item.exportCiphertext) zip.addBuffer(Buffer.from(item.exportCiphertext), path, { mtime });
      else if (item.exportExternal) {
        pendingFiles++;
        zip.addReadStreamLazy(path, { mtime, compress: false }, (callback) => {
          failedItem = item;
          void (async () => {
            const file = await worker<ExternalFile>(id, lease, "external", { id: item.id });
            if (!["platform-documents", "platform-company-files"].includes(file.bucket) || !/^[0-9a-f]{2}\/[0-9a-f]{62}$/.test(file.path)
              || !Number.isSafeInteger(file.byteSize) || file.byteSize < 1 || file.byteSize > 26_214_400) throw new KnowledgeError("knowledge_integrity_failed");
            const result = await knowledgeStorageRequest("read", () => service().storage.from(file.bucket).download(file.path));
            if (result.error || !result.data) throw new KnowledgeError("knowledge_storage_unavailable");
            const bytes = new Uint8Array(await result.data.arrayBuffer());
            if (bytes.length !== file.byteSize || sha256(bytes) !== file.sha256) throw new KnowledgeError("knowledge_integrity_failed");
            const input = Readable.from([bytes]); input.once("end", verified);
            callback(null, input);
          })().catch((error) => stream.destroy(error));
        });
      }
      else if (item.blob_id) { pendingFiles++; addBlob(item.blob_id, path, mtime, item, verified); }
      else throw new KnowledgeError("knowledge_blob_not_ready");
      if (item.source_blob_id && item.source_blob_id !== item.blob_id) {
        pendingFiles++;
        addBlob(item.source_blob_id, `Исходники/${item.id}/${item.version}/${safeName(String(item.source?.originalFilename ?? item.title))}`, mtime, item, verified);
      }
      manifest.push({ id: item.id, path, version: item.version, area: item.area, kind: item.kind,
        sha256: item.kind === "page" ? sha256(Buffer.from(portableMarkdown(item.body ?? "", path, paths, included, originals))) : item.exportCiphertext ? sha256(Buffer.from(item.exportCiphertext)) : item.exportExternal?.sha256 ?? item.exportBlob?.sha256, byteSize: item.exportExternal?.byteSize ?? item.exportBlob?.byteSize, original: item.exportSourceBlob, originalTitle: item.title, updatedAt: item.updated_at, source: item.area === "secrets" ? undefined : item.source,
        history: Boolean(item.exportHistory), originalPath: item.source_blob_id && item.source_blob_id !== item.blob_id ? `Исходники/${item.id}/${item.version}/${safeName(String(item.source?.originalFilename ?? item.title))}` : undefined,
        reviewQuestion: item.review_question || undefined, archivedAt: item.archived_at, deletedAt: item.deleted_at });
      if (!pendingFiles) completed++;
    }
    zip.addBuffer(Buffer.from(JSON.stringify({ format: 1, snapshotAt: job.created_at, materials: manifest }, null, 2)), "Манифест.json", { mtime: new Date(job.created_at) });
    zip.end();
    const parts: NonNullable<KnowledgeExport["parts"]> = []; const digest = createHash("sha256");
    let pending = Buffer.alloc(0); let written = 0;
    async function storePart(bytes: Buffer) {
      const path = `${job!.organization_id}/exports/${id}/${lease}/${String(parts.length).padStart(8, "0")}`;
      let part = { path, sha256: sha256(bytes), byte_size: bytes.length };
      const cached = job!.parts?.[parts.length];
      if (cached && cached.sha256 === part.sha256 && cached.byte_size === part.byte_size) {
        await verifiedStorage(cached.path, cached); part = cached;
      } else {
        const { error } = await knowledgeStorageRequest("write", () => service().storage.from(KNOWLEDGE_BUCKET).upload(path, bytes, { upsert: false, contentType: "application/octet-stream" }));
        // A timed-out upload may have committed. Never overwrite it: verify it below.
        if (error && !knowledgeStorageConflict(error)) throw new KnowledgeError("knowledge_storage_unavailable");
        await verifiedStorage(path, part);
      }
      digest.update(bytes); parts.push(part); written += bytes.length;
      await worker(id, lease, "progress", { bytes: written, entries: completed, parts });
    }
    for await (const value of stream) {
      pending = Buffer.concat([pending, Buffer.from(value)]);
      while (pending.length >= KNOWLEDGE_PART_SIZE) { await storePart(pending.subarray(0, KNOWLEDGE_PART_SIZE)); pending = pending.subarray(KNOWLEDGE_PART_SIZE); }
    }
    if (pending.length) await storePart(pending);
    await worker(id, lease, "ready", { sha256: digest.digest("hex"), parts, bytes: written, entries: completed });
  } catch (error) {
    stream.destroy();
    await worker(id, lease, "failed", { code: error instanceof KnowledgeError ? error.code : "knowledge_export_failed", itemId: failedItem?.id, title: failedItem?.title }).catch(() => {});
    // The durable job holds the error; callbacks never print source metadata or provider responses.
  }
}
export function knowledgeExportStream(job: KnowledgeExport) {
  async function* bytes() {
    if (job.state !== "ready" || !job.parts?.length) throw new KnowledgeError("knowledge_export_not_ready");
    const digest = createHash("sha256"); let count = 0;
    for (const part of job.parts) {
      if (Date.parse(job.expires_at) <= Date.now() || !part.path.startsWith(`${job.organization_id}/exports/${job.id}/`)) throw new KnowledgeError("knowledge_export_expired", 409);
      const content = await verifiedStorage(part.path, part); digest.update(content); count += content.length; yield content;
    }
    if (count !== job.written_bytes || digest.digest("hex") !== job.sha256) throw new KnowledgeError("knowledge_integrity_failed");
  }
  return Readable.toWeb(Readable.from(bytes())) as ReadableStream<Uint8Array>;
}

/** TTL is enforced on reads; this removes expired temporary bytes and snapshots on library activity. */
export async function cleanupKnowledgeExports(organizationId: string) {
  const client = service();
  const result = await client.schema("platform").rpc("kb_expired_exports_v1", { p_organization_id: organizationId });
  if (result.error) knowledgeRpcError(result.error);
  for (const job of result.data as { id: string; organization_id: string }[]) {
    if (job.organization_id !== organizationId) throw new KnowledgeError("knowledge_forbidden", 403);
    const root = `${organizationId}/exports/${job.id}`;
    for (;;) {
      const leases = await client.storage.from(KNOWLEDGE_BUCKET).list(root, { limit: 100 });
      if (leases.error) throw new KnowledgeError("knowledge_storage_unavailable");
      if (!leases.data.length) break;
      for (const lease of leases.data) {
        if (!/^[0-9a-f-]{36}$/.test(lease.name)) throw new KnowledgeError("knowledge_export_structure_invalid");
        for (;;) {
          const page = await client.storage.from(KNOWLEDGE_BUCKET).list(`${root}/${lease.name}`, { limit: 100 });
          if (page.error) throw new KnowledgeError("knowledge_storage_unavailable");
          if (!page.data.length) break;
          if (page.data.some((part) => !/^\d{8}$/.test(part.name))) throw new KnowledgeError("knowledge_export_structure_invalid");
          const removal = await client.storage.from(KNOWLEDGE_BUCKET).remove(page.data.map((part) => `${root}/${lease.name}/${part.name}`));
          if (removal.error) throw new KnowledgeError("knowledge_storage_unavailable");
        }
      }
    }
    await worker(job.id, randomUUID(), "expire");
  }
}
