import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformActor, PlatformActorResult } from "../platform-auth.ts";
import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import { readUniversityTemplateRuntimeIdentity } from "./university-template-runtime-identity.ts";
import type { UniversityTemplateRuntimeIdentity } from "./university-template-runtime-identity.ts";
import type { PlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { ClamdScanError, isClamdMalwareScanProof, scanBytesWithClamd } from "./clamd-malware-scanner.ts";
import { inspectUniversityTemplate, previewUniversityTemplateSource, renderUniversityTemplatePage, type UniversityTemplateSourcePreviewResult } from "./university-template-preflight.ts";
import { UniversityTemplateSourceError, awaitUniversityTemplateOperation, readUniversityTemplateStream,
  readUniversityTemplateSource, uploadUniversityTemplateSource, universityTemplateSha256 } from "./university-template-source-storage.ts";
import { templateIngressUuid, templateIngressMime, templateIngressRecord, templateIngressHash, templateIngressInteger,
  normalizeUniversityTemplateIngressReceipt, normalizeUniversityTemplateManifest, UNIVERSITY_TEMPLATE_INGRESS_FAILURES,
  normalizeUniversityTemplateInspectionMetadata,
  type UniversityTemplateIngressReceipt } from "../university-template-ingress.ts";
import { UNIVERSITY_TEMPLATE_MAX_BYTES, type UniversityTemplateMime } from "../university-form-registry.ts";

type RpcClient = Pick<SupabaseClient, "schema">;
type Context = { params: Promise<{ templateId: string; versionId: string }> };
export type UniversityTemplateIngressDependencies = Readonly<{
  loadActor(): Promise<PlatformActorResult>;
  createSessionClient(): Promise<RpcClient>;
  createServiceClient(): RpcClient;
  readIdentity: typeof readUniversityTemplateRuntimeIdentity;
  scan: typeof scanBytesWithClamd;
  inspect: typeof inspectUniversityTemplate;
  preview: typeof previewUniversityTemplateSource;
  renderPage: typeof renderUniversityTemplatePage;
  backendConfig: typeof getPlatformSupabaseBackendConfig;
  fetch: typeof fetch;
  requestId(): string;
}>;
const DEFAULTS: UniversityTemplateIngressDependencies = {
  loadActor: async () => (await import("../platform-auth.ts")).resolvePlatformActor(),
  createSessionClient: async () => (await import("../supabase/server.ts")).createSupabaseServerClient(),
  createServiceClient: () => createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig()),
  readIdentity: readUniversityTemplateRuntimeIdentity, scan: scanBytesWithClamd, inspect: inspectUniversityTemplate,
  preview: previewUniversityTemplateSource, renderPage: renderUniversityTemplatePage,
  backendConfig: getPlatformSupabaseBackendConfig, fetch, requestId: randomUUID,
};
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
export function universityTemplateMethodNotAllowed(allow: "GET" | "POST" | "GET, POST"): Response {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { ...HEADERS, allow } });
}
let activeByteOperations = 0;
class IngressError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function failure(error: unknown): Response {
  if (error instanceof IngressError) return Response.json({ error: error.code }, { status: error.status, headers: HEADERS });
  if (error instanceof UniversityTemplateSourceError) return Response.json({ error: error.code }, { status: 503, headers: HEADERS });
  return Response.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
}
function receiptResponse(receipt: UniversityTemplateIngressReceipt): Response {
  const status = receipt.state === "verified" || receipt.state === "cancelled" ? 200 : receipt.state === "failed" ? 409 : 202;
  return Response.json(receipt, { status, headers: HEADERS });
}
async function rpc(client: RpcClient, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const step = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const result = await awaitUniversityTemplateOperation(() => client.schema("platform").rpc(name, args).abortSignal(step), step);
  if (!result.error) return result.data;
  const fixed: Record<string, [number, string]> = { "42501": [403, "forbidden"], "40001": [409, "stale_revision"],
    "23505": [409, "request_conflict"], "22023": [400, "invalid_request"], "22P02": [400, "invalid_request"] };
  if (fixed[result.error.code]) throw new IngressError(...fixed[result.error.code]);
  if (result.error.code === "55000") {
    const known = UNIVERSITY_TEMPLATE_INGRESS_FAILURES.find(code => result.error.message === `university_ingress_${code}`);
    if (known) throw new IngressError(known === "access_changed" ? 403 : 409, known);
  }
  throw new IngressError(503, "unavailable");
}
type Source = Readonly<{ organization_id: string; catalog_institution_id: string; catalog_source_revision: string;
  template_id: string; template_version_id: string; expected_revision: number; sha256: string; byte_size: number;
  mime_type: UniversityTemplateMime; bucket_id: "platform-document-templates"; object_name: string }>;
