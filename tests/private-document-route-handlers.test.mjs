import assert from "node:assert/strict";
import test from "node:test";

import { PrivateDocumentFileError } from "../src/lib/server/private-document-files.ts";
import { PrivateDocumentRepositoryError } from "../src/lib/server/private-document-repository.ts";
import {
  createPrivateDocumentDownloadHandler,
  createPrivateDocumentResubmissionHandler,
  createPrivateDocumentUploadHandler,
} from "../src/lib/server/private-document-route-handlers.ts";

const DOCUMENT_ID = "10000000-0000-4000-8000-000000000001";
const VERSION_ID = "10000000-0000-4000-8000-000000000002";
const CASE_ID = "10000000-0000-4000-8000-000000000003";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nprivate-document\n");

const metadata = Object.freeze({
  documentId: DOCUMENT_ID,
  caseId: CASE_ID,
  versionId: VERSION_ID,
  versionNumber: 1,
  originalFilename: "application.pdf",
  declaredMimeType: "application/pdf",
  byteLength: PDF_BYTES.byteLength,
  sha256: "a".repeat(64),
  createdAt: "2026-08-28T12:00:00.000Z",
});

function authorized(role = "admissions") {
  return {
    status: "authorized",
    actor: {
      authUserId: "10000000-0000-4000-8000-000000000101",
      profileId: "10000000-0000-4000-8000-000000000201",
      membershipId: "10000000-0000-4000-8000-000000000301",
      organizationId: "10000000-0000-4000-8000-000000000401",
      displayName: "Development role",
      platformRole: role,
      authorityRole: role,
      platformAccessVersion: 1,
      platformBundleId: "10000000-0000-4000-8000-000000000501",
      platformBundleVersion: 1,
    },
  };
}

function dependencies(overrides = {}) {
  return {
    authorize: async () => authorized(),
    create: async () => metadata,
    resubmit: async () => ({ ...metadata, versionNumber: 2 }),
    download: async () => ({ metadata, bytes: Buffer.from(PDF_BYTES) }),
    ...overrides,
  };
}

function uploadRequest(entries) {
  const formData = new FormData();
  for (const [name, value] of entries) formData.append(name, value);
  return new Request("http://local.test/api/v2/documents", {
    method: "POST",
    body: formData,
  });
}

function validCreateRequest() {
  return uploadRequest([
    ["caseId", CASE_ID],
    ["file", new File([PDF_BYTES], "application.pdf", { type: "application/pdf" })],
  ]);
}

async function assertSafeError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { error: code });
}

test("upload authenticates before reading the multipart body", async () => {
  let createCalled = false;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    authorize: async () => ({ status: "anonymous", actor: null }),
    create: async () => {
      createCalled = true;
      return metadata;
    },
  }));

  const response = await handler(new Request("http://local.test/api/v2/documents", {
    method: "POST",
    body: "not multipart",
  }));

  await assertSafeError(response, 401, "authentication_required");
  assert.equal(createCalled, false);
});

test("upload returns 403 for a role rejected by server authorization", async () => {
  const handler = createPrivateDocumentUploadHandler(dependencies({
    authorize: async () => ({ status: "forbidden", actor: null }),
  }));
  await assertSafeError(await handler(validCreateRequest()), 403, "forbidden");
});

test("upload accepts only caseId and file and never exposes a storage key", async () => {
  let received;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async (input) => {
      received = input;
      return metadata;
    },
  }));

  const response = await handler(validCreateRequest());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(received.actorRole, "admissions");
  assert.equal(received.caseId, CASE_ID);
  assert.equal(received.originalFilename, "application.pdf");
  assert.equal(received.declaredMimeType, "application/pdf");
  assert.deepEqual(received.bytes, PDF_BYTES);
  const payload = await response.json();
  assert.deepEqual(payload, { document: metadata });
  assert.equal(JSON.stringify(payload).includes("objectKey"), false);
});

