#!/usr/bin/env node
// Acceptance-only orchestration of real modules. Never copy into the production
// final image. No provider module, key, upload or generation is used here.
import { createHash } from "node:crypto";
import { loadDocumentRecognitionSource } from "../../src/lib/server/document-recognition-source.ts";
import { inspectDocumentSource } from "../../src/lib/server/document-source-preflight.ts";
import { getPlatformSupabaseBackendConfig } from "../../src/lib/server/platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "../../src/lib/server/platform-supabase-service-client.ts";
import { canonicalDocumentRecognitionFingerprint } from "../../src/lib/document-recognition.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
function check(value) { if (!value) throw new Error("PREDISPATCH_PROOF_FAILED"); }
async function input() {
  const chunks = []; let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error("INPUT_TIMEOUT")), 5_000);
  try {
    for await (const chunk of process.stdin) { size += chunk.length; check(size <= 16_384); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    check(value && Object.keys(value).sort().join(",") === "jobId,organizationId,serviceKey,sourceBytes,sourceSha256,sourceVersionId"
      && [value.jobId, value.organizationId, value.sourceVersionId].every(id => UUID.test(id))
      && SHA.test(value.sourceSha256) && Number.isSafeInteger(value.sourceBytes) && value.sourceBytes > 0
      && value.sourceBytes <= 25 * 1024 * 1024 && typeof value.serviceKey === "string");
    return value;
  } finally { clearTimeout(timer); }
}

try {
  check(process.platform === "linux" && !process.env.EVO_PLATFORM_GEMINI_API_KEY && !process.env.GEMINI_API_KEY);
  const expected = await input();
  // Shares only the verified disposable Kong container's network namespace.
  // Secret arrives on stdin, not argv, Docker configuration, a mount or a file.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:8000";
  process.env.EVO_PLATFORM_SUPABASE_SECRET_KEY = expected.serviceKey;
  const client = createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  const signal = AbortSignal.timeout(60_000);
  const rpc = async (name, args) => {
    const response = await client.schema("platform").rpc(name, args).abortSignal(signal);
    check(!response.error); return response.data;
  };
  const claim = await rpc("claim_document_recognition", { p_worker_id: "local-d3-predispatch-acceptance" });
  check(claim?.job_id === expected.jobId && claim.organization_id === expected.organizationId
    && claim.state === "preflight" && claim.stage === "preflight" && UUID.test(claim.attempt_id)
    && UUID.test(claim.claim_token) && claim.source_pages === null && claim.processing_fingerprint === null);
  const identity = claim.request_identity;
  check(identity?.source_version_id === expected.sourceVersionId && identity.source_sha256 === expected.sourceSha256
    && identity.source_bytes === expected.sourceBytes && identity.source_mime === "image/png"
    && identity.organization_id === expected.organizationId && identity.model === "gemini-local-preflight-only"
    && identity.config_version === "local-preflight-v1");
  const source = await loadDocumentRecognitionSource({ attempt_id: claim.attempt_id, job_id: claim.job_id,
    organization_id: claim.organization_id, student_case_id: identity.student_case_id,
    document_slot_id: identity.source_document_slot_id, source_version_id: identity.source_version_id,
    source_sha256: identity.source_sha256, source_bytes: identity.source_bytes, source_mime: identity.source_mime,
  }, claim.claim_token, { signal });
  const inspection = await inspectDocumentSource({ bytes: source.bytes, mimeType: identity.source_mime,
    expectedSha256: identity.source_sha256 }, { signal });
  check(inspection.status === "verified" && inspection.sha256 === expected.sourceSha256
    && inspection.byteLength === expected.sourceBytes && inspection.mimeType === "image/png"
    && inspection.policyVersion === "document-source-v1" && inspection.pageCount === 1);
  const fingerprint = createHash("sha256").update(canonicalDocumentRecognitionFingerprint({
    ...identity, source_pages: inspection.pageCount,
  })).digest("hex");
  const sealed = await rpc("seal_document_recognition_preflight", { p_attempt_id: claim.attempt_id,
    p_claim_token: claim.claim_token, p_source_sha256: inspection.sha256, p_source_bytes: inspection.byteLength,
    p_source_mime: inspection.mimeType, p_source_pages: inspection.pageCount,
    p_processing_fingerprint: fingerprint, p_preflight_policy_version: inspection.policyVersion });
  check(sealed?.job_id === claim.job_id && sealed.attempt_id === claim.attempt_id
    && sealed.processing_fingerprint === fingerprint && sealed.source_pages === inspection.pageCount
    && sealed.source_preflight_policy_version === inspection.policyVersion);
  await rpc("finish_document_recognition_preflight", { p_attempt_id: claim.attempt_id,
    p_claim_token: claim.claim_token, p_failure_code: "cancelled" });
  process.stdout.write(JSON.stringify({ schema: "evo-d3-predispatch/v1", jobId: claim.job_id,
    attemptId: claim.attempt_id, accessEventId: source.accessEventId, sourceSha256: inspection.sha256,
    sourceBytes: inspection.byteLength, sourcePages: inspection.pageCount, sourcePolicy: inspection.policyVersion,
    processingFingerprint: fingerprint, providerDispatch: false }) + "\n");
} catch {
  process.stderr.write("DOCUMENT_RECOGNITION_PREDISPATCH_ERROR\n"); process.exitCode = 1;
}
