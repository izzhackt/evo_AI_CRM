import "server-only";

import {
  platformKnowledgeImportError,
  platformKnowledgeImportReason,
} from "./platform-knowledge-import-errors.ts";

import { createHash } from "node:crypto";

export type PlatformKnowledgeAudience = "client" | "internal";

type SourceDocument = Readonly<{
  source_path: string;
  source_sha256: string;
  title: string;
  content: string;
}>;

type SourceBundle = Readonly<{
  version: 1;
  account_id: string;
  audience: PlatformKnowledgeAudience;
  vault_kind: string;
  marker_sha256: string;
  documents: readonly SourceDocument[];
}>;

export type PlatformKnowledgeImportResult = Readonly<{
  version: 1;
  account_id: string;
  audience: PlatformKnowledgeAudience;
  bundle_sha256: string;
  documents_upserted: number;
  documents_deleted: number;
  chunks_replaced: number;
}>;

type Embedder = (
  texts: readonly string[],
  options: Readonly<{ model: "gemini-embedding-2"; dimensions: 1_536 }>,
) => Promise<readonly (readonly number[])[]>;

type RpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMBEDDING_DIMENSIONS = 1_536;
const MAX_CHUNK_CHARS = 1_200;
export const PLATFORM_KNOWLEDGE_MAX_BUNDLE_BYTES = 16 * 1_024 * 1_024;
export const PLATFORM_KNOWLEDGE_MAX_MANIFEST_BYTES = 16 * 1_024;
export const PLATFORM_KNOWLEDGE_MAX_DOCUMENTS = 512;
export const PLATFORM_KNOWLEDGE_MAX_DOCUMENT_BYTES = 256 * 1_024;
export const PLATFORM_KNOWLEDGE_MAX_TOTAL_CONTENT_BYTES = 12 * 1_024 * 1_024;
export const PLATFORM_KNOWLEDGE_MAX_TOTAL_CHUNKS = 8_000;

