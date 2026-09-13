import "server-only";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { assertDocumentPackageResolution, DocumentPackageError, PACKAGE_LIMITS, packageCanonicalJson } from "../document-package.ts";
import type { DocumentPackageResolution, PackageCheck } from "../document-package.ts";

export const DOCUMENT_PACKAGE_RENDERER_VERSION = "evo-package-zip-v1";
export interface PackageSourceBuffer { readonly itemId: string; readonly bytes: Buffer }
export type PackageMode = "draft" | "final";
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
function fail(code: string): never { throw new DocumentPackageError(code); }
const readme = (mode: PackageMode): string => mode === "draft"
  ? "EVO document package — DRAFT. Not for submission. See manifest.json for every omitted or unresolved item.\nContent checks do not prove authorization, persistence, delivery, signature or consent.\n"
  : "EVO document package — FINAL CONTENT SNAPSHOT. See manifest.json for exact versions and reviews.\nContent checks do not prove authorization, persistence, delivery, signature or consent.\n";

/** Library only. The outer isolated worker must obtain authorized current snapshots and buffers. */
export async function buildDocumentPackageZip(resolution: DocumentPackageResolution, input: readonly PackageSourceBuffer[], options: { readonly mode: PackageMode }) {
  assertDocumentPackageResolution(resolution);
  const mode = options?.mode;
  if (mode !== "draft" && mode !== "final") fail("invalid_package_mode");
  if (!Array.isArray(input) || input.length > PACKAGE_LIMITS.items) fail("invalid_package_buffers");
  if (mode === "final" && !resolution.contentReady) fail("package_not_content_ready");
  const eligible = resolution.items.filter(item => mode === "final" ? item.finalEligible : item.draftEligible);
  const seen = new Set<string>();
  let total = 0;
  // Check the entire collection before copying or constructing a ZIP. No original is parsed.
  for (const item of input) {
    const expected = eligible.find(value => value.id === item?.itemId);
    if (!expected || seen.has(item.itemId) || !Buffer.isBuffer(item.bytes)) fail("invalid_package_buffers");
    seen.add(item.itemId);
    const limit = expected.source!.ref.kind === "document_version" ? PACKAGE_LIMITS.documentBytes : PACKAGE_LIMITS.generatedBytes;
    if (item.bytes.length < 1 || item.bytes.length > limit) fail("package_source_too_large");
    total += item.bytes.length;
    if (total > PACKAGE_LIMITS.sourceBytes) fail("package_too_large");
  }
  const buffers = new Map(input.map(item => [item.itemId, Buffer.from(item.bytes)]));
  const checks: PackageCheck[] = [...resolution.checks];
  const entries: { path: string; bytes: Buffer }[] = [];
  const items = resolution.items.map(item => {
    const codes = item.checks.map(check => check.code);
    let included = mode === "final" ? item.finalEligible : item.draftEligible;
    if (!item.selected) codes.push("not_selected");
    if (included) {
      const bytes = buffers.get(item.id);
      const code = !bytes ? "source_bytes_missing" : bytes.length !== item.source!.sizeBytes || sha256(bytes) !== item.source!.sha256 ? "source_integrity_failed" : null;
      if (code) {
        included = false; codes.push(code); checks.push({ code, itemId: item.id, slotId: item.slotId });
      } else entries.push({ path: item.path!, bytes: bytes! });
    }
    return { id: item.id, slotId: item.slotId, required: item.required, selected: item.selected, source: item.source, review: item.review,
      status: included ? "included" : "omitted", path: included ? item.path : null, checks: [...new Set(codes)] };
  });
  const contentReady = resolution.contentReady && checks.length === 0 && entries.length > 0;
  if (mode === "final" && !contentReady) fail("package_not_content_ready");
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const entryOrder = [...entries.map(item => item.path), "README.txt", "manifest.json"].sort();
  const inputSha256 = sha256(packageCanonicalJson({ snapshotSha256: resolution.inputSha256, mode,
    rendererVersion: DOCUMENT_PACKAGE_RENDERER_VERSION, entryOrder }));
  const snapshot = resolution.snapshot;
  const manifest = { schemaVersion: 1, rendererVersion: DOCUMENT_PACKAGE_RENDERER_VERSION, mode, inputSha256,
    snapshotSha256: resolution.inputSha256, packageId: snapshot.packageId, organizationId: snapshot.organizationId, studentCaseId: snapshot.studentCaseId,
    applicationId: snapshot.applicationId, catalogInstitutionId: snapshot.catalogInstitutionId, revision: snapshot.revision,
    rules: snapshot.rules, contentReady, items, checks, entryOrder };
  const manifestBytes = Buffer.from(packageCanonicalJson(manifest), "utf8");
  if (manifestBytes.length > PACKAGE_LIMITS.manifestBytes) fail("package_manifest_too_large");
  entries.push({ path: "manifest.json", bytes: manifestBytes }, { path: "README.txt", bytes: Buffer.from(readme(mode), "utf8") });
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const zip = new PizZip();
  for (const entry of entries) zip.file(entry.path, entry.bytes, { binary: true, createFolders: false, compression: "STORE",
    date: new Date(2000, 0, 1, 0, 0, 0), unixPermissions: 0o100644, dosPermissions: 0, comment: "" });
  // PizZip retains supplied buffers. They are owned copies and are never mutated here.
  const bytes = zip.generate({ type: "nodebuffer", compression: "STORE", platform: "UNIX", comment: "" });
  if (bytes.length > PACKAGE_LIMITS.archiveBytes) fail("package_archive_too_large");
  return { bytes, sha256: sha256(bytes), manifestSha256: sha256(manifestBytes), manifest };
}
