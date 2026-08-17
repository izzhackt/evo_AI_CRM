import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import { importPlatformKnowledgeBundleBytes, resolveConfiguredPlatformKnowledgeAccountId, type PlatformKnowledgeAudience } from "../src/lib/server/platform-knowledge-bundle.ts";
import { createPlatformKnowledgeGeminiEmbedder } from "../src/lib/server/platform-knowledge-embeddings.ts";
import { safePlatformKnowledgeImportResult } from "../src/lib/server/platform-knowledge-import-output.ts";

function arg(name: string): string {
  const indexes = process.argv.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length !== 1) throw new Error(`Exactly one ${name} is required`);
  const value = process.argv[indexes[0] + 1];
  if (!value || value.startsWith("--")) throw new Error(`A value for ${name} is required`);
  return value;
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === "--verify-runtime") {
    process.stdout.write(`${JSON.stringify({ status: "knowledge_import_runtime_verified", version: 1 })}\n`);
    return;
  }
  const audience = arg("--audience");
  if (audience !== "client" && audience !== "internal") throw new Error("--audience must be client or internal");
  const accountId = resolveConfiguredPlatformKnowledgeAccountId(arg("--account-id"));
  const bundlePath = arg("--bundle");
  const manifestPath = arg("--manifest");
  const [bundleBytes, manifestBytes] = await Promise.all([readFile(bundlePath), readFile(manifestPath)]);
  const db = createClient(
    environment("NEXT_PUBLIC_SUPABASE_URL"),
    environment("EVO_PLATFORM_SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const result = await importPlatformKnowledgeBundleBytes({
    db,
    embed: createPlatformKnowledgeGeminiEmbedder({ apiKey: environment("EVO_PLATFORM_GEMINI_API_KEY") }),
    bundleBytes,
    manifestBytes,
    bundleFile: basename(bundlePath),
    accountId,
    audience: audience as PlatformKnowledgeAudience,
  });
  process.stdout.write(`${JSON.stringify(safePlatformKnowledgeImportResult(result))}\n`);
}

await main();
