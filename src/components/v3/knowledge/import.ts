import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { KNOWLEDGE_PART_SIZE, type KnowledgeBlob, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import type { KnowledgeImportEntry } from "@/lib/knowledge-import-contract";
import { command, knowledgeFetch, knowledgeSourceKey } from "./client";

export async function importKnowledgeFile(file: File, entry: KnowledgeImportEntry, manifestSha: string,
  folderCache: Map<string, string>, entries: KnowledgeImportEntry[], onProgress: (bytes: number) => void) {
  if (!entry.area || entry.area === "secrets" || !entry.sourceKey || !entry.sha256 || !entry.kind || !entry.title || !entry.folders) throw new Error("Для этого источника нужен защищённый импорт.");
  const existing = await knowledgeFetch<KnowledgeItem | null>(`source/${entry.sourceKey}`);
  if (existing) {
    if (existing.source?.sha256 !== entry.sha256 || existing.source?.byteSize !== entry.bytes) throw new Error("Источник изменился после предыдущего переноса. Существующий материал не перезаписан.");
    return { item: existing, reused: true };
  }
  if (file.size !== entry.bytes) throw new Error("Размер исходника изменился после инвентаризации.");
  const digest = sha256.create();
  for (let offset = 0; offset < file.size; offset += KNOWLEDGE_PART_SIZE) digest.update(new Uint8Array(await file.slice(offset, offset + KNOWLEDGE_PART_SIZE).arrayBuffer()));
  if (bytesToHex(digest.digest()) !== entry.sha256) throw new Error("Исходник изменился после инвентаризации. Нужен свежий план переноса.");
  let parentId: string | null = null;
  for (const name of entry.folders) {
    const key = knowledgeSourceKey(["import-folder", entry.area, parentId, name]);
    if (!folderCache.has(key)) {
      const folder: KnowledgeItem = await command({ op: "create", kind: "folder", area: entry.area, parentId, title: name, sourceKey: key });
      if (folder.deleted_at || folder.archived_at) throw new Error("Папка переноса находится в архиве или корзине. Восстановите её перед продолжением.");
      folderCache.set(key, folder.id);
    }
    parentId = folderCache.get(key)!;
  }
  const reserved = await command<KnowledgeBlob>({ op: "reserve_blob", area: entry.area, sha256: entry.sha256, byteSize: entry.bytes });
  const blob = await knowledgeFetch<KnowledgeBlob>(`blob/${reserved.id}`);
  if (blob.state !== "ready") {
    for (let offset = 0, index = 0; offset < file.size; offset += KNOWLEDGE_PART_SIZE, index++) {
      if (!blob.parts?.some((p) => p.part_index === index)) await knowledgeFetch(`blob/${blob.id}/${index}`, { method: "POST", body: file.slice(offset, offset + KNOWLEDGE_PART_SIZE) });
      onProgress(Math.min(offset + KNOWLEDGE_PART_SIZE, file.size));
    }
    await knowledgeFetch(`blob/${blob.id}/complete`, { method: "POST" });
  }
  let body = entry.kind === "page" ? new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) : undefined;
  if (body !== undefined) {
    const pathMap = new Map(entries.filter((e) => e.nodeId).map((e) => [e.relativePath.normalize("NFC"), e]));
    const resolve = (target: string) => {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) return null;
      let decoded: string; try { decoded = decodeURIComponent(target.split("#")[0]); } catch { return null; }
      const segments = [...entry.relativePath.split("/").slice(0, -1)];
      for (const part of decoded.split("/")) { if (part === "..") segments.pop(); else if (part && part !== ".") segments.push(part); }
      const exact = pathMap.get(segments.join("/").normalize("NFC")) ?? pathMap.get((segments.join("/") + ".md").normalize("NFC"));
      if (exact) return exact;
      const candidates = entries.filter((e) => e.scope === entry.scope && e.nodeId && (e.relativePath.endsWith("/" + decoded) || e.relativePath.endsWith("/" + decoded + ".md")));
      return candidates.length === 1 ? candidates[0] : null;
    };
    const link = (target: KnowledgeImportEntry, embedded: boolean, original: string) => {
      const fragment = original.includes("#") ? "#" + original.split("#").slice(1).join("#") : "";
      return (embedded && /\.(png|jpe?g)$/i.test(target.relativePath)
        ? `/api/v3/knowledge/download/${target.nodeId}?preview=1` : `/v3/knowledge?item=${target.nodeId}`) + fragment;
    };
    body = body.replace(/(!?)\[\[([^\]]+)\]\]/g, (original, embedded, value: string) => {
      const [target, alias] = value.split("|"); const resolved = resolve(target);
      return resolved ? `${embedded}[${alias ?? target}](${link(resolved, Boolean(embedded), target)})` : original;
    }).replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (original, embedded, title: string, target: string) => {
      const resolved = resolve(target); return resolved ? `${embedded}[${title}](${link(resolved, Boolean(embedded), target)})` : original;
    });
  }
  const source = { scope: entry.scope, relativePath: entry.relativePath, originalFilename: file.name, sha256: entry.sha256,
    byteSize: entry.bytes, classification: entry.classification, authority: entry.authority, filingReason: entry.reason, inventorySha256: manifestSha };
  const item: KnowledgeItem = await command({ op: "create", id: entry.nodeId, area: entry.area, parentId, archived: entry.classification === "historical_version", kind: entry.kind, title: entry.title,
    sourceBlobId: blob.id, blobId: entry.kind === "file" ? blob.id : null, body, mimeType: file.type || "application/octet-stream",
    sourceKey: entry.sourceKey, reviewQuestion: entry.reviewQuestion, source });
  if (item.source?.sha256 !== entry.sha256) throw new Error("Источник не совпал с сохранённой записью.");
  return { item, reused: false };
}
