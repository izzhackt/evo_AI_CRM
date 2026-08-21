import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import {
  formatPlatformKnowledgeEmbeddingDocument,
  importPlatformKnowledgeBundleBytes,
  resolveConfiguredPlatformKnowledgeAccountId,
  type PlatformKnowledgeAudience,
} from "../src/lib/server/platform-knowledge-bundle.ts";
import { createPlatformKnowledgeGeminiEmbedder } from "../src/lib/server/platform-knowledge-embeddings.ts";
import {
  platformKnowledgeImportError,
  platformKnowledgeImportReason,
  type PlatformKnowledgeImportReasonCode,
} from "../src/lib/server/platform-knowledge-import-errors.ts";
import { safePlatformKnowledgeImportResult } from "../src/lib/server/platform-knowledge-import-output.ts";

function arg(name: string): string {
  const indexes = process.argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length !== 1) throw new Error(`Exactly one ${name} is required`);
  const value = process.argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`A value for ${name} is required`);
  return value;
}

function environment(name: string, reasonCode: PlatformKnowledgeImportReasonCode): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw platformKnowledgeImportError(reasonCode, `${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === "--verify-runtime") {
    process.stdout.write(`${JSON.stringify({ status: "knowledge_import_runtime_verified", version: 1 })}\n`);
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--verify-provider") {
    const texts = Array.from({ length: 17 }, (_unused, index) => (
      formatPlatformKnowledgeEmbeddingDocument(
        "EVO P8V3K readiness",
        `Neutral server runtime readiness item ${index + 1}`,
      )
    ));
    const embeddings = await createPlatformKnowledgeGeminiEmbedder({
      apiKey: environment("EVO_PLATFORM_GEMINI_API_KEY", "provider_rejected"),
      retryDelaysMs: [0],
    })(texts, { model: "gemini-embedding-2", dimensions: 1_536 });
    if (embeddings.length !== texts.length) throw platformKnowledgeImportError("provider_rejected", "Provider readiness cardinality drifted");
    process.stdout.write(`${JSON.stringify({
      status: "knowledge_import_provider_verified",
      version: 1,
      model: "gemini-embedding-2",
      vectors: embeddings.length,
      dimensions: 1_536,
      uid: process.getuid?.() ?? null,
      gid: process.getgid?.() ?? null,
    })}\n`);
    return;
  }
  const audience = arg("--audience");
  if (audience !== "client" && audience !== "internal") throw new Error("--audience must be client or internal");
  const accountId = resolveConfiguredPlatformKnowledgeAccountId(arg("--account-id"));
  const bundlePath = arg("--bundle");
  const manifestPath = arg("--manifest");
  let bundleBytes: Buffer;
  let manifestBytes: Buffer;
  try {
    [bundleBytes, manifestBytes] = await Promise.all([readFile(bundlePath), readFile(manifestPath)]);
  } catch {
    throw platformKnowledgeImportError("transport_failed", "Knowledge input read failed");
  }
  const db = createClient(
    environment("NEXT_PUBLIC_SUPABASE_URL", "transport_failed"),
    environment("EVO_PLATFORM_SUPABASE_SECRET_KEY", "rpc_rejected"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const result = await importPlatformKnowledgeBundleBytes({
    db,
    embed: createPlatformKnowledgeGeminiEmbedder({ apiKey: environment("EVO_PLATFORM_GEMINI_API_KEY", "provider_rejected") }),
    bundleBytes,
    manifestBytes,
    bundleFile: basename(bundlePath),
    accountId,
    audience: audience as PlatformKnowledgeAudience,
  });
  process.stdout.write(`${JSON.stringify(safePlatformKnowledgeImportResult(result))}\n`);
}

try {
  await main();
} catch (error) {
  if (process.argv.length === 3 && process.argv[2] === "--verify-provider") {
    process.stdout.write(`${JSON.stringify({
      status: "knowledge_import_provider_blocked",
      version: 1,
      reason_code: platformKnowledgeImportReason(error, "transport_failed"),
    })}\n`);
    process.exitCode = 2;
  } else {
    const audience = process.argv.includes("--audience")
      ? process.argv[process.argv.indexOf("--audience") + 1]
      : undefined;
    if (audience !== "client" && audience !== "internal") throw error;
    const blocked = {
      status: "knowledge_import_blocked",
      version: 1,
      audience,
      reason_code: platformKnowledgeImportReason(error, "transport_failed"),
    } as const;
    process.stdout.write(`${JSON.stringify(blocked)}\n`);
  }
}
