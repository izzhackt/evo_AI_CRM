import "server-only";

/**
 * Reads a request body as UTF-8 JSON with a hard size cap and an overall deadline, streaming: the cap holds when
 * Content-Length is absent (chunked) or lies, and a slow sender cannot hold the connection past `deadlineMs`.
 * Throws on any violation; the caller answers one neutral 400.
 */
export async function readBoundedJsonBody(
  request: Request,
  limits: Readonly<{ maxBytes: number; deadlineMs: number }>,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limits.maxBytes)) {
    throw new Error("size");
  }
  if (!request.body) throw new Error("json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + limits.deadlineMs;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), Math.max(1, deadline - Date.now()));
        }),
      ]).finally(() => clearTimeout(timer));
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limits.maxBytes) throw new Error("size");
      chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
