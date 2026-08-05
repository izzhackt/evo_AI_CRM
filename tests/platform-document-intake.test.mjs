import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLATFORM_DOCUMENT_BUCKET,
  PLATFORM_DOCUMENT_MAX_BYTES,
  PlatformDocumentIntakeError,
  preparePlatformDocumentUpload,
  reservePlatformDocumentUpload,
  sha256PlatformDocumentBytes,
  uploadReservedPlatformDocument,
} from "../src/lib/platform-document-intake.ts";
import {
  createPlatformDocumentSignedDownload,
  finalizeAndQueuePlatformDocumentUpload,
} from "../src/lib/server/platform-document-intake-repository.ts";

const organizationId = "60000000-0000-4000-8000-000000000001";
const studentCaseId = "60000000-0000-4000-8000-000000000002";
const documentSlotId = "60000000-0000-4000-8000-000000000003";
const documentVersionId = "60000000-0000-4000-8000-000000000004";
const uploadReservationId = "60000000-0000-4000-8000-000000000005";
const reserveRequestId = "60000000-0000-4000-8000-000000000006";
const finalizeRequestId = "60000000-0000-4000-8000-000000000007";
const enqueueRequestId = "60000000-0000-4000-8000-000000000008";
const workItemId = "60000000-0000-4000-8000-000000000009";
const grantRequestId = "60000000-0000-4000-8000-00000000000a";
const consumeRequestId = "60000000-0000-4000-8000-00000000000b";
const grantId = "60000000-0000-4000-8000-00000000000c";
const consumptionId = "60000000-0000-4000-8000-00000000000d";
const objectName = `${"a1"}/${"b".repeat(62)}`;
const expiresAt = "2030-01-01T00:00:00.000Z";

function makeClient({ rpc, upload, createSignedUrl } = {}) {
  return {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        rpc(name, args) {
          return rpc?.(name, args) ?? Promise.resolve({ data: null, error: null });
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, PLATFORM_DOCUMENT_BUCKET);
        return {
          upload(path, bytes, options) {
            return (
              upload?.(path, bytes, options) ??
              Promise.resolve({ data: { path }, error: null })
            );
          },
          createSignedUrl(path, lifetime) {
            return (
              createSignedUrl?.(path, lifetime) ??
              Promise.resolve({
                data: { signedUrl: `http://127.0.0.1/storage/v1/object/sign/${path}` },
                error: null,
              })
            );
          },
        };
      },
    },
  };
}

async function fixture() {
  const bytes = new Blob(["%PDF-1.7\nsynthetic"], { type: "application/pdf" });
  const sha256Hex = await sha256PlatformDocumentBytes(bytes);
  const metadata = {
    organizationId,
    documentSlotId,
    originalFilename: "synthetic-profile.pdf",
    declaredMimeType: "application/pdf",
    byteSize: bytes.size,
    sha256Hex,
    requestId: reserveRequestId,
  };
  const reservation = {
    organization_id: organizationId,
    student_case_id: studentCaseId,
    document_slot_id: documentSlotId,
    document_version_id: documentVersionId,
    upload_reservation_id: uploadReservationId,
    bucket_id: PLATFORM_DOCUMENT_BUCKET,
    object_name: objectName,
    expires_at: expiresAt,
    declared_mime_type: "application/pdf",
    byte_size: bytes.size,
    sha256_hex: sha256Hex,
    storage_object_present: true,
    document_slot_published: false,
  };
  return { bytes, metadata, reservation };
}

test("prepares bounded upload metadata from the exact bytes", async () => {
  const { bytes, metadata } = await fixture();
  const prepared = await preparePlatformDocumentUpload({
    organizationId,
    documentSlotId,
    originalFilename: " synthetic-profile.pdf ",
    declaredMimeType: "APPLICATION/PDF",
    requestId: reserveRequestId,
    bytes,
  });

  assert.deepEqual(prepared.metadata, metadata);
  assert.equal(prepared.bytes, bytes);
  assert.match(prepared.metadata.sha256Hex, /^[0-9a-f]{64}$/);
});

test("rejects unsupported and oversized upload inputs before a reservation", async () => {
  await assert.rejects(
    preparePlatformDocumentUpload({
      organizationId,
      documentSlotId,
      originalFilename: "resume.docx",
      declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      requestId: reserveRequestId,
      bytes: new Blob(["docx"]),
    }),
    (error) =>
      error instanceof PlatformDocumentIntakeError &&
      error.code === "invalid_input",
  );

  await assert.rejects(
    sha256PlatformDocumentBytes(new ArrayBuffer(PLATFORM_DOCUMENT_MAX_BYTES + 1)),
    (error) =>
      error instanceof PlatformDocumentIntakeError &&
      error.code === "invalid_input",
  );
});

test("reserves the exact opaque Storage path and rejects malformed receipts", async () => {
  const { metadata, reservation } = await fixture();
  let seen;
  const client = makeClient({
    rpc(name, args) {
      seen = { name, args };
      return Promise.resolve({ data: reservation, error: null });
    },
  });

  const result = await reservePlatformDocumentUpload(client, metadata);
  assert.equal(seen.name, "reserve_document_upload");
  assert.equal(seen.args.p_sha256_hex, metadata.sha256Hex);
  assert.equal(result.objectName, objectName);
  assert.equal(result.bucketId, PLATFORM_DOCUMENT_BUCKET);

  await assert.rejects(
    reservePlatformDocumentUpload(
      makeClient({
        rpc: () => Promise.resolve({ data: { ...reservation, object_name: "student/name.pdf" }, error: null }),
      }),
      metadata,
    ),
    (error) =>
      error instanceof PlatformDocumentIntakeError &&
      error.code === "response_invalid",
  );
});

