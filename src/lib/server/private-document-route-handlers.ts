import "server-only";

import type { FixedRoleCapability } from "../fixed-role-policy.ts";
import type { PrivateDocumentAuthorization } from "./private-document-authorization.ts";
import {
  PrivateDocumentFileError,
  type StoredPrivateDocumentUpload,
} from "./private-document-files.ts";
import {
  defaultPrivateDocumentMultipartStorage,
  readPrivateDocumentMultipart,
  type PrivateDocumentMultipartStorage,
} from "./private-document-multipart.ts";
import {
  assertPrivateDocumentCreateTargetWritable,
  assertPrivateDocumentResubmitTargetWritable,
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

type DocumentCapability = Extract<
  FixedRoleCapability,
  "documents.read" | "documents.write"
>;

type CreateDocumentInput = Parameters<typeof createPrivateDocument>[0];
type ResubmitDocumentInput = Parameters<typeof resubmitPrivateDocument>[0];
type DownloadDocumentInput = Parameters<
  typeof downloadPrivateDocumentVersion
>[0];
type AssertCreateTargetWritableInput = Parameters<
  typeof assertPrivateDocumentCreateTargetWritable
>[0];
type AssertResubmitTargetWritableInput = Parameters<
  typeof assertPrivateDocumentResubmitTargetWritable
>[0];

export type PrivateDocumentRouteDependencies = Readonly<{
  authorize(
    capability: DocumentCapability,
  ): Promise<PrivateDocumentAuthorization>;
  assertCreateTargetWritable(
    input: AssertCreateTargetWritableInput,
  ): Promise<unknown>;
  assertResubmitTargetWritable(
    input: AssertResubmitTargetWritableInput,
  ): Promise<unknown>;
  create(
    input: CreateDocumentInput,
  ): Promise<PrivateDocumentVersionMetadata>;
  resubmit(
    input: ResubmitDocumentInput,
  ): Promise<PrivateDocumentVersionMetadata>;
  download(input: DownloadDocumentInput): Promise<PrivateDocumentDownload>;
  multipartStorage: PrivateDocumentMultipartStorage;
}>;

const defaultDependencies: PrivateDocumentRouteDependencies = {
  authorize: async (capability) => {
    const { authorizePrivateDocumentRequest } = await import(
      "./private-document-authorization.ts"
    );
    return authorizePrivateDocumentRequest(capability);
  },
  assertCreateTargetWritable: assertPrivateDocumentCreateTargetWritable,
  assertResubmitTargetWritable: assertPrivateDocumentResubmitTargetWritable,
  create: createPrivateDocument,
  resubmit: resubmitPrivateDocument,
  download: downloadPrivateDocumentVersion,
  multipartStorage: defaultPrivateDocumentMultipartStorage,
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

async function discardUploadQuietly(
  dependencies: PrivateDocumentRouteDependencies,
  upload: StoredPrivateDocumentUpload,
): Promise<void> {
  try {
    await dependencies.multipartStorage.discard(upload);
  } catch {
    // Preserve the original safe route error.
  }
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

    let parsed;
    try {
      parsed = await readPrivateDocumentMultipart(
        request,
        "create",
        dependencies.multipartStorage,
        async ({ caseId }) => {
          await dependencies.assertCreateTargetWritable({
            actorRole: authorization.actorRole,
            caseId,
          });
        },
      );
    } catch (error) {
      return repositoryErrorResponse(error, 400);
    }
    if (parsed.status === "request_too_large") {
      return errorResponse(413, "file_too_large");
    }
    if (parsed.status === "invalid_request") {
      return errorResponse(400, "invalid_request");
    }

    const caseId = parseUuid(parsed.value.caseId);
    if (!caseId) {
      await discardUploadQuietly(dependencies, parsed.value.upload);
      return errorResponse(400, "invalid_request");
    }

    try {
      const metadata = await dependencies.create({
        actorRole: authorization.actorRole,
        caseId,
        upload: parsed.value.upload,
      });
      return jsonResponse(201, metadata);
    } catch (error) {
      await discardUploadQuietly(dependencies, parsed.value.upload);
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

    try {
      await dependencies.assertResubmitTargetWritable({
        actorRole: authorization.actorRole,
        documentId,
      });
    } catch (error) {
      return repositoryErrorResponse(error, 404);
    }

    let parsed;
    try {
      parsed = await readPrivateDocumentMultipart(
        request,
        "resubmit",
        dependencies.multipartStorage,
      );
    } catch (error) {
      return repositoryErrorResponse(error, 404);
    }
    if (parsed.status === "request_too_large") {
      return errorResponse(413, "file_too_large");
    }
    if (parsed.status === "invalid_request") {
      return errorResponse(400, "invalid_request");
    }

    try {
      const metadata = await dependencies.resubmit({
        actorRole: authorization.actorRole,
        documentId,
        upload: parsed.value.upload,
      });
      return jsonResponse(201, metadata);
    } catch (error) {
      await discardUploadQuietly(dependencies, parsed.value.upload);
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
