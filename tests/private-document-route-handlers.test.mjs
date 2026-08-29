import assert from "node:assert/strict";
import test from "node:test";

import {
  PRIVATE_DOCUMENT_MAX_BYTES,
  PrivateDocumentFileError,
} from "../src/lib/server/private-document-files.ts";
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
    assertCreateTargetWritable: async () => {},
    assertResubmitTargetWritable: async () => {},
    create: async () => metadata,
    resubmit: async () => ({ ...metadata, versionNumber: 2 }),
    download: async () => ({ metadata, bytes: Buffer.from(PDF_BYTES) }),
    multipartStorage: {
      async store({ originalFilename, declaredMimeType, chunks }) {
        const observedBytes = [];
        for await (const chunk of chunks) observedBytes.push(...chunk);
        return Object.freeze({
          originalFilename,
          declaredMimeType,
          objectKey: "10000000-0000-4000-8000-000000000099",
          byteLength: observedBytes.length,
          sha256: "b".repeat(64),
          observedBytes,
        });
      },
      async discard() {},
    },
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

function streamedFileRequest(fileChunkCount, finalFileBytes = new Uint8Array()) {
  const boundary = "evo-private-document-boundary";
  const encoder = new TextEncoder();
  const oneMiB = new Uint8Array(1024 * 1024);
  oneMiB.set(encoder.encode("%PDF-"), 0);
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="caseId"\r\n\r\n${CASE_ID}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="boundary.pdf"\r\n` +
        "Content-Type: application/pdf\r\n\r\n",
      ));
      for (let index = 0; index < fileChunkCount; index += 1) {
        controller.enqueue(oneMiB);
      }
      if (finalFileBytes.byteLength > 0) controller.enqueue(finalFileBytes);
      controller.enqueue(encoder.encode(`\r\n--${boundary}--\r\n`));
      controller.close();
    },
  });
  return new Request("http://local.test/api/v2/documents", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  });
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
  let storeCalls = 0;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    authorize: async () => ({ status: "forbidden", actor: null }),
    multipartStorage: {
      async store() {
        storeCalls += 1;
        throw new Error("storage must not be reached");
      },
      async discard() {},
    },
  }));
  await assertSafeError(await handler(validCreateRequest()), 403, "forbidden");
  assert.equal(storeCalls, 0);
});

test("upload validates the target before private storage receives file bytes", async () => {
  let storeCalls = 0;
  let createCalled = false;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    assertCreateTargetWritable: async ({ actorRole, caseId }) => {
      assert.equal(actorRole, "admissions");
      assert.equal(caseId, CASE_ID);
      throw new PrivateDocumentRepositoryError("not_found");
    },
    create: async () => {
      createCalled = true;
      return metadata;
    },
    multipartStorage: {
      async store() {
        storeCalls += 1;
        throw new Error("storage must not be reached");
      },
      async discard() {},
    },
  }));

  await assertSafeError(await handler(validCreateRequest()), 404, "document_not_found");
  assert.equal(storeCalls, 0);
  assert.equal(createCalled, false);
});

test("upload rejects file-first multipart without touching private storage", async () => {
  let targetChecks = 0;
  let storeCalls = 0;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    assertCreateTargetWritable: async () => {
      targetChecks += 1;
    },
    multipartStorage: {
      async store() {
        storeCalls += 1;
        throw new Error("storage must not be reached");
      },
      async discard() {},
    },
  }));

  const response = await handler(uploadRequest([
    ["file", new File([PDF_BYTES], "application.pdf", { type: "application/pdf" })],
    ["caseId", CASE_ID],
  ]));
  await assertSafeError(response, 400, "invalid_request");
  assert.equal(targetChecks, 0);
  assert.equal(storeCalls, 0);
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
  assert.equal(received.upload.originalFilename, "application.pdf");
  assert.equal(received.upload.declaredMimeType, "application/pdf");
  assert.deepEqual(received.upload.observedBytes, [...PDF_BYTES]);
  assert.equal("bytes" in received, false);
  const payload = await response.json();
  assert.deepEqual(payload, { document: metadata });
  assert.equal(JSON.stringify(payload).includes("objectKey"), false);
});

test("upload rejects unknown, duplicated, and client-controlled storage fields", async () => {
  let createCalls = 0;
  let discardCalls = 0;
  let storeCalls = 0;
  const baseStorage = dependencies().multipartStorage;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async () => {
      createCalls += 1;
      return metadata;
    },
    multipartStorage: {
      async store(input) {
        storeCalls += 1;
        return baseStorage.store(input);
      },
      discard: async () => {
        discardCalls += 1;
      },
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
  assert.equal(storeCalls, 2, "invalid parts before the file must not reach storage");
  assert.equal(discardCalls, 2, "invalid trailing parts must discard uncommitted objects");
});

test("upload maps traversal filenames to a stable invalid-request response", async () => {
  let createCalled = false;
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async () => {
      createCalled = true;
      return metadata;
    },
    multipartStorage: {
      store: async ({ originalFilename }) => {
        assert.equal(originalFilename, "../private.pdf");
        throw new PrivateDocumentFileError(
          "private_document_filename_invalid",
          "must not be returned",
        );
      },
      discard: async () => {},
    },
  }));
  const request = uploadRequest([
    ["caseId", CASE_ID],
    ["file", new File([PDF_BYTES], "../private.pdf", { type: "application/pdf" })],
  ]);

  await assertSafeError(await handler(request), 400, "invalid_request");
  assert.equal(createCalled, false);
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

test("upload rejects oversized streamed multipart bodies without a truthful content-length", async () => {
  const handler = createPrivateDocumentUploadHandler(dependencies({
    create: async () => assert.fail("oversized streamed body must not reach storage"),
  }));
  for (const contentLength of [null, "1"]) {
    const chunk = new Uint8Array(1024 * 1024);
    const chunkCount = Math.ceil((PRIVATE_DOCUMENT_MAX_BYTES + 64 * 1024 + 1) / chunk.byteLength);
    let emitted = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (emitted >= chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        emitted += 1;
      },
    });
    const headers = new Headers({
      "content-type": "multipart/form-data; boundary=streamed-body",
    });
    if (contentLength !== null) headers.set("content-length", contentLength);
    const response = await handler(new Request("http://local.test/api/v2/documents", {
      method: "POST",
      headers,
      body,
      duplex: "half",
    }));

    await assertSafeError(response, 413, "file_too_large");
  }
});

test("streamed multipart accepts exactly 25 MiB and rejects the first excess byte", async () => {
  let storedBytes = 0;
  let discardCalls = 0;
  const multipartStorage = {
    async store({ originalFilename, declaredMimeType, chunks }) {
      storedBytes = 0;
      for await (const chunk of chunks) storedBytes += chunk.byteLength;
      return Object.freeze({
        originalFilename,
        declaredMimeType,
        objectKey: "10000000-0000-4000-8000-000000000098",
        byteLength: storedBytes,
        sha256: "c".repeat(64),
      });
    },
    async discard() {
      discardCalls += 1;
    },
  };
  const handler = createPrivateDocumentUploadHandler(dependencies({
    multipartStorage,
    create: async (input) => {
      assert.equal(input.upload.byteLength, PRIVATE_DOCUMENT_MAX_BYTES);
      return metadata;
    },
  }));

  const accepted = await handler(streamedFileRequest(25));
  assert.equal(accepted.status, 201);
  assert.equal(storedBytes, PRIVATE_DOCUMENT_MAX_BYTES);

  await assertSafeError(
    await handler(streamedFileRequest(25, new Uint8Array([0]))),
    413,
    "file_too_large",
  );
  assert.equal(storedBytes, PRIVATE_DOCUMENT_MAX_BYTES + 1);
  assert.equal(discardCalls, 1);
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

  let storeCalls = 0;
  let resubmitCalled = false;
  const guessed = createPrivateDocumentResubmissionHandler(dependencies({
    assertResubmitTargetWritable: async ({ actorRole, documentId }) => {
      assert.equal(actorRole, "admissions");
      assert.equal(documentId, DOCUMENT_ID);
      throw new PrivateDocumentRepositoryError("not_found");
    },
    resubmit: async () => {
      resubmitCalled = true;
      return { ...metadata, versionNumber: 2 };
    },
    multipartStorage: {
      async store() {
        storeCalls += 1;
        throw new Error("storage must not be reached");
      },
      async discard() {},
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
  assert.equal(storeCalls, 0);
  assert.equal(resubmitCalled, false);
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