function sourceFrom(raw: unknown, expectedOrganization: string, template: string, version: string, expected: number, receipt: UniversityTemplateIngressReceipt): Source {
  const o = templateIngressRecord(raw, ["organization_id", "catalog_institution_id", "catalog_source_revision", "template_id",
    "template_version_id", "expected_revision", "sha256", "byte_size", "mime_type", "bucket_id", "object_name"]);
  const mime = templateIngressMime(o.mime_type), organization = templateIngressUuid(o.organization_id);
  if (typeof o.catalog_source_revision !== "string" || !o.catalog_source_revision.trim() || [...o.catalog_source_revision].length > 500
    || /[\u0000-\u001f\u007f-\u009f]/u.test(o.catalog_source_revision)) throw new IngressError(503, "unavailable");
  if (organization !== expectedOrganization || templateIngressUuid(o.template_id) !== template
    || templateIngressUuid(o.template_version_id) !== version || o.expected_revision !== expected
    || o.bucket_id !== "platform-document-templates" || o.object_name !== `${organization}/${template}/${version}.${mime === "application/pdf" ? "pdf" : "docx"}`
    || templateIngressHash(o.sha256) !== receipt.sha256 || templateIngressInteger(o.byte_size, 1, UNIVERSITY_TEMPLATE_MAX_BYTES) !== receipt.byte_size)
    throw new IngressError(503, "unavailable");
  return Object.freeze({ organization_id: organization, catalog_institution_id: templateIngressUuid(o.catalog_institution_id),
    catalog_source_revision: o.catalog_source_revision, template_id: template, template_version_id: version,
    expected_revision: expected, sha256: receipt.sha256, byte_size: receipt.byte_size, mime_type: mime,
    bucket_id: "platform-document-templates", object_name: o.object_name as string });
}
function freshExpiry(value: unknown, maximumMs: number): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()
    || Date.parse(value) > Date.now() + maximumMs) throw new IngressError(409, "expired");
}
type RetainByteWork = <T>(task: Promise<T>) => Promise<T>;
async function byteOperation(work: (retain: RetainByteWork) => Promise<Response>): Promise<Response> {
  // No implicit queue: cap the one native invocation and retained20MiB inputs.
  if (activeByteOperations >= 1) throw new IngressError(503, "unavailable");
  activeByteOperations++;
  const pending = new Set<Promise<unknown>>();
  const retain: RetainByteWork = task => {
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  try { return await work(retain); }
  finally {
    // HTTP cancellation can win its race while a scanner/socket or native child
    // still owns bytes. Release admission only on actual settlement, not abort.
    // This continuation performs accounting only, never background processing.
    if (pending.size) void Promise.allSettled([...pending]).then(() => { activeByteOperations--; });
    else activeByteOperations--;
  }
}
function actorFrom(result: PlatformActorResult): PlatformActor {
  if (result.status === "anonymous") throw new IngressError(401, "authentication_required");
  if (result.status !== "authenticated") throw new IngressError(503, "unavailable");
  if (isStaffPreview(result.actor) || !staffHasPermission(result.actor, "catalog.import.manage")) throw new IngressError(403, "forbidden");
  return result.actor;
}
function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  try {
    const parsed = new URL(origin ?? ""), url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
    if (parsed.origin !== origin || parsed.host !== host || !["http", "https"].includes(protocol) || parsed.protocol !== `${protocol}:`) throw new Error();
  } catch { throw new IngressError(403, "forbidden"); }
}
function uploadCommand(request: Request) {
  requireSameOrigin(request);
  try {
    const match = /^"([1-9][0-9]*)"$/u.exec(request.headers.get("if-match") ?? "");
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 2) throw new Error();
    const expected = Number(match[1]), requestId = templateIngressUuid(request.headers.get("idempotency-key"));
    let mime; try { mime = templateIngressMime(request.headers.get("content-type")); } catch { throw new IngressError(415, "unsupported_media_type"); }
    const length = request.headers.get("content-length");
    if (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) > UNIVERSITY_TEMPLATE_MAX_BYTES)) throw new IngressError(413, "source_too_large");
    if (!request.body) throw new Error();
    return { expected, requestId, mime };
  } catch (error) { if (error instanceof IngressError) throw error; throw new IngressError(400, "invalid_request"); }
}
async function readCommand(request: Request, signal: AbortSignal) {
  requireSameOrigin(request);
  try {
    if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")) throw new Error();
    const length = request.headers.get("content-length");
    if (length !== null && (!/^[1-9][0-9]*$/u.test(length) || Number(length) > 4096)) throw new Error();
    const bytes = await readUniversityTemplateStream(request.body, 4096, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
    const value = templateIngressRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["request_id", "expected_revision", "reason"]);
    if (typeof value.reason !== "string" || !value.reason.trim() || [...value.reason].length > 500 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.reason)) throw new Error();
    return { requestId: templateIngressUuid(value.request_id), expected: templateIngressInteger(value.expected_revision, 2), reason: value.reason };
  } catch { throw new IngressError(400, "invalid_request"); }
}
async function routeContext(context: Context, signal: AbortSignal) {
  const params = await awaitUniversityTemplateOperation(() => context.params, signal);
  try { return { template: templateIngressUuid(params.templateId), version: templateIngressUuid(params.versionId) }; }
  catch { throw new IngressError(400, "invalid_request"); }
}
async function readMetadata(session: RpcClient, template: string, version: string, signal: AbortSignal) {
  return normalizeUniversityTemplateInspectionMetadata(await rpc(session, "staff_university_template_inspection",
    { p_template_id: template, p_template_version_id: version }, signal), template, version);
}
async function bounded(request: Request, work: (signal: AbortSignal) => Promise<Response>, milliseconds = 100_000): Promise<Response> {
  const stop = new AbortController(), abort = () => stop.abort();
  const timer = setTimeout(abort, milliseconds); request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  try { return await awaitUniversityTemplateOperation(() => work(stop.signal), stop.signal); }
  catch (error) { return failure(error); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); stop.abort(); }
}

