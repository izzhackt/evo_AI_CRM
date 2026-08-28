import "server-only";

import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const PRIVATE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export type PrivateDocumentMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export type PrivateDocumentFileErrorCode =
  | "private_document_root_missing"
  | "private_document_root_invalid"
  | "private_document_storage_unavailable"
  | "private_document_filename_invalid"
  | "private_document_mime_invalid"
  | "private_document_bytes_empty"
  | "private_document_bytes_too_large"
  | "private_document_content_mismatch"
  | "private_document_prepared_file_invalid"
  | "private_document_object_key_invalid"
  | "private_document_object_exists"
  | "private_document_object_missing"
  | "private_document_object_unsafe"
  | "private_document_integrity_invalid";

export class PrivateDocumentFileError extends Error {
  readonly code: PrivateDocumentFileErrorCode;

  constructor(code: PrivateDocumentFileErrorCode, message: string) {
    super(message);
    this.name = "PrivateDocumentFileError";
    this.code = code;
  }
}

export type PreparedPrivateDocumentFile = Readonly<{
  originalFilename: string;
  declaredMimeType: PrivateDocumentMimeType;
  byteLength: number;
  sha256: string;
}>;

export type StoredPrivateDocumentObject = Readonly<{
  objectKey: string;
  byteLength: number;
  sha256: string;
}>;

export type PrivateDocumentObjectRead = Readonly<{
  objectKey: string;
  expectedByteLength: number;
  expectedSha256: string;
}>;

type PreparedState = Readonly<{
  objectKey: string;
  bytes: Buffer;
}>;

const preparedStates = new WeakMap<PreparedPrivateDocumentFile, PreparedState>();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const SUPPORTED_MIME_TYPES = new Set<PrivateDocumentMimeType>([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function fileError(
  code: PrivateDocumentFileErrorCode,
  message: string,
): PrivateDocumentFileError {
  return new PrivateDocumentFileError(code, message);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
  );
}

async function existingRealPath(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

async function requireObjectsDirectory(): Promise<string> {
  const configured = process.env.EVO_PRIVATE_DOCUMENT_ROOT;
  if (configured === undefined || configured.length === 0) {
    throw fileError(
      "private_document_root_missing",
      "Private document storage is not configured",
    );
  }
  if (configured.trim().length === 0 || configured !== configured.trim() || !isAbsolute(configured)) {
    throw fileError(
      "private_document_root_invalid",
      "Private document storage configuration is invalid",
    );
  }

  const configuredRoot = resolve(configured);
  let rootInfo;
  try {
    rootInfo = await lstat(configuredRoot);
  } catch {
    throw fileError(
      "private_document_root_invalid",
      "Private document storage configuration is invalid",
    );
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw fileError(
      "private_document_root_invalid",
      "Private document storage configuration is invalid",
    );
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(configuredRoot);
  } catch {
    throw fileError(
      "private_document_root_invalid",
      "Private document storage configuration is invalid",
    );
  }

  const repositoryRoot = resolve(/* turbopackIgnore: true */ process.cwd());
  const canonicalRepositoryRoot = (await existingRealPath(repositoryRoot)) ?? repositoryRoot;
  const forbiddenRoots = [
    resolve(repositoryRoot, "public"),
    resolve(repositoryRoot, "static"),
    resolve(repositoryRoot, ".next", "static"),
    resolve(canonicalRepositoryRoot, "public"),
    resolve(canonicalRepositoryRoot, "static"),
    resolve(canonicalRepositoryRoot, ".next", "static"),
  ];
  for (const forbiddenRoot of forbiddenRoots) {
    if (
      pathIsWithin(forbiddenRoot, configuredRoot) ||
      pathIsWithin(forbiddenRoot, canonicalRoot)
    ) {
      throw fileError(
        "private_document_root_invalid",
        "Private document storage configuration is invalid",
      );
    }
  }

  const objectsDirectory = join(canonicalRoot, "objects");
  try {
    await mkdir(objectsDirectory, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw fileError(
        "private_document_storage_unavailable",
        "Private document storage is unavailable",
      );
    }
  }

  let objectsInfo;
  let canonicalObjectsDirectory: string;
  try {
    objectsInfo = await lstat(objectsDirectory);
    canonicalObjectsDirectory = await realpath(objectsDirectory);
  } catch {
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }
  if (
    !objectsInfo.isDirectory() ||
    objectsInfo.isSymbolicLink() ||
    canonicalObjectsDirectory !== objectsDirectory
  ) {
    throw fileError(
      "private_document_root_invalid",
      "Private document storage configuration is invalid",
    );
  }

  try {
    await chmod(objectsDirectory, 0o700);
  } catch {
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }
  return objectsDirectory;
}

function validateOriginalFilename(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    Array.from(value).length > 255 ||
    value.includes("/") ||
    value.includes("\\") ||
    /^\.+$/u.test(value) ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw fileError(
      "private_document_filename_invalid",
      "Private document filename is invalid",
    );
  }
  return value;
}

function validateMimeType(value: unknown): PrivateDocumentMimeType {
  if (typeof value !== "string" || !SUPPORTED_MIME_TYPES.has(value as PrivateDocumentMimeType)) {
    throw fileError(
      "private_document_mime_invalid",
      "Private document MIME type is invalid",
    );
  }
  return value as PrivateDocumentMimeType;
}

function validateBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw fileError(
      "private_document_bytes_empty",
      "Private document bytes are required",
    );
  }
  if (value.byteLength === 0) {
    throw fileError(
      "private_document_bytes_empty",
      "Private document bytes are required",
    );
  }
  if (value.byteLength > PRIVATE_DOCUMENT_MAX_BYTES) {
    throw fileError(
      "private_document_bytes_too_large",
      "Private document exceeds the allowed size",
    );
  }
  return Buffer.from(value);
}

