import "server-only";

import type { FixedRoleCapability } from "../fixed-role-policy.ts";
import { readMultipartFormData } from "../request.ts";
import type { PrivateDocumentAuthorization } from "./private-document-authorization.ts";
import {
  PRIVATE_DOCUMENT_MAX_BYTES,
  PrivateDocumentFileError,
} from "./private-document-files.ts";
import {
  createPrivateDocument,
  downloadPrivateDocumentVersion,
  PrivateDocumentRepositoryError,
  resubmitPrivateDocument,
  type PrivateDocumentDownload,
  type PrivateDocumentVersionMetadata,
} from "./private-document-repository.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 64 * 1024;
const MAX_MULTIPART_BODY_BYTES =
  PRIVATE_DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_ALLOWANCE_BYTES;

type DocumentCapability = Extract<
  FixedRoleCapability,
  "documents.read" | "documents.write"
>;

type CreateDocumentInput = Parameters<typeof createPrivateDocument>[0];
type ResubmitDocumentInput = Parameters<typeof resubmitPrivateDocument>[0];
type DownloadDocumentInput = Parameters<
  typeof downloadPrivateDocumentVersion
>[0];

export type PrivateDocumentRouteDependencies = Readonly<{
  authorize(
    capability: DocumentCapability,
  ): Promise<PrivateDocumentAuthorization>;
  create(
    input: CreateDocumentInput,
  ): Promise<PrivateDocumentVersionMetadata>;
  resubmit(
    input: ResubmitDocumentInput,
  ): Promise<PrivateDocumentVersionMetadata>;
  download(input: DownloadDocumentInput): Promise<PrivateDocumentDownload>;
}>;

const defaultDependencies: PrivateDocumentRouteDependencies = {
  authorize: async (capability) => {
    const { authorizePrivateDocumentRequest } = await import(
      "./private-document-authorization.ts"
    );
    return authorizePrivateDocumentRequest(capability);
  },
  create: createPrivateDocument,
  resubmit: resubmitPrivateDocument,
  download: downloadPrivateDocumentVersion,
};

const RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

function errorResponse(
  status: 400 | 401 | 403 | 404 | 413 | 503,
  error:
    | "invalid_request"
    | "authentication_required"
    | "forbidden"
    | "document_not_found"
    | "file_too_large"
    | "document_storage_unavailable",
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: RESPONSE_HEADERS,
    },
  );
}

function jsonResponse(
  status: 201,
  metadata: PrivateDocumentVersionMetadata,
): Response {
  return Response.json({ document: metadata }, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  const normalized = value.toLowerCase();
  return normalized === NIL_UUID ? null : normalized;
}

function isMultipartRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return (
    contentType !== null &&
    /^multipart\/form-data\s*;/i.test(contentType) &&
    /(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)(?:;|$)/i.test(contentType)
  );
}

function multipartBodyIsTooLarge(request: Request): boolean {
  const value = request.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return false;
  const length = Number(value);
  return Number.isSafeInteger(length) && length > MAX_MULTIPART_BODY_BYTES;
}

type ParsedUpload = Readonly<{
  originalFilename: string;
  declaredMimeType: string;
  bytes: Uint8Array;
}>;

type ParsedCreateUpload = ParsedUpload & Readonly<{ caseId: string }>;

async function readExactMultipartFields(
  request: Request,
  expectedNames: ReadonlySet<string>,
): Promise<Map<string, FormDataEntryValue> | null> {
  if (!isMultipartRequest(request)) return null;

  const parsed = await readMultipartFormData(request, MAX_MULTIPART_BODY_BYTES);
  if ("error" in parsed) {
    if (parsed.error === "request_too_large") {
      throw new PrivateDocumentFileError(
        "private_document_bytes_too_large",
        "Private document request exceeds the allowed size",
      );
    }
    return null;
  }
  const formData = parsed.formData;

  const entries = new Map<string, FormDataEntryValue>();
  for (const [name, value] of formData.entries()) {
    if (!expectedNames.has(name) || entries.has(name)) return null;
    entries.set(name, value);
  }
  if (entries.size !== expectedNames.size) return null;
  return entries;
}

async function readUpload(value: FormDataEntryValue): Promise<ParsedUpload | null> {
  if (typeof value === "string") return null;
  if (value.size > PRIVATE_DOCUMENT_MAX_BYTES) {
    throw new PrivateDocumentFileError(
      "private_document_bytes_too_large",
      "Private document exceeds the allowed size",
    );
  }

  return {
    originalFilename: value.name,
    declaredMimeType: value.type,
    bytes: new Uint8Array(await value.arrayBuffer()),
  };
}

async function parseCreateUpload(request: Request): Promise<ParsedCreateUpload | null> {
  const entries = await readExactMultipartFields(
    request,
    new Set(["caseId", "file"]),
  );
  if (!entries) return null;

  const caseId = entries.get("caseId");
  const file = entries.get("file");
  if (typeof caseId !== "string" || file === undefined) return null;
  const upload = await readUpload(file);
  if (!upload) return null;
  const normalizedCaseId = parseUuid(caseId);
  if (!normalizedCaseId) return null;
  return { caseId: normalizedCaseId, ...upload };
}