test("upload rejects unknown, duplicated, and client-controlled storage fields", async () => {
  let createCalls = 0;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async () => {
      createCalls += 1;
      return metadata;
    },
  }));
  const file = new File([PDF_BYTES], "application.pdf", { type: "application/pdf" });

  const requests = [
    uploadRequest([["caseId", CASE_ID], ["file", file], ["objectKey", "chosen/by/client"]]),
    uploadRequest([["caseId", CASE_ID], ["caseId", CASE_ID], ["file", file]]),
    uploadRequest([["caseId", CASE_ID], ["file", file], ["file", file]]),
  ];
  for (const request of requests) {
    await assertSafeError(await handler(request), 400, "invalid_request");
  }
  assert.equal(createCalls, 0);
});

test("upload maps traversal filenames to a stable invalid-request response", async () => {
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async () => {
      throw new PrivateDocumentFileError(
        "private_document_filename_invalid",
        "must not be returned",
      );
    },
  }));
  const request = uploadRequest([
    ["caseId", CASE_ID],
    ["file", new File([PDF_BYTES], "../private.pdf", { type: "application/pdf" })],
  ]);

  await assertSafeError(await handler(request), 400, "invalid_request");
});

test("upload rejects an obviously oversized multipart body before parsing it", async () => {
  const handler = createPrivateDocumentUploadHandler(dependencies());
  const response = await handler(new Request("http://local.test/api/v2/documents", {
    method: "POST",
    headers: {
      "content-length": String(25 * 1024 * 1024 + 64 * 1024 + 1),
      "content-type": "multipart/form-data; boundary=not-read",
    },
    body: "ignored",
  }));
  await assertSafeError(response, 413, "file_too_large");
});

test("resubmission returns a safe 404 for malformed and guessed document IDs", async () => {
  const malformed = createPrivateDocumentResubmissionHandler(dependencies());
  await assertSafeError(
    await malformed(
      uploadRequest([["file", new File([PDF_BYTES], "new.pdf", { type: "application/pdf" })]]),
      { params: Promise.resolve({ documentId: "../../etc/passwd" }) },
    ),
    404,
    "document_not_found",
  );

  const guessed = createPrivateDocumentResubmissionHandler(dependencies({
    resubmit: async () => {
      throw new PrivateDocumentRepositoryError("not_found");
    },
  }));
  await assertSafeError(
    await guessed(
      uploadRequest([["file", new File([PDF_BYTES], "new.pdf", { type: "application/pdf" })]]),
      { params: Promise.resolve({ documentId: DOCUMENT_ID }) },
    ),
    404,
    "document_not_found",
  );
});

test("download returns exact bytes with safe non-cacheable attachment headers", async () => {
  const filename = 'résumé "final".pdf';
  const handler = createPrivateDocumentDownloadHandler(dependencies({
    download: async () => ({
      metadata: { ...metadata, originalFilename: filename },
      bytes: Buffer.from(PDF_BYTES),
    }),
  }));
  const response = await handler(
    new Request(`http://local.test/api/v2/document-versions/${VERSION_ID}/download`),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(PDF_BYTES.byteLength));
  assert.equal(response.headers.get("etag"), `"${metadata.sha256}"`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-disposition"),
    /^attachment; filename="r_sum_ _final_\.pdf"; filename\*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22\.pdf$/,
  );
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PDF_BYTES);
});

test("download maps missing objects and integrity failures to unavailable", async () => {
  for (const code of [
    "private_document_object_missing",
    "private_document_integrity_invalid",
  ]) {
    const handler = createPrivateDocumentDownloadHandler(dependencies({
      download: async () => {
        throw new PrivateDocumentFileError(code, "must not be returned");
      },
    }));
    await assertSafeError(
      await handler(
        new Request(`http://local.test/api/v2/document-versions/${VERSION_ID}/download`),
        { params: Promise.resolve({ versionId: VERSION_ID }) },
      ),
      503,
      "document_storage_unavailable",
    );
  }
});
