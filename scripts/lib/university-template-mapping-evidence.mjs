// Validates recorded facts; it never executes or claims a browser run itself.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
export const TEMPLATE_MAPPING_CHECKS = Object.freeze([
  "actualDocxUpload", "actualSourcePreview", "actualMappingSave", "actualReadOnlyReview",
  "actualExplicitReview", "actualExplicitPublication", "coldResume", "responsiveScreenshots",
  "archivedHistoryReadable", "pageIdentityVerified", "noFrameworkOverlay",
]);
export function validateTemplateMappingProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !TEMPLATE_MAPPING_CHECKS.every(key => value[key] === true)
    || ![value.templateId, value.versionId, value.mappingId].every(id => typeof id === "string" && UUID.test(id))
    || ![value.sourceSha256, value.mappingSha256].every(sha => typeof sha === "string" && SHA.test(sha))
    || !Number.isSafeInteger(value.sourceBytes) || value.sourceBytes < 12 || value.sourceBytes > 20971520
    || value.generatedFormAcceptance !== false || value.fullD4Acceptance !== false || value.businessAcceptance !== false) {
    throw new Error("LOCAL_TEMPLATE_MAPPING_RECEIPT_INVALID");
  }
  return value;
}

export const TEMPLATE_PDF_MAPPING_CHECKS = Object.freeze([
  "actualSourcePage", "pointerRegion", "numericAdjustment", "keyboardAdjustment", "zoomResizeGeometry",
  "pageNavigationRetained", "actualMappingSave", "actualReadOnlyReview", "actualExplicitReview",
  "actualExplicitPublication", "coldResume", "responsiveScreenshots", "pageIdentityVerified", "noFrameworkOverlay",
]);
export function validateTemplatePdfMappingProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !TEMPLATE_PDF_MAPPING_CHECKS.every(key => value[key] === true)
    || ![value.templateId, value.versionId, value.mappingId].every(id => typeof id === "string" && UUID.test(id))
    || ![value.sourceSha256, value.mappingSha256, value.pagePngSha256].every(sha => typeof sha === "string" && SHA.test(sha))
    || value.pageCount !== 2 || value.generatedFormAcceptance !== false || value.fullD4Acceptance !== false || value.businessAcceptance !== false)
    throw new Error("LOCAL_TEMPLATE_PDF_MAPPING_RECEIPT_INVALID");
  return value;
}
