import "server-only";

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

const MAX_TOKEN_FILE_BYTES = 16 * 1024;
const MIN_TOKEN_BYTES = 8;
const MAX_TOKEN_BYTES = 12 * 1024;

export type CanonicalAmoCrmTokenSet = Readonly<{
  tokenType: "Bearer";
  accessToken: string;
}>;

export type CanonicalAmoCrmTokenFileErrorCode =
  | "missing"
  | "not_regular_file"
  | "unsafe_permissions"
  | "file_too_large"
  | "invalid_content"
  | "read_failed";

export class CanonicalAmoCrmTokenFileError extends Error {
  readonly code: CanonicalAmoCrmTokenFileErrorCode;

  constructor(code: CanonicalAmoCrmTokenFileErrorCode) {
    super("Canonical amoCRM token storage is unavailable.");
    this.name = "CanonicalAmoCrmTokenFileError";
    this.code = code;
  }
}

function token(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    bytes < MIN_TOKEN_BYTES ||
    bytes > MAX_TOKEN_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

export function parseCanonicalAmoCrmTokenSet(
  value: unknown,
): CanonicalAmoCrmTokenSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAmoCrmTokenFileError("invalid_content");
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "access_token" ||
    keys[1] !== "token_type"
  ) {
    throw new CanonicalAmoCrmTokenFileError("invalid_content");
  }
  const tokenType = candidate.token_type;
  const accessToken = token(candidate.access_token);
  if (
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer" ||
    !accessToken
  ) {
    throw new CanonicalAmoCrmTokenFileError("invalid_content");
  }

  return Object.freeze({
    tokenType: "Bearer",
    accessToken,
  });
}

function mapReadError(error: unknown): CanonicalAmoCrmTokenFileError {
  if (error instanceof CanonicalAmoCrmTokenFileError) return error;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    return new CanonicalAmoCrmTokenFileError("missing");
  }
  return new CanonicalAmoCrmTokenFileError("read_failed");
}

export async function readCanonicalAmoCrmTokenFile(
  tokenFilePath: string,
): Promise<CanonicalAmoCrmTokenSet> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const pathStats = await lstat(tokenFilePath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      throw new CanonicalAmoCrmTokenFileError("not_regular_file");
    }
    if ((pathStats.mode & 0o077) !== 0) {
      throw new CanonicalAmoCrmTokenFileError("unsafe_permissions");
    }
    if (pathStats.size > MAX_TOKEN_FILE_BYTES) {
      throw new CanonicalAmoCrmTokenFileError("file_too_large");
    }

    handle = await open(
      tokenFilePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const openedStats = await handle.stat();
    if (!openedStats.isFile()) {
      throw new CanonicalAmoCrmTokenFileError("not_regular_file");
    }
    if ((openedStats.mode & 0o077) !== 0) {
      throw new CanonicalAmoCrmTokenFileError("unsafe_permissions");
    }
    if (openedStats.size < 1 || openedStats.size > MAX_TOKEN_FILE_BYTES) {
      throw new CanonicalAmoCrmTokenFileError(
        openedStats.size > MAX_TOKEN_FILE_BYTES
          ? "file_too_large"
          : "invalid_content",
      );
    }

    const buffer = Buffer.alloc(MAX_TOKEN_FILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const next = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (next.bytesRead === 0) break;
      offset += next.bytesRead;
    }
    if (offset > MAX_TOKEN_FILE_BYTES) {
      throw new CanonicalAmoCrmTokenFileError("file_too_large");
    }
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, offset),
      );
    } catch {
      throw new CanonicalAmoCrmTokenFileError("invalid_content");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new CanonicalAmoCrmTokenFileError("invalid_content");
    }
    return parseCanonicalAmoCrmTokenSet(decoded);
  } catch (error) {
    throw mapReadError(error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
