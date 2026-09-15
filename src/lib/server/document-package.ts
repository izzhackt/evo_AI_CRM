import "server-only";
import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { assertDocumentPackageResolution, DocumentPackageError, PACKAGE_LIMITS, packageCanonicalJson } from "../document-package.ts";
import type { DocumentPackageResolution, PackageCheck } from "../document-package.ts";
import { DOCUMENT_PACKAGE_MAX_BYTES } from "../document-export-artifact-contract.ts";

export const DOCUMENT_PACKAGE_RENDERER_VERSION = "evo-package-zip-v1";
export interface PackageSourceBuffer { readonly itemId: string; readonly bytes: Buffer }
export type PackageMode = "draft" | "final";
export type PartnerPacketZipSource = Readonly<{ id: string; kind: "original" | "generated"; sha256: string;
  sizeBytes: number; mimeType: string; name: string; mode: PackageMode | null }>;
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

/** Only the session-prepared packet adapter supplies these exact authorized
 * snapshots. Unlike the older library draft resolver, every selected entry is
 * required: no omission, recomposition or invented review evidence. */
export function buildPartnerPacketZip(snapshot: Readonly<{ packetId: string; caseId: string; inputSha256: string;
  mode: PackageMode; sources: readonly PartnerPacketZipSource[] }>, input: readonly PackageSourceBuffer[]) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(snapshot.packetId) || !uuid.test(snapshot.caseId) || !/^[a-f0-9]{64}$/.test(snapshot.inputSha256)
    || !["draft", "final"].includes(snapshot.mode) || !Array.isArray(snapshot.sources)
    || snapshot.sources.length < 1 || snapshot.sources.length > 50 || !Array.isArray(input)
    || input.length !== snapshot.sources.length) fail("invalid_package_buffers");
  const buffers = new Map(input.map(item => [item.itemId, item.bytes]));
  if (buffers.size !== input.length) fail("invalid_package_buffers");
  let total = 0;
  const entries = snapshot.sources.map(source => {
    if (!uuid.test(source.id) || (source.kind !== "original" && source.kind !== "generated")
      || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.sizeBytes)
      || source.sizeBytes < 1 || source.sizeBytes > (source.kind === "original" ? 26214400 : 20971520)
      || typeof source.name !== "string" || source.name.length > 1000
      || (source.kind === "original" ? source.mode !== null : source.mode !== "draft" && source.mode !== "final")
      || (snapshot.mode === "final" && source.mode === "draft")) fail("invalid_package_source");
    const extension = ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" } as Record<string, string>)[source.mimeType];
    if (!extension || (source.kind === "original" && extension === "docx")
      || (source.kind === "generated" && extension !== "pdf" && extension !== "docx")) fail("invalid_package_source");
    const bytes = buffers.get(source.id);
    if (!Buffer.isBuffer(bytes) || bytes.length !== source.sizeBytes || sha256(bytes) !== source.sha256) fail("source_integrity_failed");
    total += bytes.length;
    if (total >= DOCUMENT_PACKAGE_MAX_BYTES) fail("package_too_large");
    return { source, path: `${source.kind}/${source.id}.${extension}`, bytes };
  }).sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (new Set(entries.map(entry => entry.source.id)).size !== entries.length) fail("invalid_package_buffers");
  const manifest = { schemaVersion: 1, rendererVersion: "evo-partner-packet-zip-v1", packetId: snapshot.packetId,
    studentCaseId: snapshot.caseId, inputSha256: snapshot.inputSha256, mode: snapshot.mode,
    items: entries.map(({ source, path }) => ({ ...source, path })) };
  const manifestBytes = Buffer.from(packageCanonicalJson(manifest), "utf8");
  if (manifestBytes.length > 65536) fail("package_manifest_too_large");
  const zip = new PizZip();
  const all = [...entries.map(({ path, bytes }) => ({ path, bytes })), { path: "manifest.json", bytes: manifestBytes },
    { path: "README.txt", bytes: Buffer.from(snapshot.mode === "draft"
      ? "EVO — DRAFT. Not for submission. Every selected entry is included. See manifest.json.\n"
      : "EVO — saved document package. Every selected entry is included. This is not a submission or delivery receipt. See manifest.json.\n") }];
  for (const entry of all.sort((a, b) => a.path.localeCompare(b.path, "en")))
    zip.file(entry.path, entry.bytes, { binary: true, createFolders: false, compression: "STORE",
      date: new Date(2000, 0, 1, 0, 0, 0), unixPermissions: 0o100644, dosPermissions: 0, comment: "" });
  const bytes = zip.generate({ type: "nodebuffer", compression: "STORE", platform: "UNIX", comment: "" });
  if (bytes.length > DOCUMENT_PACKAGE_MAX_BYTES) fail("package_archive_too_large");
  return { bytes, sha256: sha256(bytes), manifest };
}
