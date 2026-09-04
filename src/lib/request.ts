import type { NextRequest } from "next/server";

export async function readJsonObject(req: NextRequest, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Small legacy multipart consumers still use this helper. Private V2 document
// uploads deliberately do not: their route streams directly to private storage.
export async function readMultipartFormData(
  req: Request,
  maxBytes: number,
): Promise<{ formData: FormData } | { error: "invalid_multipart_request" | "request_too_large" }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return { error: "invalid_multipart_request" };
  }
  if (!req.body) return { error: "invalid_multipart_request" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Stop accepting bytes at the helper boundary. NextRequest-owned
        // multipart streams can emit a late close rejection after cancel(),
        // which turns a correct fail-closed result into an unhandled error.
        return { error: "request_too_large" };
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
    const parsedRequest = new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    return { formData: await parsedRequest.formData() };
  } catch {
    return { error: "invalid_multipart_request" };
  } finally {
    reader.releaseLock();
  }
}
