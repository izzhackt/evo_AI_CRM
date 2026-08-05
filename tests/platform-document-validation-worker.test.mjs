import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PlatformClamAvError } from "../src/lib/server/platform-clamav-client.ts";
import {
  PlatformDocumentValidationWorkerError,
  runPlatformDocumentValidationOnce,
} from "../src/lib/server/platform-document-validation-worker.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const WORK_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";
const CLAIM_REQUEST_ID = "77777777-7777-4777-8777-777777777777";
const PDF_BYTES = Buffer.from("%PDF-1.7\nsynthetic fixture\n%%EOF", "utf8");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function claim(overrides = {}) {
  return {
    claimed: true,
    organization_id: ORGANIZATION_ID,
    work_item_id: WORK_ITEM_ID,
    attempt_id: ATTEMPT_ID,
    kind: "document_validation",
    queue: "platform_work_v1",
    queue_message_id: 91,
    queue_read_count: 1,
    attempt_number: 1,
    max_attempts: 3,
    lease_expires_at: "2026-08-05T10:00:00Z",
    document_version_id: DOCUMENT_VERSION_ID,
    queue_payload_is_pointer_only: true,
    ...overrides,
  };
}

function validationInput(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    document_version_id: DOCUMENT_VERSION_ID,
    document_version_no: 1,
    bucket_id: "student-documents-private",
    object_name: `${ORGANIZATION_ID}/${DOCUMENT_VERSION_ID}/object.pdf`,
    expected_original_filename: "synthetic.pdf",
    expected_mime_type: "application/pdf",
    expected_byte_size: PDF_BYTES.byteLength,
    expected_sha256_hex: sha256(PDF_BYTES),
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = [];
  const api = {
    calls,
    claimWork: async () => {
      calls.push("claim");
      return claim();
    },
    resolveValidationInput: async () => {
      calls.push("resolve");
      return validationInput();
    },
    downloadObject: async () => {
      calls.push("download");
      return PDF_BYTES;
    },
    scanBytes: async () => {
      calls.push("scan");
      return { status: "clean", scannerVersion: "ClamAV 1.5.3/28000" };
    },
    attestValidation: async (input) => {
      calls.push(["attest", input]);
      return {
        organization_id: input.organizationId,
        document_version_id: input.documentVersionId,
        integrity_status: input.integrityStatus,
        malware_status: input.malwareStatus,
        validation_source: input.validationSource,
        evidence_ref: input.evidenceRef,
        scanner_proof: false,
      };
    },
    finishWork: async (input) => {
      calls.push(["finish", input]);
      return {
        organization_id: ORGANIZATION_ID,
        work_item_id: input.workItemId,
        attempt_id: input.attemptId,
        kind: "document_validation",
        state:
          input.outcome === "succeeded"
            ? "succeeded"
            : input.outcome === "retryable_error"
              ? "retry_wait"
              : "dead_lettered",
        outcome: input.outcome,
      };
    },
  };
  return Object.assign(api, overrides);
}

function run(api) {
  return runPlatformDocumentValidationOnce(api, {
    workerRef: "test-worker",
    claimRequestId: CLAIM_REQUEST_ID,
    retryDelaySeconds: 15,
  });
}

test("clean bytes follow claim -> resolve -> download -> scan -> attest -> finish", async () => {
  const api = dependencies();
  assert.deepEqual(await run(api), {
    status: "succeeded",
    workItemId: WORK_ITEM_ID,
    code: "clean",
  });
  assert.deepEqual(
    api.calls.map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
    ["claim", "resolve", "download", "scan", "attest", "finish"],
  );
  assert.equal(api.calls.some((entry) => String(entry).includes("extraction")), false);
});

test("scanner timeout is retryable and never attested clean", async () => {
  const api = dependencies({
    scanBytes: async () => {
      api.calls.push("scan");
      throw new PlatformClamAvError("timeout", true);
    },
  });
  assert.deepEqual(await run(api), {
    status: "retry_scheduled",
    workItemId: WORK_ITEM_ID,
    code: "scanner_timeout",
  });
  assert.equal(api.calls.some((entry) => Array.isArray(entry) && entry[0] === "attest"), false);
  const finish = api.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  assert.equal(finish.outcome, "retryable_error");
});