function bytesMatchMimeType(bytes: Buffer, mimeType: PrivateDocumentMimeType): boolean {
  if (mimeType === "application/pdf") {
    return bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"));
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

export function preparePrivateDocumentFile(input: {
  originalFilename: unknown;
  declaredMimeType: unknown;
  bytes: unknown;
}): PreparedPrivateDocumentFile {
  const originalFilename = validateOriginalFilename(input.originalFilename);
  const declaredMimeType = validateMimeType(input.declaredMimeType);
  const bytes = validateBytes(input.bytes);
  if (!bytesMatchMimeType(bytes, declaredMimeType)) {
    throw fileError(
      "private_document_content_mismatch",
      "Private document content does not match its MIME type",
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const prepared = Object.freeze({
    originalFilename,
    declaredMimeType,
    byteLength: bytes.length,
    sha256,
  });
  preparedStates.set(prepared, Object.freeze({ objectKey: randomUUID(), bytes }));
  return prepared;
}

function requirePreparedState(prepared: PreparedPrivateDocumentFile): PreparedState {
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    throw fileError(
      "private_document_prepared_file_invalid",
      "Prepared private document is invalid",
    );
  }
  return state;
}

async function removeCreatedObject(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw fileError(
        "private_document_storage_unavailable",
        "Private document storage is unavailable",
      );
    }
  }
}

export async function writePrivateDocumentObject(
  prepared: PreparedPrivateDocumentFile,
): Promise<StoredPrivateDocumentObject> {
  const state = requirePreparedState(prepared);
  const objectsDirectory = await requireObjectsDirectory();
  const objectPath = join(objectsDirectory, state.objectKey);
  let handle;
  try {
    handle = await open(objectPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw fileError(
        "private_document_object_exists",
        "Private document object already exists",
      );
    }
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }

  let writeComplete = false;
  try {
    await handle.chmod(0o600);
    let offset = 0;
    while (offset < state.bytes.length) {
      const result = await handle.write(
        state.bytes,
        offset,
        state.bytes.length - offset,
        offset,
      );
      if (result.bytesWritten <= 0) {
        throw fileError(
          "private_document_storage_unavailable",
          "Private document storage is unavailable",
        );
      }
      offset += result.bytesWritten;
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    writeComplete = true;
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The exclusive object is still removed below.
      }
    }
    await removeCreatedObject(objectPath);
    if (error instanceof PrivateDocumentFileError) throw error;
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }

  if (!writeComplete) {
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }
  return Object.freeze({
    objectKey: state.objectKey,
    byteLength: prepared.byteLength,
    sha256: prepared.sha256,
  });
}

function validateObjectKey(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw fileError(
      "private_document_object_key_invalid",
      "Private document object key is invalid",
    );
  }
  return value;
}

function validateExpectedIntegrity(input: PrivateDocumentObjectRead): void {
  if (
    !Number.isSafeInteger(input.expectedByteLength) ||
    input.expectedByteLength <= 0 ||
    input.expectedByteLength > PRIVATE_DOCUMENT_MAX_BYTES ||
    !SHA256.test(input.expectedSha256)
  ) {
    throw fileError(
      "private_document_integrity_invalid",
      "Private document integrity metadata is invalid",
    );
  }
}

export async function readPrivateDocumentObject(
  input: PrivateDocumentObjectRead,
): Promise<Buffer> {
  const objectKey = validateObjectKey(input.objectKey);
  validateExpectedIntegrity(input);
  const objectsDirectory = await requireObjectsDirectory();
  const objectPath = join(objectsDirectory, objectKey);
  let handle;
  try {
    handle = await open(objectPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw fileError(
        "private_document_object_missing",
        "Private document object is unavailable",
      );
    }
    if (["ELOOP", "EISDIR"].includes(errorCode(error) ?? "")) {
      throw fileError(
        "private_document_object_unsafe",
        "Private document object is unsafe",
      );
    }
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }

  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw fileError(
        "private_document_object_unsafe",
        "Private document object is unsafe",
      );
    }
    if (info.size !== input.expectedByteLength || info.size > PRIVATE_DOCUMENT_MAX_BYTES) {
      throw fileError(
        "private_document_integrity_invalid",
        "Private document integrity verification failed",
      );
    }
    const bytes = await handle.readFile();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== input.expectedByteLength || sha256 !== input.expectedSha256) {
      throw fileError(
        "private_document_integrity_invalid",
        "Private document integrity verification failed",
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof PrivateDocumentFileError) throw error;
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  } finally {
    try {
      await handle.close();
    } catch {
      throw fileError(
        "private_document_storage_unavailable",
        "Private document storage is unavailable",
      );
    }
  }
}

export async function removePrivateDocumentObject(objectKeyValue: unknown): Promise<void> {
  const objectKey = validateObjectKey(objectKeyValue);
  const objectsDirectory = await requireObjectsDirectory();
  const objectPath = join(objectsDirectory, objectKey);
  let info;
  try {
    info = await lstat(objectPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw fileError(
      "private_document_object_unsafe",
      "Private document object is unsafe",
    );
  }
  try {
    await unlink(objectPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw fileError(
      "private_document_storage_unavailable",
      "Private document storage is unavailable",
    );
  }
}
