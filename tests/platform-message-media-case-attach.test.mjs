import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ClamdScanError } from "../src/lib/server/clamd-malware-scanner.ts";
import {
  attachPlatformMessageMediaToCase,
  STANDARD_UPLOAD_MAX_BYTES,
  TUS_CHUNK_BYTES,
} from "../src/lib/server/platform-media-attach.ts";

const actionSource = readFileSync(
  new URL("../src/lib/platform-media-attach-actions.ts", import.meta.url),
  "utf8",
);
const serverSource = readFileSync(
  new URL("../src/lib/server/platform-media-attach.ts", import.meta.url),
  "utf8",
);

const IDS = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  foreignOrganization: "12121212-1212-4212-8212-121212121212",
  authUser: "22222222-2222-4222-8222-222222222222",
  conversation: "33333333-3333-4333-8333-333333333333",
  media: "44444444-4444-4444-8444-444444444444",
  studentCase: "55555555-5555-4555-8555-555555555555",
  documentSlot: "66666666-6666-4666-8666-666666666666",
  request: "77777777-7777-4777-8777-777777777777",
  grantRequest: "88888888-8888-4888-8888-888888888888",
  consumptionRequest: "99999999-9999-4999-8999-999999999999",
  grantRequestRetry: "81818181-8181-4181-8181-818181818181",
  consumptionRequestRetry: "91919191-9191-4191-8191-919191919191",
  attachmentIntent: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  mediaGrant: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  replayedMediaGrant: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc",
  documentVersion: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  uploadReservation: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  otherUploadReservation: "dededede-dede-4ded-8ded-dededededede",
  storageBinding: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  attachmentCompletion: "f1111111-1111-4111-8111-111111111111",
  uploadFinalization: "f2222222-2222-4222-8222-222222222222",
  malwareAttestation: "f3333333-3333-4333-8333-333333333333",
  completionRequest: "f4444444-4444-4444-8444-444444444444",
});

const ACTOR = Object.freeze({
  organizationId: IDS.organization,
  authUserId: IDS.authUser,
});
const INPUT = Object.freeze({
  conversationId: IDS.conversation,
  communicationMediaId: IDS.media,
  studentCaseId: IDS.studentCase,
  documentSlotId: IDS.documentSlot,
  requestId: IDS.request,
});

const MEDIA_OBJECT_NAME = `ab/${"c".repeat(62)}`;
const DOCUMENT_OBJECT_NAME = `de/${"f".repeat(62)}`;
const MIME_TYPE = "application/pdf";
const FILE_NAME = "passport-from-whatsapp.pdf";
const NOW_MS = Date.parse("2026-09-06T10:00:00.000Z");
const FUTURE_EXPIRY = "2026-09-06T11:00:00.000Z";
const PAST_EXPIRY = "2026-09-06T09:59:59.999Z";
const SCANNED_AT = "2026-09-06T10:00:01.000Z";
const SUPABASE_URL = "https://project-ref.supabase.co";
const STORAGE_TUS_ENDPOINT =
  "https://project-ref.storage.supabase.co/storage/v1/upload/resumable";
const TUS_UPLOAD_URL = `${STORAGE_TUS_ENDPOINT}/upload-1`;
const SUPABASE_SECRET_KEY = "sb_secret_abcdefghijklmnop";

function pdfBytes(byteLength = 64) {
  assert.ok(byteLength >= 5);
  const bytes = new Uint8Array(byteLength);
  bytes.fill(0x61);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return bytes;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function storageKey(bucketId, objectName) {
  return `${bucketId}/${objectName}`;
}

function headerValue(headers, expectedName) {
  if (headers instanceof Headers) return headers.get(expectedName);
  const entry = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === expectedName.toLowerCase(),
  );
  return entry?.[1] ?? null;
}

function cleanScanProof(bytes) {
  return Object.freeze({
    engine: "ClamAV",
    engineVersion: "1.5.4",
    signatureVersion: "27890",
    protocol: "clamd-zinstream-v1",
    scannedAt: SCANNED_AT,
    sha256Hex: sha256Hex(bytes),
  });
}

