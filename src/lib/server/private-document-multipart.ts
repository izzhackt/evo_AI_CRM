import "server-only";

import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  PRIVATE_DOCUMENT_MAX_BYTES,
  removePrivateDocumentObject,
  storePrivateDocumentObject,
  type StoredPrivateDocumentUpload,
} from "./private-document-files.ts";

const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 64 * 1024;
export const PRIVATE_DOCUMENT_MAX_MULTIPART_BYTES =
  PRIVATE_DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_ALLOWANCE_BYTES;

type MultipartMode = "create" | "resubmit";

export type ParsedPrivateDocumentMultipart = Readonly<{
  caseId?: string;
  upload: StoredPrivateDocumentUpload;
}>;

export type PrivateDocumentMultipartResult =
  | Readonly<{ status: "ok"; value: ParsedPrivateDocumentMultipart }>
  | Readonly<{ status: "invalid_request" }>
  | Readonly<{ status: "request_too_large" }>;

export type PrivateDocumentMultipartStorage = Readonly<{
  store(input: Readonly<{
    originalFilename: unknown;
    declaredMimeType: unknown;
    chunks: AsyncIterable<Uint8Array>;
  }>): Promise<StoredPrivateDocumentUpload>;
  discard(upload: StoredPrivateDocumentUpload): Promise<void>;
}>;

export type PrivateDocumentMultipartTargetValidator = (
  input: Readonly<{ caseId: string }>,
) => Promise<void>;

export const defaultPrivateDocumentMultipartStorage: PrivateDocumentMultipartStorage = {
  store: storePrivateDocumentObject,
  discard: async (upload) => removePrivateDocumentObject(upload.objectKey),
};

class MultipartBodyTooLargeError extends Error {
  constructor() {
    super("Private document multipart body is too large");
    this.name = "MultipartBodyTooLargeError";
  }
}

function multipartContentLengthIsTooLarge(request: Request): boolean {
  const value = request.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return false;
  const length = Number(value);
  return (
    Number.isSafeInteger(length) &&
    length > PRIVATE_DOCUMENT_MAX_MULTIPART_BYTES
  );
}

function busboyHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

async function discardQuietly(
  storage: PrivateDocumentMultipartStorage,
  upload: StoredPrivateDocumentUpload | null,
): Promise<void> {
  if (upload === null) return;
  try {
    await storage.discard(upload);
  } catch {
    // The route still returns the original safe parsing error.
  }
}

export async function readPrivateDocumentMultipart(
  request: Request,
  mode: MultipartMode,
  storage: PrivateDocumentMultipartStorage = defaultPrivateDocumentMultipartStorage,
  validateCreateTarget?: PrivateDocumentMultipartTargetValidator,
): Promise<PrivateDocumentMultipartResult> {
  if (request.body === null || multipartContentLengthIsTooLarge(request)) {
    return {
      status: request.body === null ? "invalid_request" : "request_too_large",
    };
  }

  let parser;
  try {
    parser = Busboy({
      headers: busboyHeaders(request),
      preservePath: true,
      limits: {
        fieldNameSize: 64,
        fieldSize: 128,
        fields: mode === "create" ? 1 : 0,
        // Busboy marks a file truncated when it reaches (not exceeds) the
        // configured value. One sentinel byte keeps the exact 25 MiB boundary
        // valid while the storage writer remains the final byte authority.
        fileSize: PRIVATE_DOCUMENT_MAX_BYTES + 1,
        files: 1,
        // Busboy emits partsLimit when the configured count is reached, so
        // allow one sentinel part and reject when that sentinel is observed.
        parts: mode === "create" ? 3 : 2,
        headerPairs: 32,
      },
    });
  } catch {
    return { status: "invalid_request" };
  }

  let bodyBytes = 0;
  let invalid = false;
  let tooLarge = false;
  let fileSeen = false;
  let caseId: string | undefined;
  let storedUpload: StoredPrivateDocumentUpload | null = null;
  let storageError: unknown;
  let storePromise: Promise<void> | null = null;

  parser.on("file", (name, stream, info) => {
    if (
      name !== "file" ||
      fileSeen ||
      invalid ||
      (mode === "create" && caseId === undefined)
    ) {
      invalid = true;
      stream.resume();
      return;
    }
    fileSeen = true;
    stream.once("limit", () => {
      tooLarge = true;
    });
    storePromise = Promise.resolve()
      .then(async () => {
        if (mode === "create") {
          if (validateCreateTarget === undefined || caseId === undefined) {
            throw new Error("Private document create target validator is missing");
          }
          await validateCreateTarget({ caseId });
        }
        return storage.store({
          originalFilename: info.filename,
          declaredMimeType: info.mimeType,
          chunks: stream,
        });
      })
      .then((upload) => {
        storedUpload = upload;
      })
      .catch((error: unknown) => {
        storageError = error;
        stream.resume();
      });
  });

  parser.on("field", (name, value, info) => {
    if (
      mode !== "create" ||
      name !== "caseId" ||
      caseId !== undefined ||
      info.nameTruncated ||
      info.valueTruncated
    ) {
      invalid = true;
      return;
    }
    caseId = value;
  });
  parser.once("filesLimit", () => {
    invalid = true;
  });
  parser.once("fieldsLimit", () => {
    invalid = true;
  });
  parser.once("partsLimit", () => {
    invalid = true;
  });

  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      const chunkBytes =
        typeof chunk === "object" && chunk !== null && "byteLength" in chunk
          ? Number(chunk.byteLength)
          : 0;
      bodyBytes += chunkBytes;
      if (bodyBytes > PRIVATE_DOCUMENT_MAX_MULTIPART_BYTES) {
        callback(new MultipartBodyTooLargeError());
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    const source = Readable.from(
      request.body as unknown as AsyncIterable<Uint8Array>,
    );
    await pipeline(source, limiter, parser);
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) tooLarge = true;
    else invalid = true;
  }
  if (storePromise !== null) await storePromise;

  if (tooLarge) {
    await discardQuietly(storage, storedUpload);
    return { status: "request_too_large" };
  }
  if (storageError !== undefined) throw storageError;
  if (
    invalid ||
    !fileSeen ||
    storedUpload === null ||
    (mode === "create" && caseId === undefined) ||
    (mode === "resubmit" && caseId !== undefined)
  ) {
    await discardQuietly(storage, storedUpload);
    return { status: "invalid_request" };
  }

  return {
    status: "ok",
    value: {
      ...(caseId === undefined ? {} : { caseId }),
      upload: storedUpload,
    },
  };
}