async function parseResubmission(request: Request): Promise<ParsedUpload | null> {
  const entries = await readExactMultipartFields(request, new Set(["file"]));
  if (!entries) return null;
  const file = entries.get("file");
  return file === undefined ? null : readUpload(file);
}

async function authorize(
  dependencies: PrivateDocumentRouteDependencies,
  capability: DocumentCapability,
): Promise<
  | Readonly<{ actorRole: CreateDocumentInput["actorRole"] }>
  | Response
> {
  let authorization: PrivateDocumentAuthorization;
  try {
    authorization = await dependencies.authorize(capability);
  } catch {
    return errorResponse(503, "document_storage_unavailable");
  }
  if (authorization.status === "anonymous") {
    return errorResponse(401, "authentication_required");
  }
  if (authorization.status === "forbidden" || authorization.actor === null) {
    return errorResponse(403, "forbidden");
  }
  return { actorRole: authorization.actor.platformRole };
}

function repositoryErrorResponse(
  error: unknown,
  invalidInputStatus: 400 | 404,
): Response {
  if (error instanceof PrivateDocumentRepositoryError) {
    if (error.code === "invalid_input") {
      return errorResponse(
        invalidInputStatus,
        invalidInputStatus === 404 ? "document_not_found" : "invalid_request",
      );
    }
    if (error.code === "not_found") {
      return errorResponse(404, "document_not_found");
    }
    return errorResponse(503, "document_storage_unavailable");
  }
  if (error instanceof PrivateDocumentFileError) {
    if (error.code === "private_document_bytes_too_large") {
      return errorResponse(413, "file_too_large");
    }
    if (
      error.code === "private_document_filename_invalid" ||
      error.code === "private_document_mime_invalid" ||
      error.code === "private_document_bytes_empty" ||
      error.code === "private_document_content_mismatch"
    ) {
      return errorResponse(400, "invalid_request");
    }
    return errorResponse(503, "document_storage_unavailable");
  }
  return errorResponse(503, "document_storage_unavailable");
}

function encodeRfc5987Filename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(filename: string): string {
  const asciiFilename =
    filename
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "document";
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRfc5987Filename(filename)}`;
}

export function createPrivateDocumentUploadHandler(
  dependencies: PrivateDocumentRouteDependencies = defaultDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = await authorize(dependencies, "documents.write");
    if (authorization instanceof Response) return authorization;
    if (multipartBodyIsTooLarge(request)) {
      return errorResponse(413, "file_too_large");
    }

    let upload: ParsedCreateUpload | null;
    try {
      upload = await parseCreateUpload(request);
    } catch (error) {
      return repositoryErrorResponse(error, 400);
    }
    if (!upload) return errorResponse(400, "invalid_request");

    try {
      const metadata = await dependencies.create({
        actorRole: authorization.actorRole,
        ...upload,
      });
      return jsonResponse(201, metadata);
    } catch (error) {
      return repositoryErrorResponse(error, 400);
    }
  };
}

export function createPrivateDocumentResubmissionHandler(
  dependencies: PrivateDocumentRouteDependencies = defaultDependencies,
): (
  request: Request,
  context: Readonly<{ params: Promise<{ documentId: string }> }>,
) => Promise<Response> {
  return async (request, context) => {
    const authorization = await authorize(dependencies, "documents.write");
    if (authorization instanceof Response) return authorization;

    const documentId = parseUuid((await context.params).documentId);
    if (!documentId) return errorResponse(404, "document_not_found");
    if (multipartBodyIsTooLarge(request)) {
      return errorResponse(413, "file_too_large");
    }

    let upload: ParsedUpload | null;
    try {
      upload = await parseResubmission(request);
    } catch (error) {
      return repositoryErrorResponse(error, 404);
    }
    if (!upload) return errorResponse(400, "invalid_request");

    try {
      const metadata = await dependencies.resubmit({
        actorRole: authorization.actorRole,
        documentId,
        ...upload,
      });
      return jsonResponse(201, metadata);
    } catch (error) {
      return repositoryErrorResponse(error, 404);
    }
  };
}

export function createPrivateDocumentDownloadHandler(
  dependencies: PrivateDocumentRouteDependencies = defaultDependencies,
): (
  request: Request,
  context: Readonly<{ params: Promise<{ versionId: string }> }>,
) => Promise<Response> {
  return async (_request, context) => {
    const authorization = await authorize(dependencies, "documents.read");
    if (authorization instanceof Response) return authorization;

    const versionId = parseUuid((await context.params).versionId);
    if (!versionId) return errorResponse(404, "document_not_found");

    let download: PrivateDocumentDownload;
    try {
      download = await dependencies.download({
        actorRole: authorization.actorRole,
        versionId,
      });
    } catch (error) {
      return repositoryErrorResponse(error, 404);
    }

    return new Response(new Uint8Array(download.bytes), {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        "content-disposition": contentDisposition(
          download.metadata.originalFilename,
        ),
        "content-length": String(download.metadata.byteLength),
        "content-type": download.metadata.declaredMimeType,
        etag: `"${download.metadata.sha256}"`,
      },
    });
  };
}