async function processUpload(request: Request, mime: UniversityTemplateMime, receipt: UniversityTemplateIngressReceipt, claim: string,
  source: Source, identity: UniversityTemplateRuntimeIdentity, service: RpcClient, config: PlatformSupabaseBackendConfig,
  deps: UniversityTemplateIngressDependencies, signal: AbortSignal, retain: RetainByteWork): Promise<Response> {
  let sealStarted = false, storageStarted = false, completionStarted = false;
  const complete = async (outcome: "verified" | "failed" | "unknown", code: string | null, bytes: Buffer | null) => {
    completionStarted = true;
    const raw = await rpc(service, "complete_university_template_ingress", { p_ingress_id: receipt.ingress_id, p_claim_token: claim,
      p_outcome: outcome, p_failure_code: code, p_observed_sha256: bytes ? universityTemplateSha256(bytes) : null,
      p_observed_bytes: bytes?.byteLength ?? null, p_observed_mime_type: bytes ? mime : null }, signal);
    const result = normalizeUniversityTemplateIngressReceipt(raw, source.template_id, source.template_version_id);
    if (result.ingress_id !== receipt.ingress_id || result.request_id !== receipt.request_id) throw new IngressError(503, "unavailable");
    return receiptResponse(result);
  };
  try {
    const bodySignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
    const bytes = await readUniversityTemplateStream(request.body, source.byte_size, bodySignal);
    if (mime !== source.mime_type || bytes.byteLength !== source.byte_size || universityTemplateSha256(bytes) !== source.sha256)
      throw new UniversityTemplateSourceError("source_mismatch");
    let scan;
    try { scan = await awaitUniversityTemplateOperation(() => retain(deps.scan(bytes)), signal); }
    catch (error) { throw new UniversityTemplateSourceError(error instanceof ClamdScanError && error.code === "infected" ? "malware_detected" : "scanner_unavailable"); }
    if (!isClamdMalwareScanProof(scan, source.sha256)) throw new UniversityTemplateSourceError("scanner_unavailable");
    const inspection = await awaitUniversityTemplateOperation(() => retain(deps.inspect({ bytes, mimeType: mime, expectedSha256: source.sha256 }, { signal })), signal);
    if (inspection.status !== "verified") throw new UniversityTemplateSourceError(inspection.code === "template_not_eligible" ? "template_not_eligible" : "template_runtime_unavailable");
    if (inspection.sha256 !== source.sha256 || inspection.byteLength !== source.byte_size || inspection.mimeType !== mime
      || inspection.policyVersion !== "evo-university-template-v1") throw new UniversityTemplateSourceError("template_not_eligible");
    const manifest = normalizeUniversityTemplateManifest(inspection.manifest, mime);
    sealStarted = true;
    const sealed = templateIngressRecord(await rpc(service, "seal_university_template_ingress", { p_ingress_id: receipt.ingress_id,
      p_claim_token: claim, p_scan_proof: scan, p_inspector_image_id: identity.imageId, p_inspector_revision: inspection.policyVersion,
      p_runtime_revision: identity.revision, p_manifest: manifest }, signal), ["receipt", "source"]);
    const next = normalizeUniversityTemplateIngressReceipt(sealed.receipt, source.template_id, source.template_version_id);
    if (next.ingress_id !== receipt.ingress_id || next.request_id !== receipt.request_id) throw new IngressError(503, "unavailable");
    if (sealed.source === null) return receiptResponse(next);
    const target = sourceFrom(sealed.source, source.organization_id,
      source.template_id, source.template_version_id, source.expected_revision, next);
    if (next.state !== "sealed" || target.sha256 !== source.sha256 || target.mime_type !== mime || target.object_name !== source.object_name)
      throw new IngressError(503, "unavailable");
    storageStarted = true;
    await uploadUniversityTemplateSource(target, bytes, config, AbortSignal.any([signal, AbortSignal.timeout(20_000)]), deps.fetch);
    const stored = await readUniversityTemplateSource(target, config, AbortSignal.any([signal, AbortSignal.timeout(15_000)]), deps.fetch);
    if (!stored) throw new UniversityTemplateSourceError("storage_missing");
    if (universityTemplateSha256(stored) !== source.sha256) throw new UniversityTemplateSourceError("integrity_failed");
    return await complete("verified", null, stored);
  } catch (error) {
    // A completion response can be lost after commit. Do not issue a second
    // mutation or fabricate success; the caller must read status/reconcile.
    if (completionStarted || signal.aborted) throw error;
    const code = error instanceof UniversityTemplateSourceError ? error.code : "template_runtime_unavailable";
    const unknown = sealStarted && !(storageStarted && (code === "integrity_failed" || code === "storage_missing"));
    return complete(unknown ? "unknown" : "failed", unknown ? "storage_unavailable" : code, null);
  }
}