function createHarness({
  bytes = pdfBytes(),
  intentOverrides = {},
  grantOverrides = {},
  consumptionOverrides = {},
  reservationOverrides = {},
  completionOverrides = {},
  rpcErrors = {},
  storageObjectPresent = false,
  tusLocation = TUS_UPLOAD_URL,
  ambiguousFirstPatch = false,
  dynamicReservationPresence = false,
  scanFile,
} = {}) {
  const sourceBytes = Uint8Array.from(bytes);
  const sourceSha256Hex = sha256Hex(sourceBytes);
  const objects = new Map([
    [
      storageKey("platform-whatsapp-media", MEDIA_OBJECT_NAME),
      { bytes: sourceBytes, type: MIME_TYPE },
    ],
  ]);
  if (storageObjectPresent) {
    objects.set(storageKey("platform-documents", DOCUMENT_OBJECT_NAME), {
      bytes: Uint8Array.from(sourceBytes),
      type: MIME_TYPE,
    });
  }

  const rpcCalls = [];
  const storageCalls = [];
  const uploadCalls = [];
  const fetchCalls = [];
  const scanCalls = [];
  let generatedRequestIndex = 0;
  let tusOffset = 0;
  let ambiguousPatchThrown = false;

  const intent = {
    organization_id: IDS.organization,
    conversation_id: IDS.conversation,
    communication_media_id: IDS.media,
    student_case_id: IDS.studentCase,
    document_slot_id: IDS.documentSlot,
    request_id: IDS.request,
    attachment_intent_id: IDS.attachmentIntent,
    media_mime_type: MIME_TYPE,
    media_file_name: FILE_NAME,
    media_file_size_bytes: sourceBytes.byteLength,
    media_sha256_hex: sourceSha256Hex,
    slot_status: "missing",
    ...intentOverrides,
  };
  const grant = {
    media_download_grant_id: IDS.mediaGrant,
    expires_at: FUTURE_EXPIRY,
    signed_url: null,
    storage_api_service_sign_required: true,
    ...grantOverrides,
  };
  const consumption = {
    organization_id: IDS.organization,
    media_download_grant_id: IDS.mediaGrant,
    media_id: IDS.media,
    bucket_id: "platform-whatsapp-media",
    object_name: MEDIA_OBJECT_NAME,
    max_signed_url_expires_in_seconds: 60,
    mime_type: MIME_TYPE,
    file_name: FILE_NAME,
    signed_url: null,
    ...consumptionOverrides,
  };
  const reservation = {
    attachment_intent_id: IDS.attachmentIntent,
    organization_id: IDS.organization,
    student_case_id: IDS.studentCase,
    document_slot_id: IDS.documentSlot,
    document_version_id: IDS.documentVersion,
    version_number: 1,
    upload_reservation_id: IDS.uploadReservation,
    storage_binding_id: IDS.storageBinding,
    bucket_id: "platform-documents",
    object_name: DOCUMENT_OBJECT_NAME,
    expires_at: FUTURE_EXPIRY,
    declared_mime_type: MIME_TYPE,
    byte_size: sourceBytes.byteLength,
    sha256_hex: sourceSha256Hex,
    storage_object_present: storageObjectPresent,
    document_slot_published: false,
    ...reservationOverrides,
  };
  const completion = {
    organization_id: IDS.organization,
    attachment_intent_id: IDS.attachmentIntent,
    attachment_completion_id: IDS.attachmentCompletion,
    conversation_id: IDS.conversation,
    communication_media_id: IDS.media,
    student_case_id: IDS.studentCase,
    document_slot_id: IDS.documentSlot,
    document_version_id: IDS.documentVersion,
    version_number: 1,
    upload_reservation_id: IDS.uploadReservation,
    upload_finalization_id: IDS.uploadFinalization,
    malware_scan_attestation_id: IDS.malwareAttestation,
    sha256_hex: sourceSha256Hex,
    completed_at: "2026-09-06T10:00:02.000Z",
    request_id: IDS.completionRequest,
    ...completionOverrides,
  };

  const responseFor = (name, data) => rpcErrors[name]
    ? { data: null, error: rpcErrors[name] }
    : { data, error: null };

  const userClient = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args) {
          rpcCalls.push({ boundary: "user", schema: schemaName, name, args });
          if (name === "reserve_message_media_attachment") {
            return responseFor(name, intent);
          }
          if (name === "grant_communication_media_download") {
            return responseFor(name, grant);
          }
          throw new Error(`unexpected user RPC: ${name}`);
        },
      };
    },
  };

  const serviceClient = {
    schema(schemaName) {
      assert.equal(schemaName, "platform");
      return {
        async rpc(name, args) {
          rpcCalls.push({ boundary: "service", schema: schemaName, name, args });
          if (name === "consume_communication_media_download_grant") {
            return responseFor(name, consumption);
          }
          if (name === "reserve_message_media_attachment_upload") {
            return responseFor(name, {
              ...reservation,
              storage_object_present: dynamicReservationPresence
                ? objects.has(storageKey("platform-documents", DOCUMENT_OBJECT_NAME))
                : reservation.storage_object_present,
            });
          }
          if (name === "complete_message_media_attachment") {
            return responseFor(name, completion);
          }
          throw new Error(`unexpected service RPC: ${name}`);
        },
      };
    },
    storage: {
      from(bucketId) {
        return {
          async download(objectName) {
            storageCalls.push({ operation: "download", bucketId, objectName });
            const object = objects.get(storageKey(bucketId, objectName));
            return object
              ? {
                  data: new Blob([object.bytes], { type: object.type }),
                  error: null,
                }
              : { data: null, error: { code: "not_found" } };
          },
          async upload(objectName, uploadBytes, options) {
            const copiedBytes = Uint8Array.from(uploadBytes);
            uploadCalls.push({ bucketId, objectName, bytes: copiedBytes, options });
            objects.set(storageKey(bucketId, objectName), {
              bytes: copiedBytes,
              type: options.contentType,
            });
            return { data: { path: objectName }, error: null };
          },
        };
      },
    },
  };

  async function tusFetch(input, init) {
    const url = String(input);
    fetchCalls.push({ url, init });
    if (init.method === "POST") {
      return new Response(null, {
        status: 201,
        headers: { Location: tusLocation },
      });
    }
    if (init.method === "HEAD") {
      return new Response(null, {
        status: 204,
        headers: { "Upload-Offset": String(tusOffset) },
      });
    }
    if (init.method !== "PATCH") {
      return new Response(null, { status: 405 });
    }

    const requestedOffset = Number(headerValue(init.headers, "Upload-Offset"));
    const chunk = Uint8Array.from(init.body);
    if (requestedOffset !== tusOffset || tusOffset + chunk.byteLength > sourceBytes.byteLength) {
      return new Response(null, {
        status: 409,
        headers: { "Upload-Offset": String(tusOffset) },
      });
    }
    sourceBytes.set(chunk, tusOffset);
    tusOffset += chunk.byteLength;
    if (tusOffset === sourceBytes.byteLength) {
      objects.set(storageKey("platform-documents", DOCUMENT_OBJECT_NAME), {
        bytes: Uint8Array.from(sourceBytes),
        type: MIME_TYPE,
      });
    }
    if (ambiguousFirstPatch && !ambiguousPatchThrown) {
      ambiguousPatchThrown = true;
      throw new Error("ambiguous PATCH outcome after remote commit");
    }
    return new Response(null, {
      status: 204,
      headers: { "Upload-Offset": String(tusOffset) },
    });
  }

  const dependencies = {
    async createUserClient() {
      return userClient;
    },
    createServiceClient() {
      return serviceClient;
    },
    backendConfig() {
      return {
        supabaseUrl: SUPABASE_URL,
        supabaseSecretKey: SUPABASE_SECRET_KEY,
      };
    },
    fetch: tusFetch,
    async scanFile(value) {
      const copiedBytes = Uint8Array.from(value);
      scanCalls.push(copiedBytes);
      const proof = cleanScanProof(copiedBytes);
      return scanFile
        ? scanFile({ bytes: copiedBytes, call: scanCalls.length, proof })
        : proof;
    },
    requestId() {
      const requestIds = [
        IDS.grantRequest,
        IDS.consumptionRequest,
        IDS.grantRequestRetry,
        IDS.consumptionRequestRetry,
      ];
      const value = requestIds[generatedRequestIndex];
      generatedRequestIndex += 1;
      if (!value) throw new Error("unexpected requestId call");
      return value;
    },
    now() {
      return NOW_MS;
    },
  };

  return {
    bytes: sourceBytes,
    sha256Hex: sourceSha256Hex,
    rpcCalls,
    storageCalls,
    uploadCalls,
    fetchCalls,
    scanCalls,
    run() {
      return attachPlatformMessageMediaToCase(ACTOR, INPUT, dependencies);
    },
  };
}

