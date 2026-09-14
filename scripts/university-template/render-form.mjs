import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import { normalizePlatformStudentProfileFieldsSnapshot } from "../../src/lib/platform-student-profile-fields.ts";
import { computePackageGeneratedInputHash } from "../../src/lib/document-package.ts";
import { getUniversityFormAssignments, resolveUniversityFormMappings } from "../../src/lib/university-form-fields.ts";
import { inspectUniversityDocx, fillUniversityDocx } from "../../src/lib/server/university-form-docx.ts";
import { inspectUniversityPdf, fillUniversityPdf } from "../../src/lib/server/university-form-pdf.ts";
import { encodeUniversityFormCapsule, normalizeUniversityFormRequest, universityFormRenderWarnings,
  UNIVERSITY_FORM_RENDER_CAPSULE_DOMAIN, UNIVERSITY_FORM_RENDER_MAX_CAPSULE, UNIVERSITY_FORM_RENDER_MAX_BYTES,
  UNIVERSITY_FORM_RENDER_MAX_METADATA, UNIVERSITY_FORM_RENDER_POLICY, UNIVERSITY_FORM_RENDER_STATES } from "../../src/lib/university-form-render.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { formRenderCode: code }); };
function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function readExact(length) {
  const bytes = Buffer.allocUnsafe(length); let read = 0;
  while (read < length) {
    const amount = readSync(0, bytes, read, length - read, null);
    if (!amount) fail("invalid_input");
    read += amount;
  }
  return bytes;
}
function readRequest() {
  const header = readExact(12), capsuleLength = header.readUInt32BE(4), sourceLength = header.readUInt32BE(8);
  if (!header.subarray(0, 4).equals(Buffer.from("EUFQ")) || capsuleLength < 1 || capsuleLength > UNIVERSITY_FORM_RENDER_MAX_CAPSULE
    || sourceLength < 1 || sourceLength > UNIVERSITY_FORM_RENDER_MAX_BYTES) fail("invalid_input");
  const capsule = readExact(capsuleLength);
  if (capsule.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail("invalid_input");
  const request = normalizeUniversityFormRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(capsule)));
  if (!capsule.equals(Buffer.from(encodeUniversityFormCapsule(request))) || request.formInput.source_byte_size !== sourceLength) fail("invalid_input");
  const bytes = readExact(sourceLength);
  if (readSync(0, Buffer.alloc(1), 0, 1, null) !== 0) fail("invalid_input");
  return { request, capsule, bytes };
}