async function accessSource(request: Request, context: Context, intent: "read" | "reconcile" | "preview" | "page", deps: UniversityTemplateIngressDependencies,
  signal: AbortSignal): Promise<Response> {
  const actor = actorFrom(await awaitUniversityTemplateOperation(() => deps.loadActor(), signal));
  const { template, version } = await routeContext(context, signal);
  let previewOffset = 0;
  let pageNumber = 1;
  if (intent === "page") {
    const params = new URL(request.url).searchParams, value = params.get("page");
    if ([...params].length !== 1 || !value || !/^[1-9]\d{0,2}$/u.test(value) || Number(value) > 100)
      throw new IngressError(400, "invalid_request");
    pageNumber = Number(value);
  }
  if (intent === "preview") {
    const params = new URL(request.url).searchParams;
    const value = params.get("offset");
    if ([...params].length !== 1 || !value || !/^(?:0|[1-9]\d{0,3})$/u.test(value) || Number(value) > 2999)
      throw new IngressError(400, "invalid_request");
    previewOffset = Number(value);
  }
  const session = await awaitUniversityTemplateOperation(() => deps.createSessionClient(), signal);
  const metadata = await readMetadata(session, template, version, signal);
  const command = intent !== "reconcile" ? { expected: metadata.template_revision, requestId: templateIngressUuid(deps.requestId()), reason: "Read private university template" }
    : await readCommand(request, signal);
  if (!metadata.source_current || !metadata.ingress) throw new IngressError(409, "source_changed");
  if (intent !== "reconcile" && metadata.inspection !== "verified") throw new IngressError(409, "not_inspected");
  if (intent === "preview" && (metadata.manifest?.format !== "docx" || previewOffset >= metadata.manifest.slots.length))
    throw new IngressError(400, "invalid_request");
  if (intent === "page" && (metadata.manifest?.format !== "pdf" || pageNumber > metadata.manifest.pageSizes.length))
    throw new IngressError(400, "invalid_request");
  return byteOperation(async retain => {
    const granted = templateIngressRecord(await rpc(session, "prepare_university_template_source_access", { p_template_id: template,
      p_template_version_id: version, p_expected_revision: command.expected, p_intent: intent === "reconcile" ? "reconcile" : "read", p_request_id: command.requestId,
      p_reason: command.reason }, signal), ["grant_id"]);
    const grantId = templateIngressUuid(granted.grant_id);
    if (intent === "reconcile") {
      // The exact command replay is authorized above. A completed grant is not
      // consumed twice, and immutable completion is read from the session DTO.
      const current = await readMetadata(session, template, version, signal);
      if (current.source_current && current.ingress?.state === "verified") return receiptResponse(current.ingress);
    }
    const service = deps.createServiceClient(), config = deps.backendConfig();
    const consumed = templateIngressRecord(await rpc(service, "consume_university_template_source_access", { p_grant_id: grantId,
      p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId }, signal), ["grant_id", "receipt", "source", "expires_at"]);
    if (templateIngressUuid(consumed.grant_id) !== grantId) throw new IngressError(503, "unavailable");
    freshExpiry(consumed.expires_at, 61_000);
    const receipt = normalizeUniversityTemplateIngressReceipt(consumed.receipt, template, version);
    const source = sourceFrom(consumed.source, actor.organizationId, template, version, command.expected, receipt);
    if (source.sha256 !== metadata.template_sha256 || source.mime_type !== metadata.mime_type
      || receipt.ingress_id !== metadata.ingress?.ingress_id) throw new IngressError(503, "unavailable");
    const bytes = await readUniversityTemplateSource(source, config, AbortSignal.any([signal, AbortSignal.timeout(20_000)]), deps.fetch);
    const observedHash = bytes ? universityTemplateSha256(bytes) : null;
    let preview: UniversityTemplateSourcePreviewResult | null = null;
    let page: Awaited<ReturnType<typeof renderUniversityTemplatePage>> | null = null;
    if (intent === "page") {
      if (!bytes || observedHash !== source.sha256 || source.mime_type !== "application/pdf" || metadata.manifest?.format !== "pdf")
        throw new IngressError(409, "source_changed");
      const manifest = metadata.manifest;
      page = await awaitUniversityTemplateOperation(() => retain(deps.renderPage({ bytes, mimeType: "application/pdf",
        expectedSha256: source.sha256, expectedManifest: manifest, page: pageNumber }, { signal })), signal);
      if (page.status !== "rendered") throw new IngressError(503, "unavailable");
    }
    if (intent === "preview") {
      if (!bytes || observedHash !== source.sha256 || !metadata.manifest) throw new IngressError(409, "source_changed");
      // Keep the source grant open until after native processing. The completion
      // below rechecks live authority before any private excerpt is returned.
      preview = await awaitUniversityTemplateOperation(() => retain(deps.preview({ bytes, mimeType: source.mime_type,
        expectedSha256: source.sha256, expectedManifest: metadata.manifest!, offset: previewOffset }, { signal })), signal);
      if (preview.status !== "preview") throw new IngressError(503, "unavailable");
    }
    const finished = templateIngressRecord(await rpc(service, "complete_university_template_source_access", { p_grant_id: grantId,
      p_observed_sha256: observedHash, p_observed_bytes: bytes?.byteLength ?? null,
      p_observed_mime_type: bytes ? source.mime_type : null, p_storage_missing: bytes === null }, signal), ["permitted", "receipt"]);
    if (typeof finished.permitted !== "boolean") throw new IngressError(503, "unavailable");
    const final = normalizeUniversityTemplateIngressReceipt(finished.receipt, template, version);
    if (final.ingress_id !== receipt.ingress_id || final.sha256 !== source.sha256) throw new IngressError(503, "unavailable");
    if (intent === "reconcile") {
      if (final.state === "verified" && !finished.permitted) throw new IngressError(409, "source_changed");
      return receiptResponse(final);
    }
    if (!finished.permitted || !bytes || observedHash !== source.sha256 || final.state !== "verified") throw new IngressError(409, "source_changed");
    if (preview?.status === "preview") return Response.json(preview, { headers: HEADERS });
    if (page?.status === "rendered") return new Response(new Uint8Array(page.png), { headers: { ...HEADERS,
      "content-type": "image/png", "content-length": String(page.png.byteLength),
      "x-evo-template-page": JSON.stringify(page.metadata), "cross-origin-resource-policy": "same-origin" } });
    return new Response(new Uint8Array(bytes), { headers: { ...HEADERS, "content-type": source.mime_type,
      "content-length": String(bytes.byteLength), "content-disposition": source.mime_type === "application/pdf"
        ? 'inline; filename="university-template.pdf"' : 'attachment; filename="university-template.docx"',
      "content-security-policy": "sandbox; default-src 'none'", "cross-origin-resource-policy": "same-origin" } });
  });
}

