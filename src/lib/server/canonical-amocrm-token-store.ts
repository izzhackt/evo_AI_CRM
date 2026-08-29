import "server-only";

import { constants } from "node:fs";
import {
  chmod,
  lstat,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

const MAX_TOKEN_FILE_BYTES = 16 * 1024;
const MIN_TOKEN_BYTES = 8;
const MAX_TOKEN_BYTES = 12 * 1024;
const MAX_EXPIRES_IN_SECONDS = 10 * 365 * 24 * 60 * 60;

export type CanonicalAmoCrmTokenSet = Readonly<{
  tokenType: "Bearer";
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}>;

export type CanonicalAmoCrmTokenFileErrorCode =
  | "missing"
  | "not_regular_file"
  | "unsafe_permissions"
  | "file_too_large"
  | "invalid_content"
  | "read_failed"
  | "rotation_failed";

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
  const tokenType = candidate.token_type;
  const accessToken = token(candidate.access_token);
  const refreshToken = token(candidate.refresh_token);
  const expiresInSeconds = candidate.expires_in;
  if (
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer" ||
    !accessToken ||
    !refreshToken ||
    !Number.isSafeInteger(expiresInSeconds) ||
    (expiresInSeconds as number) < 1 ||
    (expiresInSeconds as number) > MAX_EXPIRES_IN_SECONDS
  ) {
    throw new CanonicalAmoCrmTokenFileError("invalid_content");
  }

  return Object.freeze({
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    expiresInSeconds: expiresInSeconds as number,
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

function serializedToken(tokenSet: CanonicalAmoCrmTokenSet): string {
  const normalized = parseCanonicalAmoCrmTokenSet({
    token_type: tokenSet.tokenType,
    access_token: tokenSet.accessToken,
    refresh_token: tokenSet.refreshToken,
    expires_in: tokenSet.expiresInSeconds,
  });
  return `${JSON.stringify(
    {
      token_type: normalized.tokenType,
      access_token: normalized.accessToken,
      refresh_token: normalized.refreshToken,
      expires_in: normalized.expiresInSeconds,
    },
    null,
    2,
  )}\n`;
}

export async function rotateCanonicalAmoCrmTokenFile(
  tokenFilePath: string,
  tokenSet: CanonicalAmoCrmTokenSet,
): Promise<void> {
  const directoryPath = dirname(tokenFilePath);
  const temporaryPath = join(
    directoryPath,
    `.${basename(tokenFilePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporaryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    temporaryHandle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await temporaryHandle.writeFile(serializedToken(tokenSet), {
      encoding: "utf8",
    });
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, tokenFilePath);

    const directoryHandle = await open(directoryPath, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    await temporaryHandle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw new CanonicalAmoCrmTokenFileError("rotation_failed");
  }
}