/** Production entrypoint, imported only after bootstrap's required OS seal. */
export async function runRenderFormRequest() {
  let diagnostic = false, phase = "request", output = Buffer.alloc(0), metadata;
  // Fixed inspector advisory return values are not console diagnostics.
  for (const method of ["log", "warn", "error", "info", "debug"]) console[method] = () => { diagnostic = true; };
  try {
    const { request, capsule, bytes } = readRequest(), f = request.formInput;
    const profile = normalizePlatformStudentProfileFieldsSnapshot(f.frozen_profile, f.student_case_id);
    phase = "binding";
    if (sha(bytes) !== f.template.sha256) fail("binding_mismatch");
    const packageHash = await computePackageGeneratedInputHash({ kind: "university_form", organizationId: f.organization_id,
      studentCaseId: f.student_case_id, profileId: profile.profile.id, profileRevision: profile.profile.revision,
      fieldReviewsSha256: request.binding.fieldReviewsSha256, templateSha256: f.template.sha256, applicationId: f.form.application_id,
      catalogInstitutionId: f.form.catalog_institution_id, templateVersionId: f.template.versionId, mappingVersionId: f.mapping.versionId,
      mappingSha256: f.mapping.sha256, mappingReviewVersionId: f.review.versionId });
    if (packageHash !== request.binding.generatedInputSha256) fail("binding_mismatch");
    phase = "source";
    const pdf = f.template.manifest.format === "pdf", inspected = pdf ? await inspectUniversityPdf(bytes) : inspectUniversityDocx(bytes);
    const manifest = pdf ? { format: "pdf", slots: [], pageSizes: inspected.pageSizes }
      : { format: "docx", slots: inspected.slots.map(({ id, editable }) => ({ id, editable })), pageSizes: [] };
    if (JSON.stringify(manifest) !== JSON.stringify(f.template.manifest)) fail("binding_mismatch");
    const template = freeze(pdf ? { versionId: f.template.versionId, sha256: f.template.sha256, format: "pdf", slots: [], pageSizes: inspected.pageSizes }
      : { versionId: f.template.versionId, sha256: f.template.sha256, format: "docx", slots: inspected.slots });
    phase = "resolve";
    // Resolver captures/freezes again and creates its process-local WeakSet brand.
    const resolution = await resolveUniversityFormMappings({ template, mapping: f.mapping, review: f.review,
      profile: { fields: profile.fields }, today: f.form.validation_day });
    const assignments = getUniversityFormAssignments(resolution, f.mode);
    phase = "fill";
    output = pdf ? await fillUniversityPdf(bytes, resolution, { draft: f.mode === "draft" })
      : fillUniversityDocx(bytes, assignments, { draft: f.mode === "draft" });
    if (!output.length || output.length > UNIVERSITY_FORM_RENDER_MAX_BYTES) fail("output_too_large");
    phase = "output";
    if (pdf) {
      const outputInspection = await inspectUniversityPdf(output);
      if (JSON.stringify(outputInspection.pageSizes) !== JSON.stringify(inspected.pageSizes)) fail("source_unavailable");
    } else inspectUniversityDocx(output);
    if (diagnostic) fail("source_unavailable");
    const counts = Object.fromEntries(UNIVERSITY_FORM_RENDER_STATES.map(state => [state, resolution.values.filter(value => value.state === state).length]));
    metadata = { status: "rendered", policyVersion: UNIVERSITY_FORM_RENDER_POLICY, ...request.binding,
      capsuleSha256: createHash("sha256").update(UNIVERSITY_FORM_RENDER_CAPSULE_DOMAIN).update(capsule).digest("hex"),
      templateSha256: sha(bytes), sourceByteLength: bytes.length, manifestSha256: f.manifest_sha256, manifestDigest: sha(JSON.stringify(manifest)),
      mode: f.mode, mimeType: f.source_mime_type, rendererVersion: f.renderer_version,
      rendererId: pdf ? "pdf-lib-1.17.1-fontkit-1.1.1" : "pizzip-3.2.0-xmldom-0.9.12", fontSha256: f.font_sha256,
      pageCount: pdf ? inspected.pageSizes.length : null, outputByteLength: output.length, outputSha256: sha(output),
      counts, warnings: universityFormRenderWarnings(counts, f.mode) };
  } catch (error) {
    const codes = { form_fields_not_ready: "form_not_ready", form_pdf_text_overflow: "text_overflow",
      form_pdf_character_unsupported: "character_unsupported", form_pdf_shaping_unsupported: "shaping_unsupported",
      form_pdf_font_unavailable: "source_unavailable" };
    const code = diagnostic ? "source_unavailable" : error.formRenderCode ?? codes[error.code]
      ?? (phase === "request" ? "invalid_input" : phase === "source" ? "template_not_eligible"
        : ["binding", "resolve"].includes(phase) ? "binding_mismatch"
          : phase === "fill" && ["form_size_invalid", "form_pdf_size_invalid", "form_archive_too_large", "form_xml_too_large"].includes(error.code)
            ? "output_too_large" : "source_unavailable");
    metadata = { status: "rejected", code }; output = Buffer.alloc(0);
  }
  const json = Buffer.from(JSON.stringify(metadata)), prefix = Buffer.alloc(12);
  if (!json.length || json.length > UNIVERSITY_FORM_RENDER_MAX_METADATA) throw new Error("form_metadata_limit");
  prefix.write("EUF1"); prefix.writeUInt32BE(json.length, 4); prefix.writeUInt32BE(output.length, 8);
  for (const bytes of [prefix, json, output]) for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    await new Promise((resolve, reject) => process.stdout.write(bytes.subarray(offset, offset + 64 * 1024), error => error ? reject(error) : resolve()));
  }
}