function expectedAttachedResult(bytes) {
  return {
    status: "attached",
    studentCaseId: IDS.studentCase,
    documentSlotId: IDS.documentSlot,
    documentVersionId: IDS.documentVersion,
    versionNumber: 1,
    originalFilename: FILE_NAME,
    declaredMimeType: MIME_TYPE,
    byteSize: bytes.byteLength,
    sha256Hex: sha256Hex(bytes),
  };
}

function expectedTusMetadata() {
  return [
    `bucketName ${Buffer.from("platform-documents", "utf8").toString("base64")}`,
    `objectName ${Buffer.from(DOCUMENT_OBJECT_NAME, "utf8").toString("base64")}`,
    `contentType ${Buffer.from(MIME_TYPE, "utf8").toString("base64")}`,
    `cacheControl ${Buffer.from("0", "utf8").toString("base64")}`,
  ].join(",");
}

test("the browser action and server boundary derive authority instead of accepting it", () => {
  const fieldDeclaration = actionSource.match(
    /const ATTACH_MEDIA_FIELDS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(fieldDeclaration);
  assert.deepEqual(
    [...fieldDeclaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    [
      "conversation_id",
      "communication_media_id",
      "student_case_id",
      "document_slot_id",
      "request_id",
    ],
  );
  assert.match(actionSource, /const actor = await requirePlatformStaffActor\(\)/);
  assert.match(
    actionSource,
    /fixedRoleCan\(actor\.authorityRole, "documents\.write"\)/,
  );
  assert.match(
    actionSource,
    /fixedRoleCan\(actor\.authorityRole, "messaging\.read"\)/,
  );
  assert.match(
    actionSource,
    /attachPlatformMessageMediaToCase\(actor, \{[\s\S]*?conversationId,[\s\S]*?communicationMediaId,[\s\S]*?studentCaseId,[\s\S]*?documentSlotId,[\s\S]*?requestId,/,
  );
  assert.doesNotMatch(
    actionSource,
    /fields\.get\("(?:organization_id|auth_user_id|actor_auth_user_id)"\)/,
  );
  assert.doesNotMatch(actionSource, /createServiceClient|storage\.from|signed_url/i);

  const actorDeclaration = serverSource.match(
    /export type PlatformMediaAttachActor = Pick<[\s\S]*?>;/,
  );
  assert.ok(actorDeclaration);
  assert.match(actorDeclaration[0], /ActivePlatformActor/);
  assert.match(actorDeclaration[0], /"organizationId" \| "authUserId"/);

  const inputDeclaration = serverSource.match(
    /export type PlatformMediaAttachInput = Readonly<\{[\s\S]*?\}>;/,
  );
  assert.ok(inputDeclaration);
  assert.deepEqual(
    [...inputDeclaration[0].matchAll(/^\s{2}(\w+): string;/gm)]
      .map((match) => match[1]),
    [
      "conversationId",
      "communicationMediaId",
      "studentCaseId",
      "documentSlotId",
      "requestId",
    ],
  );
  assert.doesNotMatch(inputDeclaration[0], /organization|actor|authUser/i);

  const intentCall = serverSource.match(
    /const intentResponse = await userClient\.schema\("platform"\)\.rpc\([\s\S]*?\n    \);/,
  );
  assert.ok(intentCall);
  assert.doesNotMatch(intentCall[0], /p_organization|p_actor|p_auth/i);
  for (const parameter of [
    "p_conversation_id",
    "p_communication_media_id",
    "p_student_case_id",
    "p_document_slot_id",
    "p_request_id",
  ]) {
    assert.match(intentCall[0], new RegExp(`${parameter}:`));
  }
});

test("the exported orchestration completes the exact clean standard-upload chain", async () => {
  const harness = createHarness();
  const result = await harness.run();

  assert.deepEqual(result, expectedAttachedResult(harness.bytes));
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    harness.rpcCalls.map(({ boundary, schema, name }) => ({ boundary, schema, name })),
    [
      { boundary: "user", schema: "platform", name: "reserve_message_media_attachment" },
      { boundary: "user", schema: "platform", name: "grant_communication_media_download" },
      { boundary: "service", schema: "platform", name: "consume_communication_media_download_grant" },
      { boundary: "service", schema: "platform", name: "reserve_message_media_attachment_upload" },
      { boundary: "service", schema: "platform", name: "complete_message_media_attachment" },
    ],
  );
  assert.deepEqual(harness.rpcCalls[0].args, {
    p_conversation_id: IDS.conversation,
    p_communication_media_id: IDS.media,
    p_student_case_id: IDS.studentCase,
    p_document_slot_id: IDS.documentSlot,
    p_request_id: IDS.request,
  });
  assert.deepEqual(harness.rpcCalls[1].args, {
    p_organization_id: IDS.organization,
    p_media_id: IDS.media,
    p_request_id: IDS.grantRequest,
  });
  assert.deepEqual(harness.rpcCalls[2].args, {
    p_media_download_grant_id: IDS.mediaGrant,
    p_request_id: IDS.consumptionRequest,
  });
  assert.deepEqual(harness.rpcCalls[3].args, {
    p_attachment_intent_id: IDS.attachmentIntent,
    p_scan_result: "clean",
    p_scanner_engine: "ClamAV",
    p_scanner_engine_version: "1.5.4",
    p_scanner_signature_version: "27890",
    p_scanner_protocol: "clamd-zinstream-v1",
    p_scanned_at: SCANNED_AT,
  });
  assert.deepEqual(harness.rpcCalls[4].args, {
    p_attachment_intent_id: IDS.attachmentIntent,
    p_upload_reservation_id: IDS.uploadReservation,
    p_scanner_engine: "ClamAV",
    p_scanner_engine_version: "1.5.4",
    p_scanner_signature_version: "27890",
    p_scanner_protocol: "clamd-zinstream-v1",
    p_scanned_at: SCANNED_AT,
  });
  assert.equal(harness.scanCalls.length, 2);
  assert.equal(harness.uploadCalls.length, 1);
  assert.deepEqual(harness.uploadCalls[0].options, {
    contentType: MIME_TYPE,
    cacheControl: "0",
    upsert: false,
  });
  assert.deepEqual(harness.fetchCalls, []);
});

test("exactly 6 MiB stays on standard upload", async () => {
  const bytes = pdfBytes(STANDARD_UPLOAD_MAX_BYTES);
  const harness = createHarness({ bytes });

  assert.deepEqual(await harness.run(), expectedAttachedResult(bytes));
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(harness.uploadCalls[0].bytes.byteLength, 6_291_456);
  assert.deepEqual(harness.fetchCalls, []);
});

test("a full action retry accepts fresh ClamAV times and replays the exact chain", async () => {
  const harness = createHarness({
    dynamicReservationPresence: true,
    scanFile({ call, proof }) {
      return {
        ...proof,
        engineVersion: call > 2 ? "1.5.5" : "1.5.4",
        signatureVersion: call > 2 ? "27891" : "27890",
        scannedAt: `2026-09-06T10:00:0${call}.000Z`,
      };
    },
  });

  const first = await harness.run();
  const replay = await harness.run();

  assert.deepEqual(first, expectedAttachedResult(harness.bytes));
  assert.deepEqual(replay, first);
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(harness.scanCalls.length, 4);
  const reserveCalls = harness.rpcCalls.filter(
    ({ name }) => name === "reserve_message_media_attachment_upload",
  );
  const completionCalls = harness.rpcCalls.filter(
    ({ name }) => name === "complete_message_media_attachment",
  );
  assert.equal(reserveCalls.length, 2);
  assert.equal(completionCalls.length, 2);
  assert.notEqual(
    reserveCalls[0].args.p_scanned_at,
    reserveCalls[1].args.p_scanned_at,
  );
  assert.notEqual(
    completionCalls[0].args.p_scanned_at,
    completionCalls[1].args.p_scanned_at,
  );
  assert.equal(reserveCalls[1].args.p_scanner_signature_version, "27891");
  assert.equal(completionCalls[1].args.p_scanner_engine_version, "1.5.5");
});

test("6 MiB plus one byte uses raw TUS with exact creation and patch metadata", async () => {
  const bytes = pdfBytes(STANDARD_UPLOAD_MAX_BYTES + 1);
  const harness = createHarness({ bytes });

  assert.deepEqual(await harness.run(), expectedAttachedResult(bytes));
  assert.deepEqual(harness.uploadCalls, []);
  assert.deepEqual(
    harness.fetchCalls.map(({ url, init }) => ({ url, method: init.method })),
    [
      { url: STORAGE_TUS_ENDPOINT, method: "POST" },
      { url: TUS_UPLOAD_URL, method: "PATCH" },
      { url: TUS_UPLOAD_URL, method: "PATCH" },
    ],
  );

  const creation = harness.fetchCalls[0].init;
  assert.deepEqual(creation.headers, {
    apikey: SUPABASE_SECRET_KEY,
    "Tus-Resumable": "1.0.0",
    "Upload-Length": "6291457",
    "Upload-Metadata": expectedTusMetadata(),
  });
  assert.equal(headerValue(creation.headers, "Authorization"), null);
  assert.equal(headerValue(creation.headers, "x-upsert"), null);
  assert.equal(creation.redirect, "error");
  assert.ok(creation.signal instanceof AbortSignal);

  const patches = harness.fetchCalls.slice(1).map(({ init }) => init);
  assert.deepEqual(
    patches.map((init) => ({
      headers: init.headers,
      bodyLength: init.body.byteLength,
      redirect: init.redirect,
      hasSignal: init.signal instanceof AbortSignal,
    })),
    [
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          "Tus-Resumable": "1.0.0",
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": "0",
        },
        bodyLength: 6_291_456,
        redirect: "error",
        hasSignal: true,
      },
      {
        headers: {
          apikey: SUPABASE_SECRET_KEY,
          "Tus-Resumable": "1.0.0",
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": "6291456",
        },
        bodyLength: 1,
        redirect: "error",
        hasSignal: true,
      },
    ],
  );
  for (const patch of patches) {
    assert.equal(headerValue(patch.headers, "x-upsert"), null);
  }
});

test("TUS advances exact offsets across more than two chunks", async () => {
  const bytes = pdfBytes((2 * TUS_CHUNK_BYTES) + 17);
  const harness = createHarness({ bytes });

  assert.deepEqual(await harness.run(), expectedAttachedResult(bytes));
  const patches = harness.fetchCalls.filter(({ init }) => init.method === "PATCH");
  assert.deepEqual(
    patches.map(({ init }) => ({
      offset: headerValue(init.headers, "Upload-Offset"),
      byteLength: init.body.byteLength,
    })),
    [
      { offset: "0", byteLength: 6_291_456 },
      { offset: "6291456", byteLength: 6_291_456 },
      { offset: "12582912", byteLength: 17 },
    ],
  );
});

test("an ambiguous committed PATCH resumes by HEAD without creating or replaying the upload", async () => {
  const bytes = pdfBytes(STANDARD_UPLOAD_MAX_BYTES + 7);
  const harness = createHarness({ bytes, ambiguousFirstPatch: true });

  assert.deepEqual(await harness.run(), expectedAttachedResult(bytes));
  assert.deepEqual(
    harness.fetchCalls.map(({ init }) => ({
      method: init.method,
      offset: headerValue(init.headers, "Upload-Offset"),
      bodyLength: init.body?.byteLength ?? 0,
    })),
    [
      { method: "POST", offset: null, bodyLength: 0 },
      { method: "PATCH", offset: "0", bodyLength: 6_291_456 },
      { method: "HEAD", offset: null, bodyLength: 0 },
      { method: "PATCH", offset: "6291456", bodyLength: 7 },
    ],
  );
  assert.equal(
    harness.fetchCalls.filter(({ init }) => init.method === "POST").length,
    1,
  );
});

test("a foreign TUS Location fails closed before any upload bytes leave the server", async () => {
  const bytes = pdfBytes(STANDARD_UPLOAD_MAX_BYTES + 1);
  const harness = createHarness({
    bytes,
    tusLocation: "https://attacker.example/upload-1",
  });

  assert.deepEqual(await harness.run(), { status: "failed", code: "unavailable" });
  assert.deepEqual(
    harness.fetchCalls.map(({ init }) => init.method),
    ["POST"],
  );
  assert.equal(
    harness.rpcCalls.some(({ name }) => name === "complete_message_media_attachment"),
    false,
  );
});

test("an expired reservation cannot upload or finalize", async () => {
  const harness = createHarness({
    reservationOverrides: { expires_at: PAST_EXPIRY },
  });

  assert.deepEqual(await harness.run(), { status: "failed", code: "unavailable" });
  assert.deepEqual(harness.uploadCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(
    harness.rpcCalls.some(({ name }) => name === "complete_message_media_attachment"),
    false,
  );
});

test("an exact pre-existing reservation object can finish without overwrite", async () => {
  const harness = createHarness({ storageObjectPresent: true });

  assert.deepEqual(await harness.run(), expectedAttachedResult(harness.bytes));
  assert.deepEqual(harness.uploadCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(
    harness.rpcCalls.at(-1).name,
    "complete_message_media_attachment",
  );
});

test("tenant, grant, reservation, completion and request replay misuse fail closed", async (t) => {
  const cases = [
    {
      name: "foreign tenant in the staff intent receipt",
      options: { intentOverrides: { organization_id: IDS.foreignOrganization } },
      expectedRpcNames: ["reserve_message_media_attachment"],
      expectedCode: "unavailable",
    },
    {
      name: "a consumed or foreign download grant receipt",
      options: {
        consumptionOverrides: {
          media_download_grant_id: IDS.replayedMediaGrant,
        },
      },
      expectedRpcNames: [
        "reserve_message_media_attachment",
        "grant_communication_media_download",
        "consume_communication_media_download_grant",
      ],
      expectedCode: "unavailable",
    },
    {
      name: "foreign tenant in the upload reservation receipt",
      options: {
        reservationOverrides: { organization_id: IDS.foreignOrganization },
      },
      expectedRpcNames: [
        "reserve_message_media_attachment",
        "grant_communication_media_download",
        "consume_communication_media_download_grant",
        "reserve_message_media_attachment_upload",
      ],
      expectedCode: "unavailable",
    },
    {
      name: "an extra reservation receipt field",
      options: { reservationOverrides: { unexpected: "not-authority" } },
      expectedRpcNames: [
        "reserve_message_media_attachment",
        "grant_communication_media_download",
        "consume_communication_media_download_grant",
        "reserve_message_media_attachment_upload",
      ],
      expectedCode: "unavailable",
    },
    {
      name: "a completion receipt for another reservation",
      options: {
        completionOverrides: {
          upload_reservation_id: IDS.otherUploadReservation,
        },
      },
      expectedRpcNames: [
        "reserve_message_media_attachment",
        "grant_communication_media_download",
        "consume_communication_media_download_grant",
        "reserve_message_media_attachment_upload",
        "complete_message_media_attachment",
      ],
      expectedCode: "unavailable",
    },
    {
      name: "an extra completion receipt field",
      options: { completionOverrides: { unexpected: "not-authority" } },
      expectedRpcNames: [
        "reserve_message_media_attachment",
        "grant_communication_media_download",
        "consume_communication_media_download_grant",
        "reserve_message_media_attachment_upload",
        "complete_message_media_attachment",
      ],
      expectedCode: "unavailable",
    },
    {
      name: "a request id replayed with different inputs",
      options: {
        rpcErrors: {
          reserve_message_media_attachment: {
            code: "23505",
            message: "request_id was already used with different inputs",
          },
        },
      },
      expectedRpcNames: ["reserve_message_media_attachment"],
      expectedCode: "request_conflict",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const harness = createHarness(scenario.options);
      assert.deepEqual(await harness.run(), {
        status: "failed",
        code: scenario.expectedCode,
      });
      assert.deepEqual(
        harness.rpcCalls.map(({ name }) => name),
        scenario.expectedRpcNames,
      );
    });
  }
});

test("malware detected after Storage write prevents completion", async () => {
  const harness = createHarness({
    scanFile({ call, proof }) {
      if (call === 2) throw new ClamdScanError("infected");
      return proof;
    },
  });

  assert.deepEqual(await harness.run(), {
    status: "failed",
    code: "malware_detected",
  });
  assert.equal(harness.scanCalls.length, 2);
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(
    harness.rpcCalls.some(({ name }) => name === "complete_message_media_attachment"),
    false,
  );
});
