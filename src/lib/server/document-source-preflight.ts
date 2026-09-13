import "server-only";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export type DocumentSourceMime = "application/pdf" | "image/jpeg" | "image/png";
export type DocumentSourceInspection = {
  status: "verified"; sha256: string; byteLength: number; mimeType: DocumentSourceMime;
  pageCount: number; policyVersion: "document-source-v1";
} | { status: "rejected"; code: "document_not_eligible" | "source_unavailable" };
const MAX_BYTES = 25 * 1024 * 1024;
const LAUNCHER = "/opt/evo-document-runtime/launcher";
const unavailable = (): DocumentSourceInspection => ({ status: "rejected", code: "source_unavailable" });
const ineligible = (): DocumentSourceInspection => ({ status: "rejected", code: "document_not_eligible" });
let running = false;

/** No caller-selected executable, environment, path or in-process parser fallback. */
export async function inspectDocumentSource(input: {
  bytes: Uint8Array; mimeType: DocumentSourceMime; expectedSha256: string;
}, options: { signal: AbortSignal }): Promise<DocumentSourceInspection> {
  if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_BYTES
    || !["application/pdf", "image/jpeg", "image/png"].includes(input.mimeType)
    || !/^[a-f0-9]{64}$/.test(input.expectedSha256)) return ineligible();
  const bytes = Buffer.from(input.bytes), mimeType = input.mimeType, expectedSha256 = input.expectedSha256;
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) return ineligible();
  const signal = options?.signal;
  if (!(signal instanceof AbortSignal) || signal.aborted || process.platform !== "linux" || running) return unavailable();
  running = true;
  try {
    return await new Promise<DocumentSourceInspection>((resolve) => {
      const child = spawn(LAUNCHER, [], { cwd: "/", env: {}, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      const chunks: Buffer[] = []; let length = 0, stopped = false, settled = false;
      const stop = () => { stopped = true; child.kill("SIGKILL"); };
      const timer = setTimeout(stop, 16_000);
      const finish = (result: DocumentSourceInspection) => {
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
        if (length > 4096) stop(); else chunks.push(chunk);
      });
      child.on("close", (code) => {
        if (stopped || code !== 0) return finish(unavailable());
        try {
          const value: unknown = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value)) return finish(unavailable());
          const record = value as Record<string, unknown>;
          if (record.status === "rejected" && Object.keys(record).sort().join(",") === "code,status"
            && ["document_not_eligible", "source_unavailable"].includes(String(record.code))) {
            return finish(record.code === "document_not_eligible" ? ineligible() : unavailable());
          }
          if (Object.keys(record).sort().join(",") !== "byteLength,mimeType,pageCount,policyVersion,sha256,status"
            || record.status !== "verified" || record.sha256 !== expectedSha256 || record.byteLength !== bytes.length
            || record.mimeType !== mimeType || record.policyVersion !== "document-source-v1"
            || typeof record.pageCount !== "number" || !Number.isInteger(record.pageCount) || record.pageCount < 1
            || record.pageCount > (mimeType === "application/pdf" ? 20 : 1)) return finish(unavailable());
          finish({ status: "verified", sha256: expectedSha256, byteLength: bytes.length, mimeType,
            pageCount: record.pageCount, policyVersion: "document-source-v1" });
        } catch { finish(unavailable()); }
      });
      child.stdin.write(`${JSON.stringify({ byteLength: bytes.length, expectedSha256, mimeType })}\n`);
      child.stdin.end(bytes);
    });
  } catch { return unavailable(); }
  finally { running = false; }
}