test("infected verdict is terminal with verified integrity and no extraction", async () => {
  const api = dependencies({
    scanBytes: async () => {
      api.calls.push("scan");
      return {
        status: "infected",
        signature: "Eicar-Test-Signature",
        scannerVersion: "ClamAV 1.5.3/28000",
      };
    },
  });
  assert.equal((await run(api)).status, "terminal");
  const attestation = api.calls.find((entry) => Array.isArray(entry) && entry[0] === "attest")[1];
  assert.equal(attestation.integrityStatus, "verified");
  assert.equal(attestation.malwareStatus, "infected");
  const finish = api.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  assert.equal(finish.errorCode, "document_infected");
  assert.equal(api.calls.some((entry) => String(entry).includes("extraction")), false);
});

test("hash mismatch is terminal before scanner", async () => {
  const api = dependencies({
    resolveValidationInput: async () => {
      api.calls.push("resolve");
      return validationInput({ expected_sha256_hex: "a".repeat(64) });
    },
  });
  const result = await run(api);
  assert.equal(result.code, "document_sha256_mismatch");
  assert.equal(api.calls.includes("scan"), false);
});

test("MIME magic mismatch is terminal before scanner", async () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const api = dependencies({
    resolveValidationInput: async () => {
      api.calls.push("resolve");
      return validationInput({
        expected_byte_size: pngBytes.byteLength,
        expected_sha256_hex: sha256(pngBytes),
      });
    },
    downloadObject: async () => {
      api.calls.push("download");
      return pngBytes;
    },
  });
  const result = await run(api);
  assert.equal(result.code, "document_mime_mismatch");
  assert.equal(api.calls.includes("scan"), false);
});

test("same attempt produces stable attestation and finish request identities", async () => {
  const first = dependencies();
  const second = dependencies();
  await run(first);
  await run(second);
  const firstAttest = first.calls.find((entry) => Array.isArray(entry) && entry[0] === "attest")[1];
  const secondAttest = second.calls.find((entry) => Array.isArray(entry) && entry[0] === "attest")[1];
  const firstFinish = first.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  const secondFinish = second.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  assert.equal(firstAttest.requestId, secondAttest.requestId);
  assert.equal(firstAttest.evidenceRef, secondAttest.evidenceRef);
  assert.equal(firstFinish.requestId, secondFinish.requestId);
});

test("a replacement lease reuses stable attestation identity and evidence", async () => {
  const first = dependencies();
  const second = dependencies({
    claimWork: async () => {
      second.calls.push("claim");
      return claim({
        attempt_id: "88888888-8888-4888-8888-888888888888",
        attempt_number: 2,
        queue_read_count: 2,
      });
    },
  });
  await run(first);
  await run(second);
  const firstAttest = first.calls.find((entry) => Array.isArray(entry) && entry[0] === "attest")[1];
  const secondAttest = second.calls.find((entry) => Array.isArray(entry) && entry[0] === "attest")[1];
  assert.equal(firstAttest.requestId, secondAttest.requestId);
  assert.equal(firstAttest.evidenceRef, secondAttest.evidenceRef);
  const firstFinish = first.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  const secondFinish = second.calls.find((entry) => Array.isArray(entry) && entry[0] === "finish")[1];
  assert.notEqual(firstFinish.requestId, secondFinish.requestId);
});

test("unsupported shared-queue kind is rejected without resolve or finish", async () => {
  const api = dependencies({
    claimWork: async () => {
      api.calls.push("claim");
      return claim({ kind: "document_extraction" });
    },
  });
  await assert.rejects(
    run(api),
    (error) => error instanceof PlatformDocumentValidationWorkerError && error.code === "unsupported_claim_kind",
  );
  assert.deepEqual(api.calls, ["claim"]);
});
