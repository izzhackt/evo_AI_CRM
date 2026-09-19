import "server-only";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { KNOWLEDGE_UUID, type KnowledgeItem } from "@/lib/knowledge-library-contract";
import { KnowledgeError, knowledgeRpcError, requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";
import { createPlatformSupabaseServiceClient } from "../platform-supabase-service-client";
import { getPlatformSupabaseBackendConfig } from "../platform-supabase-backend-config";

type SecretFields = { service: string; url: string; login: string; purpose: string; note: string; value: string };
async function configuration() {
  const binary = process.env.EVO_KNOWLEDGE_SOPS_BINARY ?? "/usr/local/bin/sops";
  const keyFile = process.env.EVO_KNOWLEDGE_AGE_KEY_FILE;
  const recipients = process.env.EVO_KNOWLEDGE_AGE_RECIPIENTS;
  if (!keyFile || !recipients || !recipients.split(",").every((v) => /^age1[0-9a-z]{58}$/.test(v))) throw new KnowledgeError("knowledge_sops_unavailable");
  try {
    const [key, executable] = await Promise.all([stat(/* turbopackIgnore: true */ keyFile), stat(/* turbopackIgnore: true */ binary)]);
    if (!key.isFile() || (key.mode & 0o077) !== 0 || !executable.isFile()) throw new Error();
  } catch { throw new KnowledgeError("knowledge_sops_unavailable"); }
  return { binary, keyFile, recipients };
}
async function sops(operation: "encrypt" | "decrypt", input: Buffer): Promise<Buffer> {
  const config = await configuration();
  const args = [operation, "--input-type", "json", "--output-type", "json"];
  if (operation === "encrypt") args.push("--age", config.recipients, "--filename-override", "evo-knowledge.enc.json");
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ config.binary, args, { shell: false, cwd: "/", env: { NODE_ENV: process.env.NODE_ENV, PATH: "/usr/local/bin:/usr/bin:/bin", SOPS_AGE_KEY_FILE: config.keyFile }, stdio: ["pipe", "pipe", "pipe"] });
    const buffers: Buffer[] = []; let size = 0; let failed = false;
    const fail = () => { if (!failed) { failed = true; child.kill("SIGKILL"); reject(new KnowledgeError("knowledge_sops_unavailable")); } };
    const timeout = setTimeout(fail, 15_000);
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1_048_576) fail(); else buffers.push(chunk); });
    // SOPS errors may contain input fragments. Drain them without logging or returning them.
    child.stderr.resume(); child.on("error", fail); child.stdin.on("error", fail);
    child.on("close", (code) => { clearTimeout(timeout); if (code !== 0) fail(); else if (!failed) resolve(Buffer.concat(buffers)); });
    child.stdin.end(input);
  });
}
function fields(value: unknown): SecretFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeError("knowledge_invalid", 400);
  const record = value as Record<string, unknown>; const result: Record<string, string> = {};
  for (const key of ["service", "url", "login", "purpose", "note", "value"] as const) {
    if (typeof record[key] !== "string" || record[key].length > (key === "value" ? 65_536 : key === "service" ? 240 : 4000)) throw new KnowledgeError("knowledge_invalid", 400);
    result[key] = record[key];
  }
  if (!result.service.trim()) throw new KnowledgeError("knowledge_invalid", 400);
  if (result.url) { try { if (!["https:", "http:"].includes(new URL(result.url).protocol)) throw new Error(); } catch { throw new KnowledgeError("knowledge_invalid", 400); } }
  return result as SecretFields;
}
async function sealedRpc(actor: ActivePlatformActor, mode: string, data: Record<string, unknown>) {
  requireKnowledgeAdmin(actor);
  const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const response = await client.schema("platform").rpc("kb_sealed_v1", { p_organization_id: actor.organizationId, p_actor: actor.membershipId, p_mode: mode, p_data: data });
  if (response.error) knowledgeRpcError(response.error);
  return response.data;
}
export async function readKnowledgeSecret(actor: ActivePlatformActor, id: string, reveal: boolean) {
  requireKnowledgeAdmin(actor); await configuration();
  const result = await sealedRpc(actor, reveal ? "reveal" : "metadata", { id });
  const plaintext = await sops("decrypt", Buffer.from(result.ciphertext));
  try {
    const value = fields(JSON.parse(plaintext.toString("utf8")));
    return reveal ? { value: value.value } : { item: result.item as KnowledgeItem, ...value, value: undefined, hasValue: Boolean(value.value) };
  } finally { plaintext.fill(0); }
}
export async function saveKnowledgeSecret(actor: ActivePlatformActor, payload: Record<string, unknown>) {
  requireKnowledgeAdmin(actor);
  if (typeof payload.id !== "string" || !KNOWLEDGE_UUID.test(payload.id) || typeof payload.requestId !== "string" || !KNOWLEDGE_UUID.test(payload.requestId)) throw new KnowledgeError("knowledge_invalid", 400);
  const content = fields(payload.fields);
  // An edit can retain the current value without revealing it to the browser.
  if (payload.keepValue === true && Number(payload.expectedVersion) > 0) {
    const stored = await readKnowledgeSecret(actor, payload.id, true); content.value = stored.value ?? "";
  }
  const plaintext = Buffer.from(JSON.stringify(content));
  try {
    const ciphertext = await sops("encrypt", plaintext);
    const decrypted = await sops("decrypt", ciphertext);
    const check = Buffer.from(JSON.stringify(fields(JSON.parse(decrypted.toString("utf8")))));
    decrypted.fill(0);
    try { if (check.length !== plaintext.length || !timingSafeEqual(check, plaintext)) throw new KnowledgeError("knowledge_integrity_failed"); }
    finally { check.fill(0); }
    const command = { id: payload.id, requestId: payload.requestId, expectedVersion: payload.expectedVersion ?? 0, parentId: payload.parentId ?? null, title: content.service };
    const fingerprint = createHmac("sha256", getPlatformSupabaseBackendConfig().supabaseSecretKey).update(JSON.stringify(command)).update(plaintext).digest("hex");
    return await sealedRpc(actor, "save", { ...command, fingerprint, ciphertext: ciphertext.toString("utf8") }) as KnowledgeItem;
  } finally { plaintext.fill(0); }
}
export async function knowledgeSecretsStatus(actor: ActivePlatformActor) {
  requireKnowledgeAdmin(actor);
  try { await configuration(); return { available: true }; }
  catch { return { available: false, reason: "knowledge_sops_unavailable" }; }
}
