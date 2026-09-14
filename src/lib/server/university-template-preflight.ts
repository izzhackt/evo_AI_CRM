import "server-only";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { parseUniversityTemplateSourcePreview, type UniversityTemplateSourcePreview } from "../university-template-preview.ts";

export type UniversityTemplateMime = "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type UniversityTemplateManifest = Readonly<{
  format: "docx" | "pdf";
  slots: readonly Readonly<{ id: string; editable: boolean }>[];
  pageSizes: readonly Readonly<{ width: number; height: number }>[];
}>;
export type UniversityTemplateRejection = Readonly<{ status: "rejected"; code: "template_not_eligible" | "source_unavailable" }>;
export type UniversityTemplateInspection = Readonly<{
  status: "verified"; sha256: string; byteLength: number; mimeType: UniversityTemplateMime;
  policyVersion: "evo-university-template-v1"; manifest: UniversityTemplateManifest;
}> | UniversityTemplateRejection;
export type UniversityTemplateSourcePreviewResult = UniversityTemplateSourcePreview | UniversityTemplateRejection;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT = 128 * 1024;
const LAUNCHER = "/opt/evo-university-template-runtime/launcher";
const unavailable = (): UniversityTemplateRejection => ({ status: "rejected", code: "source_unavailable" });
const ineligible = (): UniversityTemplateRejection => ({ status: "rejected", code: "template_not_eligible" });
let running = false;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(",") === expected;
}
function manifest(value: unknown, mime: UniversityTemplateMime): UniversityTemplateManifest | null {
  const format = mime === DOCX ? "docx" : "pdf";
  if (!record(value) || !keys(value, "format,pageSizes,slots") || !Array.isArray(value.slots) || !Array.isArray(value.pageSizes)
    || value.format !== format || value.slots.length > 3000 || value.pageSizes.length > 100
    || (mime === DOCX ? value.slots.length === 0 || value.pageSizes.length !== 0 : value.slots.length !== 0 || value.pageSizes.length === 0)) return null;
  const slots: { id: string; editable: boolean }[] = [];
  for (const [index, slot] of value.slots.entries()) {
    if (!record(slot) || !keys(slot, "editable,id") || slot.id !== `p-${index + 1}` || typeof slot.editable !== "boolean") return null;
    slots.push(Object.freeze({ id: slot.id as string, editable: slot.editable }));
  }
  const pages: { width: number; height: number }[] = [];
  for (const page of value.pageSizes) {
    if (!record(page) || !keys(page, "height,width") || typeof page.width !== "number" || typeof page.height !== "number"
      || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width < 72 || page.width > 3000
      || page.height < 72 || page.height > 3000) return null;
    pages.push(Object.freeze({ width: page.width, height: page.height }));
  }
  return Object.freeze({ format, slots: Object.freeze(slots), pageSizes: Object.freeze(pages) });
}

/** Source structure proof only: no malware, layout, mapping approval or publication authority. */
export async function inspectUniversityTemplate(input: {
  bytes: Uint8Array; mimeType: UniversityTemplateMime; expectedSha256: string;
}, options: { signal: AbortSignal }): Promise<UniversityTemplateInspection> {
  return runUniversityTemplate(input, options, {}, (value, bytes, mimeType, expectedSha256) => {
    if (!record(value) || !keys(value, "byteLength,manifest,mimeType,policyVersion,sha256,status") || value.status !== "verified"
      || value.sha256 !== expectedSha256 || value.byteLength !== bytes.length || value.mimeType !== mimeType
      || value.policyVersion !== "evo-university-template-v1") return null;
    const safeManifest = manifest(value.manifest, mimeType);
    return safeManifest ? Object.freeze({ status: "verified", sha256: expectedSha256, byteLength: bytes.length, mimeType,
      policyVersion: "evo-university-template-v1", manifest: safeManifest }) : null;
  });
}

/** Call only after live manager authorization and verified private source retrieval; recheck access before delivery. */
export async function previewUniversityTemplateSource(input: {
  bytes: Uint8Array; mimeType: UniversityTemplateMime; expectedSha256: string;
  expectedManifest: UniversityTemplateManifest; offset: number;
}, options: { signal: AbortSignal }): Promise<UniversityTemplateSourcePreviewResult> {
  if (!input || input.mimeType !== DOCX || !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 2999) return ineligible();
  // Capture a normalized copy before dispatch so caller mutations cannot change the binding.
  const expectedManifest = manifest(input.expectedManifest, DOCX), offset = input.offset;
  if (!expectedManifest || offset >= expectedManifest.slots.length) return ineligible();
  const manifestDigest = createHash("sha256").update(JSON.stringify(expectedManifest)).digest("hex");
  return runUniversityTemplate(input, options, { operation: "source-preview", offset }, (value, bytes, _mime, expectedSha256) =>
    parseUniversityTemplateSourcePreview(value, { sha256: expectedSha256, byteLength: bytes.length, manifestDigest,
      offset, slots: expectedManifest.slots }));
}

/** Both operations share one fixed supervisor, admission lock and bounded pipe. */
async function runUniversityTemplate<T>(input: {
  bytes: Uint8Array; mimeType: UniversityTemplateMime; expectedSha256: string;
}, options: { signal: AbortSignal }, operation: Record<string, string | number>,
validate: (value: unknown, bytes: Buffer, mimeType: UniversityTemplateMime, expectedSha256: string) => T | null): Promise<T | UniversityTemplateRejection> {
  if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_BYTES
    || ![DOCX, "application/pdf"].includes(input.mimeType) || !/^[a-f0-9]{64}$/.test(input.expectedSha256)) return ineligible();
  const bytes = Buffer.from(input.bytes), mimeType = input.mimeType, expectedSha256 = input.expectedSha256;
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) return ineligible();
  const signal = options?.signal;
  if (!(signal instanceof AbortSignal) || signal.aborted || process.platform !== "linux" || running) return unavailable();
  running = true;
  try {
    return await new Promise<T | UniversityTemplateRejection>((resolve) => {
      const child = spawn(LAUNCHER, [], { cwd: "/", env: { NODE_ENV: "production" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      const chunks: Buffer[] = []; let length = 0, stopped = false, settled = false;
      const stop = () => { stopped = true; child.kill("SIGKILL"); };
      const timer = setTimeout(stop, 16_000);
      const finish = (result: T | UniversityTemplateRejection) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener("abort", stop); resolve(result);
      };
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      child.on("error", () => finish(unavailable()));
      child.stdin.on("error", stop);
      child.stdout.on("error", stop);
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > MAX_OUTPUT) stop(); else chunks.push(chunk);
      });
      child.on("close", (code) => {
        if (stopped || code !== 0) return finish(unavailable());
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
          if (!record(value)) return finish(unavailable());
          if (keys(value, "code,status") && value.status === "rejected"
            && ["template_not_eligible", "source_unavailable"].includes(String(value.code))) {
            return finish(value.code === "template_not_eligible" ? ineligible() : unavailable());
          }
          finish(validate(value, bytes, mimeType, expectedSha256) ?? unavailable());
        } catch { finish(unavailable()); }
      });
      child.stdin.write(`${JSON.stringify({ byteLength: bytes.length, expectedSha256, mimeType, ...operation })}\n`);
      child.stdin.end(bytes);
    });
  } catch { return unavailable(); }
  finally { running = false; }
}