test("uploads only matching bytes to the reserved private object without upsert", async () => {
  const { bytes, reservation, metadata } = await fixture();
  const parsed = await reservePlatformDocumentUpload(
    makeClient({ rpc: () => Promise.resolve({ data: { ...reservation, storage_object_present: false }, error: null }) }),
    metadata,
  );
  let receipt;
  await uploadReservedPlatformDocument(
    makeClient({
      upload(path, body, options) {
        receipt = { path, body, options };
        return Promise.resolve({ data: { path }, error: null });
      },
    }),
    parsed,
    bytes,
  );
  assert.equal(receipt.path, objectName);
  assert.equal(receipt.body, bytes);
  assert.deepEqual(receipt.options, {
    cacheControl: "0",
    contentType: "application/pdf",
    upsert: false,
  });

  await assert.rejects(
    uploadReservedPlatformDocument(
      makeClient(),
      parsed,
      new Blob(["%PDF-1.7\nchanged"], { type: "application/pdf" }),
    ),
    (error) =>
      error instanceof PlatformDocumentIntakeError &&
      error.code === "invalid_input",
  );
});

test("replays authenticated ownership before service finalization and validation enqueue", async () => {
  const { metadata, reservation } = await fixture();
  const calls = [];
  const userClient = makeClient({
    rpc(name, args) {
      calls.push(["user", name, args]);
      return Promise.resolve({ data: reservation, error: null });
    },
  });
  const serviceClient = makeClient({
    rpc(name, args) {
      calls.push(["service", name, args]);
      if (name === "finalize_document_upload") {
        return Promise.resolve({
          data: {
            organization_id: organizationId,
            student_case_id: studentCaseId,
            document_slot_id: documentSlotId,
            document_version_id: documentVersionId,
            upload_reservation_id: uploadReservationId,
            bucket_id: PLATFORM_DOCUMENT_BUCKET,
            object_name: objectName,
            object_created_at: "2026-08-05T00:00:00.000Z",
            finalized_at: "2026-08-05T00:00:01.000Z",
            published_slot_status: "submitted",
            published_version_no: 1,
            document_slot_published: true,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          organization_id: organizationId,
          work_item_id: workItemId,
          kind: "document_validation",
          state: "queued",
          source_document_version_id: documentVersionId,
          deduplicated: false,
        },
        error: null,
      });
    },
  });

  const result = await finalizeAndQueuePlatformDocumentUpload({
    userClient,
    serviceClient,
    metadata,
    uploadReservationId,
    finalizeRequestId,
    enqueueRequestId,
  });

  assert.equal(result.validationWork.workItemId, workItemId);
  assert.deepEqual(calls.map(([owner, name]) => [owner, name]), [
    ["user", "reserve_document_upload"],
    ["service", "finalize_document_upload"],
    ["service", "enqueue_document_validation_work"],
  ]);
  assert.match(calls[2][2].p_business_key_sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls[2][2].p_document_version_id, documentVersionId);
});

test("does not invoke the service client for a different reservation", async () => {
  const { metadata, reservation } = await fixture();
  let serviceCalled = false;
  await assert.rejects(
    finalizeAndQueuePlatformDocumentUpload({
      userClient: makeClient({
        rpc: () => Promise.resolve({ data: reservation, error: null }),
      }),
      serviceClient: makeClient({
        rpc: () => {
          serviceCalled = true;
          return Promise.resolve({ data: null, error: null });
        },
      }),
      metadata,
      uploadReservationId: "60000000-0000-4000-8000-0000000000ff",
      finalizeRequestId,
      enqueueRequestId,
    }),
    (error) =>
      error instanceof PlatformDocumentIntakeError && error.code === "forbidden",
  );
  assert.equal(serviceCalled, false);
});

test("consumes an audited grant before signing one bounded private download", async () => {
  const calls = [];
  const userClient = makeClient({
    rpc(name, args) {
      calls.push(["user", name, args]);
      return Promise.resolve({
        data: {
          document_download_grant_id: grantId,
          expires_at: expiresAt,
          signed_url: null,
          storage_api_service_sign_required: true,
        },
        error: null,
      });
    },
  });
  const serviceClient = makeClient({
    rpc(name, args) {
      calls.push(["service", name, args]);
      return Promise.resolve({
        data: {
          organization_id: organizationId,
          student_case_id: studentCaseId,
          document_slot_id: documentSlotId,
          document_version_id: documentVersionId,
          document_download_grant_id: grantId,
          document_download_consumption_id: consumptionId,
          bucket_id: PLATFORM_DOCUMENT_BUCKET,
          object_name: objectName,
          max_signed_url_expires_in_seconds: 42,
          grant_expires_at: expiresAt,
        },
        error: null,
      });
    },
    createSignedUrl(path, lifetime) {
      calls.push(["service", "createSignedUrl", { path, lifetime }]);
      return Promise.resolve({
        data: { signedUrl: "http://127.0.0.1:54321/storage/v1/object/sign/redacted" },
        error: null,
      });
    },
  });

  const result = await createPlatformDocumentSignedDownload({
    userClient,
    serviceClient,
    organizationId,
    documentVersionId,
    accessPurpose: "Staff document review",
    grantRequestId,
    consumeRequestId,
  });
  assert.equal(result.grantId, grantId);
  assert.equal(result.consumptionId, consumptionId);
  assert.deepEqual(calls.map(([owner, name]) => [owner, name]), [
    ["user", "grant_document_download"],
    ["service", "consume_document_download_grant"],
    ["service", "createSignedUrl"],
  ]);
  assert.deepEqual(calls[2][2], { path: objectName, lifetime: 42 });
});

test("client-safe intake code contains no service credential references", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-document-intake.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /service[_-]?role|SUPABASE_SECRET|SUPABASE_SERVICE/i);
});

