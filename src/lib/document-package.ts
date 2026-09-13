/** Pure package content rules. No Auth, Storage, scanner or publication authority. */
export const PACKAGE_LIMITS = Object.freeze({ items: 40, documentBytes: 25 * 1024 * 1024, generatedBytes: 20 * 1024 * 1024,
  sourceBytes: 64 * 1024 * 1024, manifestBytes: 64 * 1024, archiveBytes: 65 * 1024 * 1024 });
export type PackageSourceKind = "document_version" | "university_form_export" | "student_profile_export";
export type PackageRole = "original" | "translation" | "appendix" | "generated";
export type PackageSourceRef = { readonly kind: "document_version"; readonly documentId: string; readonly versionId: string }
  | { readonly kind: "university_form_export" | "student_profile_export"; readonly exportId: string };
export interface PackageDocumentVersion { readonly documentId: string; readonly versionId: string; readonly sha256: string }
export interface PackageRuleSlot {
  readonly id: string; readonly required: boolean; readonly sourceKind: PackageSourceKind;
  readonly role: PackageRole; readonly documentTypeCode: string | null;
  readonly allowedMimeTypes: readonly string[]; readonly maxBytes: number | null; readonly minPages: number | null;
}
export interface PackageRules { readonly versionId: string; readonly slots: readonly PackageRuleSlot[] }
export interface PackageRulesSnapshot extends PackageRules { readonly sha256: string }
interface PackageProfileInput {
  readonly organizationId: string; readonly studentCaseId: string; readonly profileId: string; readonly profileRevision: number;
  readonly fieldReviewsSha256: string; readonly templateSha256: string;
}
export type PackageGeneratedInput = (PackageProfileInput & { readonly kind: "student_profile" })
  | (PackageProfileInput & { readonly kind: "university_form"; readonly applicationId: string; readonly catalogInstitutionId: string;
    readonly templateVersionId: string; readonly mappingVersionId: string; readonly mappingSha256: string; readonly mappingReviewVersionId: string });