export function formatPlatformKnowledgeEmbeddingDocument(title: string, content: string): string {
  return `title: ${title} | text: ${content}`;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function stablePlatformKnowledgeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stablePlatformKnowledgeJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stablePlatformKnowledgeJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCanonicalJson(bytes: Buffer, label: string): unknown {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${label}: invalid UTF-8`);
  if (!text.endsWith("\n") || text.endsWith("\n\n")) throw new Error(`${label}: non-canonical ending`);
  const parsed = JSON.parse(text) as unknown;
  if (!Buffer.from(`${stablePlatformKnowledgeJson(parsed)}\n`, "utf8").equals(bytes)) throw new Error(`${label}: non-canonical JSON`);
  return parsed;
}

function containsEmail(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(value);
}

function containsPhone(value: string): boolean {
  for (const match of value.matchAll(/(?<!\w)(?:\+?\d[\s().-]*){8,}(?!\w)/gu)) {
    const candidate = match[0];
    const digits = candidate.replace(/\D/gu, "").length;
    if (candidate.trimStart().startsWith("+") || digits >= 10) return true;
  }
  return false;
}

function validateDocument(value: unknown): SourceDocument {
  const row = object(value, "document");
  if (!exactKeys(row, ["source_path", "source_sha256", "title", "content"])) throw new Error("document: invalid schema");
  if (typeof row.source_path !== "string" || typeof row.source_sha256 !== "string" || typeof row.title !== "string" || typeof row.content !== "string") {
    throw new Error("document: fields must be strings");
  }
  const path = row.source_path;
  if (
    !path ||
    path !== path.normalize("NFC") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    !path.endsWith(".md") ||
    path.split("/").some((part) => !part || part.startsWith(".") || part === ".." || part === "Сырой архив ЭВО" || part === "Секреты и доступы ЭВО")
  ) {
    throw new Error("document: unsafe source_path");
  }
  if (!SHA256_PATTERN.test(row.source_sha256) || sha256(Buffer.from(row.content, "utf8")) !== row.source_sha256) {
    throw new Error("document: SHA-256 mismatch");
  }
  if (!row.title.trim() || !row.content.trim()) throw new Error("document: empty title/content");
  if (containsEmail(`${row.title}\n${row.content}`) || containsPhone(`${row.title}\n${row.content}`)) {
    throw new Error("document: email or phone contact detected");
  }
  return Object.freeze({ source_path: path, source_sha256: row.source_sha256, title: row.title, content: row.content });
}

export function validatePlatformKnowledgeBundleBytes(
  bundleBytes: Buffer,
  manifestBytes: Buffer,
  expectedAccountId: string,
  expectedAudience: PlatformKnowledgeAudience,
  expectedBundleFile: string,
): Readonly<{ bundle: SourceBundle; bundleSha256: string }> {
  if (!UUID_PATTERN.test(expectedAccountId)) throw platformKnowledgeImportError("account_binding_failed", "Invalid account id");
  if (bundleBytes.byteLength > PLATFORM_KNOWLEDGE_MAX_BUNDLE_BYTES) throw platformKnowledgeImportError("bundle_invalid", "Bundle exceeds byte limit");
  if (manifestBytes.byteLength > PLATFORM_KNOWLEDGE_MAX_MANIFEST_BYTES) throw platformKnowledgeImportError("manifest_mismatch", "Manifest exceeds byte limit");
  const bundleSha256 = sha256(bundleBytes);
  let manifest: Record<string, unknown>;
  try {
    manifest = object(parseCanonicalJson(manifestBytes, "manifest"), "manifest");
  } catch {
    throw platformKnowledgeImportError("manifest_mismatch", "Manifest is invalid");
  }
  if (manifest.account_id !== expectedAccountId) throw platformKnowledgeImportError("account_binding_failed", "Manifest account does not match canonical account");
  if (
    !exactKeys(manifest, ["version", "account_id", "audience", "bundle_file", "bundle_sha256"]) ||
    manifest.version !== 1 ||
    manifest.audience !== expectedAudience ||
    manifest.bundle_file !== expectedBundleFile ||
    manifest.bundle_sha256 !== bundleSha256
  ) throw platformKnowledgeImportError("manifest_mismatch", "Manifest does not match bundle");

  let raw: Record<string, unknown>;
  try {
    raw = object(parseCanonicalJson(bundleBytes, "bundle"), "bundle");
  } catch {
    throw platformKnowledgeImportError("bundle_invalid", "Bundle is invalid");
  }
  if (raw.account_id !== expectedAccountId) throw platformKnowledgeImportError("account_binding_failed", "Bundle account does not match canonical account");
  const expectedVaultKind = expectedAudience === "client" ? "evo_client_knowledge" : "evo_internal_knowledge";
  if (
    !exactKeys(raw, ["version", "account_id", "audience", "vault_kind", "marker_sha256", "documents"]) ||
    raw.version !== 1 ||
    raw.audience !== expectedAudience ||
    raw.vault_kind !== expectedVaultKind ||
    typeof raw.marker_sha256 !== "string" ||
    !SHA256_PATTERN.test(raw.marker_sha256) ||
    !Array.isArray(raw.documents) ||
    raw.documents.length < 1 ||
    raw.documents.length > PLATFORM_KNOWLEDGE_MAX_DOCUMENTS
  ) throw platformKnowledgeImportError("bundle_invalid", "Bundle has invalid schema");
  let documents: SourceDocument[];
  try {
    documents = raw.documents.map(validateDocument);
  } catch {
    throw platformKnowledgeImportError("bundle_invalid", "Bundle document is invalid");
  }
  let totalContentBytes = 0;
  for (const document of documents) {
    const contentBytes = Buffer.byteLength(document.content, "utf8");
    if (contentBytes > PLATFORM_KNOWLEDGE_MAX_DOCUMENT_BYTES) throw platformKnowledgeImportError("bundle_invalid", "Document exceeds content limit");
    totalContentBytes += contentBytes;
  }
  if (totalContentBytes > PLATFORM_KNOWLEDGE_MAX_TOTAL_CONTENT_BYTES) throw platformKnowledgeImportError("bundle_invalid", "Bundle exceeds total content limit");
  if (new Set(documents.map((document) => document.source_path)).size !== documents.length) throw platformKnowledgeImportError("bundle_invalid", "Bundle has duplicate source_path");
  return Object.freeze({
    bundle: Object.freeze({
      version: 1,
      account_id: expectedAccountId,
      audience: expectedAudience,
      vault_kind: expectedVaultKind,
      marker_sha256: raw.marker_sha256,
      documents: Object.freeze(documents),
    }),
    bundleSha256,
  });
}

export function chunkPlatformKnowledgeText(content: string): readonly string[] {
  const text = content.replace(/\r\n/gu, "\n").trim();
  if (!text) return Object.freeze([]);
  const paragraphs = text.split(/\n\s*\n/gu).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      for (let index = 0; index < paragraph.length; index += MAX_CHUNK_CHARS) {
        const slice = paragraph.slice(index, index + MAX_CHUNK_CHARS).trim();
        if (slice) chunks.push(slice);
      }
      continue;
    }
    if (current && current.length + 2 + paragraph.length > MAX_CHUNK_CHARS) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return Object.freeze(chunks);
}

function validateImportResult(value: unknown, accountId: string, audience: PlatformKnowledgeAudience, bundleSha256: string): PlatformKnowledgeImportResult {
  const result = object(value, "sync result");
  if (
    !exactKeys(result, ["version", "account_id", "audience", "bundle_sha256", "documents_upserted", "documents_deleted", "chunks_replaced"]) ||
    result.version !== 1 ||
    result.account_id !== accountId ||
    result.audience !== audience ||
    result.bundle_sha256 !== bundleSha256
  ) throw new Error("Sync result does not match request");
  for (const field of ["documents_upserted", "documents_deleted", "chunks_replaced"] as const) {
    if (!Number.isInteger(result[field]) || (result[field] as number) < 0) throw new Error("Sync result has invalid counters");
  }
  return result as unknown as PlatformKnowledgeImportResult;
}

export async function importPlatformKnowledgeBundleBytes(input: Readonly<{
  db: RpcClient;
  embed: Embedder;
  bundleBytes: Buffer;
  manifestBytes: Buffer;
  bundleFile: string;
  accountId: string;
  audience: PlatformKnowledgeAudience;
}>): Promise<PlatformKnowledgeImportResult> {
  const { bundle, bundleSha256 } = validatePlatformKnowledgeBundleBytes(
    input.bundleBytes,
    input.manifestBytes,
    input.accountId,
    input.audience,
    input.bundleFile,
  );
  let chunked: readonly (SourceDocument & { contents: readonly string[] })[];
  try {
    chunked = bundle.documents.map((document) => ({ ...document, contents: chunkPlatformKnowledgeText(document.content) }));
  } catch {
    throw platformKnowledgeImportError("bundle_invalid", "Bundle chunk construction failed");
  }
  if (chunked.some((document) => document.contents.length < 1)) throw platformKnowledgeImportError("bundle_invalid", "Document has no chunks");
  const totalChunks = chunked.reduce((total, document) => total + document.contents.length, 0);
  if (totalChunks > PLATFORM_KNOWLEDGE_MAX_TOTAL_CHUNKS) throw platformKnowledgeImportError("bundle_invalid", "Bundle exceeds total chunk limit");
  const texts = chunked.flatMap((document) => document.contents.map((content) => (
    formatPlatformKnowledgeEmbeddingDocument(document.title, content)
  )));
  let embeddings: readonly (readonly number[])[];
  try {
    embeddings = await input.embed(texts, {
      model: "gemini-embedding-2",
      dimensions: EMBEDDING_DIMENSIONS,
    });
  } catch (error) {
    throw platformKnowledgeImportError(platformKnowledgeImportReason(error, "transport_failed"), "Embedding failed");
  }
  if (embeddings.length !== texts.length || embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value)))) {
    throw platformKnowledgeImportError("provider_rejected", "Embedding response has invalid shape");
  }
  let embeddingIndex = 0;
  const documents = chunked.map((document) => ({
    source_path: document.source_path,
    source_sha256: document.source_sha256,
    title: document.title,
    content: document.content,
    chunks: document.contents.map((content, chunk_index) => ({
      chunk_index,
      content,
      content_sha256: sha256(Buffer.from(content, "utf8")),
      embedding: embeddings[embeddingIndex++],
    })),
  }));
  let response: Awaited<ReturnType<RpcClient["rpc"]>>;
  try {
    response = await input.db.rpc("sync_ai_knowledge_bundle", {
      p_account_id: input.accountId,
      p_audience: input.audience,
      p_bundle_sha256: bundleSha256,
      p_payload: { version: 1, documents },
    });
  } catch {
    throw platformKnowledgeImportError("rpc_rejected", "Atomic knowledge sync transport failed");
  }
  const { data, error } = response;
  if (error) throw platformKnowledgeImportError("rpc_rejected", "Atomic knowledge sync rejected");
  try {
    return validateImportResult(data, input.accountId, input.audience, bundleSha256);
  } catch {
    throw platformKnowledgeImportError("rpc_rejected", "Atomic knowledge sync result was invalid");
  }
}

export function resolveConfiguredPlatformKnowledgeAccountId(
  requestedAccountId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configuredAccountId = environment.EVO_PLATFORM_KNOWLEDGE_ACCOUNT_ID;
  if (!configuredAccountId || !UUID_PATTERN.test(configuredAccountId) || configuredAccountId !== requestedAccountId) {
    throw platformKnowledgeImportError("account_binding_failed", "Importer account does not match canonical account");
  }
  return configuredAccountId;
}