export function createUniversityTemplateIngressHandlers(overrides: Partial<UniversityTemplateIngressDependencies> = {}) {
  const deps = { ...DEFAULTS, ...overrides };
  return {
    upload(request: Request, context: Context): Promise<Response> {
      return bounded(request, async signal => {
        const actor = actorFrom(await awaitUniversityTemplateOperation(() => deps.loadActor(), signal));
        const params = await awaitUniversityTemplateOperation(() => context.params, signal);
        try { templateIngressUuid(params.templateId); templateIngressUuid(params.versionId); } catch { throw new IngressError(400, "invalid_request"); }
        const command = uploadCommand(request);
        let identity; try { identity = deps.readIdentity(); } catch { throw new IngressError(503, "template_runtime_unavailable"); }
        const config = deps.backendConfig();
        return byteOperation(async retain => {
          const session = await awaitUniversityTemplateOperation(() => deps.createSessionClient(), signal);
          const prepared = templateIngressRecord(await rpc(session, "prepare_university_template_ingress", {
            p_template_id: params.templateId, p_template_version_id: params.versionId, p_expected_revision: command.expected, p_request_id: command.requestId,
          }, signal), ["receipt"]);
          const receipt = normalizeUniversityTemplateIngressReceipt(prepared.receipt, params.templateId, params.versionId);
          if (receipt.request_id !== command.requestId) throw new IngressError(503, "unavailable");
          // An explicit replay may settle an expired pre-seal claim; begin never
          // gives an existing claim to a second worker or starts an implicit retry.
          if (receipt.state !== "prepared" && receipt.state !== "processing") return receiptResponse(receipt);
          const service = deps.createServiceClient();
          const begun = templateIngressRecord(await rpc(service, "begin_university_template_ingress", { p_ingress_id: receipt.ingress_id,
            p_actor_auth_user_id: actor.authUserId, p_actor_membership_id: actor.membershipId }, signal), ["receipt", "claim_token", "source", "expires_at"]);
          const current = normalizeUniversityTemplateIngressReceipt(begun.receipt, params.templateId, params.versionId);
          if (current.ingress_id !== receipt.ingress_id || current.request_id !== command.requestId) throw new IngressError(503, "unavailable");
          if (begun.claim_token === null) {
            if (begun.source !== null || begun.expires_at !== null) throw new IngressError(503, "unavailable");
            return receiptResponse(current);
          }
          const claim = templateIngressUuid(begun.claim_token), source = sourceFrom(begun.source, actor.organizationId, params.templateId, params.versionId, command.expected, current);
          if (current.state !== "processing") throw new IngressError(503, "unavailable");
          freshExpiry(begun.expires_at, 121_000);
          return processUpload(request, command.mime, current, claim, source, identity, service, config, deps, signal, retain);
        });
      });
    },
    cancel(request: Request, context: Context): Promise<Response> {
      return bounded(request, async signal => {
        actorFrom(await awaitUniversityTemplateOperation(() => deps.loadActor(), signal));
        const { template, version } = await routeContext(context, signal), command = await readCommand(request, signal);
        const session = await awaitUniversityTemplateOperation(() => deps.createSessionClient(), signal);
        const result = normalizeUniversityTemplateIngressReceipt(await rpc(session, "cancel_university_template_ingress", {
          p_template_id: template, p_template_version_id: version, p_expected_revision: command.expected,
          p_request_id: command.requestId, p_reason: command.reason }, signal), template, version);
        if (result.state !== "cancelled") throw new IngressError(409, "not_active");
        return receiptResponse(result);
      }, 25_000);
    },
    status(request: Request, context: Context): Promise<Response> {
      return bounded(request, async signal => {
        actorFrom(await awaitUniversityTemplateOperation(() => deps.loadActor(), signal));
        const { template, version } = await routeContext(context, signal);
        const session = await awaitUniversityTemplateOperation(() => deps.createSessionClient(), signal);
        return Response.json(await readMetadata(session, template, version, signal), { headers: HEADERS });
      }, 20_000);
    },
    read(request: Request, context: Context): Promise<Response> {
      return bounded(request, signal => accessSource(request, context, "read", deps, signal), 50_000);
    },
    preview(request: Request, context: Context): Promise<Response> {
      return bounded(request, signal => accessSource(request, context, "preview", deps, signal), 55_000);
    },
    page(request: Request, context: Context): Promise<Response> {
      return bounded(request, signal => accessSource(request, context, "page", deps, signal), 55_000);
    },
    reconcile(request: Request, context: Context): Promise<Response> {
      return bounded(request, signal => accessSource(request, context, "reconcile", deps, signal), 55_000);
    },
  };
}