export interface PackageGeneratedExport {
  readonly generationReceiptId: string; readonly exportId: string; readonly artifactSha256: string;
  readonly mode: "draft" | "final"; readonly outcome: "ready" | "pending" | "unknown" | "failed";
  readonly inputSha256: string; readonly input: PackageGeneratedInput; readonly currentInput: PackageGeneratedInput;
}
export interface PackageSource {
  readonly ref: PackageSourceRef; readonly organizationId: string; readonly studentCaseId: string;
  readonly sha256: string; readonly sizeBytes: number; readonly mimeType: string;
  readonly role: PackageRole; readonly documentTypeCode: string | null; readonly parent: PackageDocumentVersion | null;
  readonly available: boolean; readonly export: PackageGeneratedExport | null;
}
export interface PackageItemReview {
  readonly id: string; readonly packageId: string; readonly itemId: string; readonly ref: PackageSourceRef;
  readonly sourceSha256: string; readonly parent: PackageDocumentVersion | null;
  readonly rulesVersionId: string; readonly rulesSha256: string; readonly state: "approved" | "rejected";
  readonly verifiedPages: number | null; readonly reviewerMembershipId: string; readonly reviewedAt: string;
}
export interface PackageItem {
  readonly id: string; readonly slotId: string; readonly selected: boolean;
  readonly source: PackageSource | null; readonly review: PackageItemReview | null;
}
export interface DocumentPackageSnapshot {
  readonly packageId: string; readonly organizationId: string; readonly studentCaseId: string;
  readonly applicationId: string | null; readonly catalogInstitutionId: string | null; readonly revision: number;
  readonly rules: PackageRulesSnapshot; readonly items: readonly PackageItem[];
  readonly currentDocumentVersions: readonly PackageDocumentVersion[];
}
export interface PackageCheck { readonly code: string; readonly itemId: string | null; readonly slotId: string | null }
export interface ResolvedPackageItem extends PackageItem {
  readonly required: boolean; readonly path: string | null; readonly checks: readonly PackageCheck[];
  readonly draftEligible: boolean; readonly finalEligible: boolean;
}
export interface DocumentPackageResolution {
  readonly snapshot: DocumentPackageSnapshot; readonly inputSha256: string; readonly contentReady: boolean;
  readonly checks: readonly PackageCheck[]; readonly items: readonly ResolvedPackageItem[];
}
export class DocumentPackageError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "DocumentPackageError"; this.code = code; }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png"];
const GENERATED_MIMES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
const resolutions = new WeakSet<DocumentPackageResolution>();
function fail(code = "invalid_package_snapshot"): never { throw new DocumentPackageError(code); }
function uuid(value: string): string { if (typeof value !== "string" || !UUID.test(value)) fail(); return value; }
function hash(value: string): string { if (typeof value !== "string" || !HASH.test(value)) fail(); return value; }
function integer(value: number, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(); return value; }
function bool(value: boolean): boolean { if (typeof value !== "boolean") fail(); return value; }
function nullableId(value: string | null): string | null { return value === null ? null : uuid(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function order<T extends { readonly id: string }>(items: readonly T[]): T[] { return [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) fail(); }
function ref(value: PackageSourceRef): PackageSourceRef {
  if (!value) fail();
  if (value.kind === "document_version") return { kind: value.kind, documentId: uuid(value.documentId), versionId: uuid(value.versionId) };
  if (["university_form_export", "student_profile_export"].includes(value.kind)) return { kind: value.kind, exportId: uuid(value.exportId) };
  return fail();
}
function version(value: PackageDocumentVersion): PackageDocumentVersion {
  if (!value) fail();
  return { documentId: uuid(value.documentId), versionId: uuid(value.versionId), sha256: hash(value.sha256) };
}
function typeCode(value: string | null): string | null {
  if (value !== null && (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(value))) fail();
  return value;
}
function rules(value: PackageRules): PackageRules {
  if (!value || !Array.isArray(value.slots) || value.slots.length > PACKAGE_LIMITS.items) fail();
  const slots = value.slots.map(slot => {
    if (!slot || !["document_version", "university_form_export", "student_profile_export"].includes(slot.sourceKind)) fail();
    const document = slot.sourceKind === "document_version";
    if (!(document ? ["original", "translation", "appendix"] : ["generated"]).includes(slot.role)) fail();
    if (document ? !typeCode(slot.documentTypeCode) : slot.documentTypeCode !== null) fail();
    if (!Array.isArray(slot.allowedMimeTypes) || !slot.allowedMimeTypes.length
      || slot.allowedMimeTypes.some((mime: string) => !(document ? DOC_MIMES : GENERATED_MIMES).includes(mime))) fail();
    unique(slot.allowedMimeTypes);
    return { id: uuid(slot.id), required: bool(slot.required), sourceKind: slot.sourceKind, role: slot.role, documentTypeCode: slot.documentTypeCode,
      allowedMimeTypes: [...slot.allowedMimeTypes].sort(), maxBytes: slot.maxBytes === null ? null : integer(slot.maxBytes, document ? PACKAGE_LIMITS.documentBytes : PACKAGE_LIMITS.generatedBytes),
      minPages: slot.minPages === null ? null : integer(slot.minPages, 1000) };
  });
  unique(slots.map(slot => slot.id));
  return { versionId: uuid(value.versionId), slots: order(slots) };
}
/** Stable JSON for already-normalized library data, independent of insertion order. */
export function packageCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(packageCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${packageCanonicalJson(item)}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) fail();
  return result;
}
async function digest(value: unknown): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(packageCanonicalJson(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function computePackageRulesHash(value: PackageRules): Promise<string> { return digest(rules(value)); }
function generatedInput(value: PackageGeneratedInput): PackageGeneratedInput {
  if (!value) fail();
  const common = { organizationId: uuid(value.organizationId), studentCaseId: uuid(value.studentCaseId), profileId: uuid(value.profileId),
    profileRevision: integer(value.profileRevision), fieldReviewsSha256: hash(value.fieldReviewsSha256), templateSha256: hash(value.templateSha256) };
  if (value.kind === "student_profile") return { kind: value.kind, ...common };
  if (value.kind === "university_form") return { kind: value.kind, ...common, applicationId: uuid(value.applicationId), catalogInstitutionId: uuid(value.catalogInstitutionId),
    templateVersionId: uuid(value.templateVersionId), mappingVersionId: uuid(value.mappingVersionId), mappingSha256: hash(value.mappingSha256), mappingReviewVersionId: uuid(value.mappingReviewVersionId) };
  return fail();
}
export async function computePackageGeneratedInputHash(value: PackageGeneratedInput): Promise<string> { return digest(generatedInput(value)); }
function generatedExport(value: PackageGeneratedExport): PackageGeneratedExport {
  if (!value || !["draft", "final"].includes(value.mode) || !["ready", "pending", "unknown", "failed"].includes(value.outcome)) fail();
  return { generationReceiptId: uuid(value.generationReceiptId), exportId: uuid(value.exportId), artifactSha256: hash(value.artifactSha256), mode: value.mode, outcome: value.outcome, inputSha256: hash(value.inputSha256),
    input: generatedInput(value.input), currentInput: generatedInput(value.currentInput) };
}
function source(value: PackageSource): PackageSource {
  const reference = ref(value.ref), document = reference.kind === "document_version";
  if (!(document ? DOC_MIMES : GENERATED_MIMES).includes(value.mimeType)
    || !(document ? ["original", "translation", "appendix"] : ["generated"]).includes(value.role)) fail();
  const parent = value.parent === null ? null : version(value.parent);
  if ((value.role === "translation" || value.role === "appendix") !== !!parent || (document ? value.export !== null : value.export === null)) fail();
  if (document && parent?.documentId === reference.documentId) fail();
  if (document ? !typeCode(value.documentTypeCode) : value.documentTypeCode !== null) fail();
  return { ref: reference, organizationId: uuid(value.organizationId), studentCaseId: uuid(value.studentCaseId), sha256: hash(value.sha256),
    sizeBytes: integer(value.sizeBytes, document ? PACKAGE_LIMITS.documentBytes : PACKAGE_LIMITS.generatedBytes), mimeType: value.mimeType,
    role: value.role, documentTypeCode: value.documentTypeCode, parent, available: bool(value.available), export: value.export === null ? null : generatedExport(value.export) };
}
function review(value: PackageItemReview): PackageItemReview {
  if (!value || !["approved", "rejected"].includes(value.state) || typeof value.reviewedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.reviewedAt) || !Number.isFinite(Date.parse(value.reviewedAt))) fail();
  return { id: uuid(value.id), packageId: uuid(value.packageId), itemId: uuid(value.itemId), ref: ref(value.ref), sourceSha256: hash(value.sourceSha256),
    parent: value.parent === null ? null : version(value.parent), rulesVersionId: uuid(value.rulesVersionId), rulesSha256: hash(value.rulesSha256), state: value.state,
    verifiedPages: value.verifiedPages === null ? null : integer(value.verifiedPages, 1000), reviewerMembershipId: uuid(value.reviewerMembershipId), reviewedAt: value.reviewedAt };
}
function normalize(value: DocumentPackageSnapshot): DocumentPackageSnapshot {
  if (!value || !Array.isArray(value.items) || value.items.length > PACKAGE_LIMITS.items || !Array.isArray(value.currentDocumentVersions)
    || value.currentDocumentVersions.length > PACKAGE_LIMITS.items * 2) fail();
  const normalizedRules = { ...rules(value.rules), sha256: hash(value.rules.sha256) };
  const items = value.items.map(item => ({ id: uuid(item.id), slotId: uuid(item.slotId), selected: bool(item.selected),
    source: item.source === null ? null : source(item.source), review: item.review === null ? null : review(item.review) }));
  unique(items.map(item => item.id)); unique(items.map(item => item.slotId));
  if (items.some(item => !normalizedRules.slots.some(slot => slot.id === item.slotId))) fail();
  const versions = value.currentDocumentVersions.map(version);
  unique(versions.map(item => item.documentId));
  if ((value.applicationId === null) !== (value.catalogInstitutionId === null)) fail();
  if (items.some(item => item.source && (item.source.organizationId !== value.organizationId || item.source.studentCaseId !== value.studentCaseId))) fail("package_scope_mismatch");
  return { packageId: uuid(value.packageId), organizationId: uuid(value.organizationId), studentCaseId: uuid(value.studentCaseId),
    applicationId: nullableId(value.applicationId), catalogInstitutionId: nullableId(value.catalogInstitutionId), revision: integer(value.revision),
    rules: normalizedRules, items: order(items), currentDocumentVersions: versions.sort((a, b) => a.documentId < b.documentId ? -1 : 1) };
}
export async function resolveDocumentPackage(input: DocumentPackageSnapshot, expectedRevision: number): Promise<DocumentPackageResolution> {
  // Project only bounded known fields synchronously, before yielding; do not clone opaque input properties.
  let snapshot: DocumentPackageSnapshot;
  try { snapshot = normalize(input); }
  catch (error) { if (error instanceof DocumentPackageError) throw error; return fail(); }
  if (snapshot.revision !== integer(expectedRevision)) fail("package_revision_conflict");
  if (await computePackageRulesHash(snapshot.rules) !== snapshot.rules.sha256) fail("package_rules_mismatch");
  const checks: PackageCheck[] = [];
  const exportHashes = new Map<string, string>();
  for (const item of snapshot.items) if (item.source?.export) exportHashes.set(item.id, await digest(item.source.export.input));
  const items = snapshot.items.map(item => {
    const slot = snapshot.rules.slots.find(slot => slot.id === item.slotId)!;
    const itemChecks: PackageCheck[] = [];
    const add = (code: string) => itemChecks.push({ code, itemId: item.id, slotId: slot.id });
    if (!item.selected && slot.required) add("required_not_selected");
    if (item.selected) {
      if (!item.source) add("source_missing");
      else {
        const file = item.source;
        if (file.organizationId !== snapshot.organizationId || file.studentCaseId !== snapshot.studentCaseId) fail("package_scope_mismatch");
        if (file.ref.kind !== slot.sourceKind || file.role !== slot.role || file.documentTypeCode !== slot.documentTypeCode) add("source_slot_mismatch");
        if (!file.available) add("source_unavailable");
        if (file.ref.kind === "document_version") {
          const reference = file.ref;
          const current = snapshot.currentDocumentVersions.find(value => value.documentId === reference.documentId);
          if (!current || current.versionId !== reference.versionId || current.sha256 !== file.sha256) add("source_version_stale");
        }
        if (file.parent) {
          const parent = file.parent;
          const current = snapshot.currentDocumentVersions.find(value => value.documentId === parent.documentId);
          if (!current || current.versionId !== parent.versionId || current.sha256 !== parent.sha256) add("parent_version_stale");
        }
        if (file.export) {
          const receipt = file.export, original = receipt.input, current = receipt.currentInput;
          const kind = file.ref.kind === "student_profile_export" ? "student_profile" : "university_form";
          if (original.kind !== kind || current.kind !== kind || [original, current].some(input => input.organizationId !== snapshot.organizationId || input.studentCaseId !== snapshot.studentCaseId)
            || [original, current].some(input => input.kind === "university_form" && (input.applicationId !== snapshot.applicationId || input.catalogInstitutionId !== snapshot.catalogInstitutionId))) fail("package_scope_mismatch");
          if (receipt.outcome !== "ready") add("export_not_ready");
          if (file.ref.kind === "document_version" || receipt.exportId !== file.ref.exportId || receipt.artifactSha256 !== file.sha256) add("export_reference_mismatch");
          if (exportHashes.get(item.id) !== receipt.inputSha256) add("export_input_mismatch");
          if (packageCanonicalJson(original) !== packageCanonicalJson(current)) add("export_input_stale");
          if (receipt.mode === "draft") add("source_is_draft");
        }
        if (!slot.allowedMimeTypes.includes(file.mimeType)) add("format_not_allowed");
        if (slot.maxBytes !== null && file.sizeBytes > slot.maxBytes) add("rule_size_exceeded");
        if (!item.review) add("review_missing");
        else if (item.review.state !== "approved") add("review_rejected");
        else if (item.review.packageId !== snapshot.packageId || item.review.itemId !== item.id || packageCanonicalJson(item.review.ref) !== packageCanonicalJson(file.ref)
          || item.review.sourceSha256 !== file.sha256 || packageCanonicalJson(item.review.parent) !== packageCanonicalJson(file.parent)
          || item.review.rulesVersionId !== snapshot.rules.versionId || item.review.rulesSha256 !== snapshot.rules.sha256) add("review_stale");
        if (slot.minPages !== null && (item.review?.verifiedPages ?? 0) < slot.minPages) add("pages_unverified");
      }
    }
    const eligible = item.selected && item.source !== null;
    checks.push(...itemChecks);
    const path = item.source ? `${item.source.ref.kind === "document_version" ? `documents/${item.source.role}` : item.source.ref.kind}/${item.id}.${EXTENSIONS[item.source.mimeType]}` : null;
    return { ...item, required: slot.required, path, checks: itemChecks, draftEligible: eligible && itemChecks.every(check => check.code === "source_is_draft"), finalEligible: eligible && itemChecks.length === 0 };
  });
  for (const slot of snapshot.rules.slots) if (slot.required && !items.some(item => item.slotId === slot.id)) checks.push({ code: "required_slot_missing", itemId: null, slotId: slot.id });
  if (!items.some(item => item.selected)) checks.push({ code: "empty_selection", itemId: null, slotId: null });
  if (items.reduce((sum, item) => sum + (item.selected ? item.source?.sizeBytes ?? 0 : 0), 0) > PACKAGE_LIMITS.sourceBytes) fail("package_too_large");
  const result = freeze({ snapshot, inputSha256: await digest(snapshot), contentReady: checks.length === 0, checks, items });
  resolutions.add(result);
  return result;
}
/** Brand validation is local to a worker. Resolve snapshots in that worker before building. */
export function assertDocumentPackageResolution(value: DocumentPackageResolution): void {
  if (!resolutions.has(value)) fail("invalid_package_resolution");
}
