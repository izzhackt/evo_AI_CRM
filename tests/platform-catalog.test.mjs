import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformCatalogRepositoryError,
  listPlatformCatalogImportBatches,
  listPlatformCatalogInstitutions,
  normalizePlatformCatalogImportBatch,
  normalizePlatformCatalogImportCandidate,
  normalizePlatformCatalogInstitution,
  normalizePlatformCatalogSource,
} from "../src/lib/platform-catalog.ts";
import { deriveCatalogSourceRecordKey } from "../src/lib/platform-catalog-provenance.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "11111111-1111-4111-8111-222222222222";
const INSTITUTION_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-08-03T05:00:00+00:00";

function actor(platformRole) {
  return {
    authUserId: "66666666-6666-4666-8666-666666666666",
    profileId: "77777777-7777-4777-8777-777777777777",
    membershipId: "88888888-8888-4888-8888-888888888888",
    organizationId: ORGANIZATION_ID,
    displayName: "Catalog test actor",
    platformRole,
    platformAccessVersion: 10,
    role: platformRole === "student" ? "client" : platformRole,
  };
}

function institutionRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    catalog_institution_id: INSTITUTION_ID,
    institution_kind: "university",
    institution_name: "Synthetic Local University",
    country_code: "MY",
    city: "Kuala Lumpur",
    source_registry_id: SOURCE_ID,
    source_revision: "rev-2026.08.03",
    import_batch_id: BATCH_ID,
    approved_at: AT,
    ...overrides,
  };
}

function sourceRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    source_registry_id: SOURCE_ID,
    source_kind: "notion_database",
    source_url: "https://notion.so/0123456789abcdef0123456789abcdef",
    source_revision: "rev-2026.08.03",
    review_status: "reviewed",
    created_at: AT,
    reviewed_at: AT,
    ...overrides,
  };
}

function batchRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    catalog_import_batch_id: BATCH_ID,
    source_registry_id: SOURCE_ID,
    source_kind: "notion_database",
    source_url: "https://notion.so/0123456789abcdef0123456789abcdef",
    source_revision: "rev-2026.08.03",
    institution_kind: "university",
    status: "validated",
    candidate_count: "1",
    valid_candidate_count: "1",
    invalid_candidate_count: "0",
    created_at: AT,
    validated_at: AT,
    reviewed_at: null,
    review_reason: null,
    ...overrides,
  };
}

function candidateRow(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    catalog_import_candidate_id: CANDIDATE_ID,
    catalog_import_batch_id: BATCH_ID,
    source_record_key: `rec_${"a".repeat(64)}`,
    institution_name: "Synthetic Local University",
    country_code: "MY",
    city: "Kuala Lumpur",
    validation_status: "valid",
    validation_errors: [],
    catalog_institution_id: null,
    created_at: AT,
    ...overrides,
  };
}

test("catalog projections accept only bounded typed, tenant-matched data", () => {
  const institution = normalizePlatformCatalogInstitution(
    institutionRow(),
    ORGANIZATION_ID,
  );
  assert.equal(institution.catalogInstitutionId, INSTITUTION_ID);
  assert.equal(institution.countryCode, "MY");

  const source = normalizePlatformCatalogSource(sourceRow(), ORGANIZATION_ID);
  assert.equal(source.reviewStatus, "reviewed");

  const batch = normalizePlatformCatalogImportBatch(batchRow(), ORGANIZATION_ID);
  assert.equal(batch.candidateCount, 1);
  assert.equal(batch.validCandidateCount, 1);

  const candidate = normalizePlatformCatalogImportCandidate(
    candidateRow(),
    ORGANIZATION_ID,
    BATCH_ID,
  );
  assert.deepEqual(candidate.validationErrors, []);

  const oneCharacterInstitution = normalizePlatformCatalogImportCandidate(
    candidateRow({ institution_name: "A" }),
    ORGANIZATION_ID,
    BATCH_ID,
  );
  assert.equal(oneCharacterInstitution.institutionName, "A");
});

test("catalog projections preserve a staging batch rejected before validation", () => {
  const rejectedBatch = normalizePlatformCatalogImportBatch(
    batchRow({
      status: "rejected",
      candidate_count: "1",
      valid_candidate_count: "0",
      invalid_candidate_count: "0",
      validated_at: null,
      reviewed_at: AT,
      review_reason: "Rejected before validation",
    }),
    ORGANIZATION_ID,
  );

  assert.equal(rejectedBatch.status, "rejected");
  assert.equal(rejectedBatch.candidateCount, 1);
  assert.equal(rejectedBatch.validCandidateCount, 0);
  assert.equal(rejectedBatch.invalidCandidateCount, 0);
});

test("catalog projections fail closed on tenant, provenance, count, and validation drift", () => {
  for (const operation of [
    () =>
      normalizePlatformCatalogInstitution(
        institutionRow({ organization_id: OTHER_ORGANIZATION_ID }),
        ORGANIZATION_ID,
      ),
    () =>
      normalizePlatformCatalogInstitution(
        institutionRow({ country_code: "Malaysia" }),
        ORGANIZATION_ID,
      ),
    () =>
      normalizePlatformCatalogSource(
        sourceRow({ source_url: "https://notion.so/ok?token=secret" }),
        ORGANIZATION_ID,
      ),
    () =>
      normalizePlatformCatalogImportBatch(
        batchRow({ candidate_count: 1, valid_candidate_count: 1, invalid_candidate_count: 1 }),
        ORGANIZATION_ID,
      ),
    () =>
      normalizePlatformCatalogImportCandidate(
        candidateRow({ validation_status: "invalid", validation_errors: [] }),
        ORGANIZATION_ID,
        BATCH_ID,
      ),
    () =>
      normalizePlatformCatalogImportCandidate(
        candidateRow({ source_record_key: "customer@example.test" }),
        ORGANIZATION_ID,
        BATCH_ID,
      ),
  ]) {
    assert.throws(operation, PlatformCatalogRepositoryError);
  }
});

test("catalog repository rejects finance and student before opening a provider client", async () => {
  await assert.rejects(
    () => listPlatformCatalogInstitutions(actor("finance")),
    PlatformCatalogRepositoryError,
  );
  await assert.rejects(
    () => listPlatformCatalogImportBatches(actor("student")),
    PlatformCatalogRepositoryError,
  );
});

test("catalog source-row provenance stays stable across import batches", () => {
  const reference = "notion-row-42";
  const firstImport = deriveCatalogSourceRecordKey(ORGANIZATION_ID, reference);
  const laterImport = deriveCatalogSourceRecordKey(ORGANIZATION_ID, reference);

  assert.match(firstImport, /^rec_[a-f0-9]{64}$/);
  assert.equal(laterImport, firstImport);
  assert.notEqual(
    deriveCatalogSourceRecordKey("22222222-2222-4222-8222-222222222222", reference),
    firstImport,
  );
});

test("catalog UI remains inside the accepted applications route and preserves uncertain retries", () => {
  const route = readFileSync(
    new URL("../src/app/(staff)/applications/page.tsx", import.meta.url),
    "utf8",
  );
  const loader = readFileSync(
    new URL(
      "../src/app/(staff)/applications/PlatformApplicationsPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const presenter = readFileSync(
    new URL(
      "../src/app/(staff)/applications/ApplicationsPresenter.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const actions = readFileSync(
    new URL("../src/lib/platform-catalog-actions.ts", import.meta.url),
    "utf8",
  );
  const institutionFields = readFileSync(
    new URL(
      "../src/app/(staff)/applications/ApplicationInstitutionFields.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const catalogWorkspace = readFileSync(
    new URL(
      "../src/app/(staff)/applications/CatalogImportWorkspace.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /ApplicationsQueuePresenter/);
  assert.match(loader, /listPlatformCatalogInstitutions/);
  assert.match(loader, /source_rejected:[^\n]*Источник отклонён/);
  assert.match(loader, /batch_rejected:[^\n]*Batch отклонён/);
  assert.match(presenter, /CatalogImportWorkspace/);
  assert.match(presenter, /ApplicationInstitutionFields/);
  assert.match(actions, /catalog_retry_request_id/);
  assert.match(actions, /decision === "reviewed" \? "source_reviewed" : "source_rejected"/);
  assert.match(institutionFields, /required=\{usesManualInstitution\}/);
  assert.match(institutionFields, /disabled=\{!usesManualInstitution\}/);
  assert.match(institutionFields, /aria-required=\{usesManualInstitution\}/);
  assert.match(catalogWorkspace, /htmlFor=\{`source-review-reason-/);
  assert.match(catalogWorkspace, /htmlFor=\{`catalog-approve-reason-/);
  assert.match(catalogWorkspace, /htmlFor=\{`catalog-reject-reason-/);

  for (const actionName of [
    "registerPlatformCatalogSourceAction",
    "reviewPlatformCatalogSourceAction",
    "createPlatformCatalogImportBatchAction",
    "stagePlatformCatalogImportCandidateAction",
    "validatePlatformCatalogImportBatchAction",
    "reviewPlatformCatalogImportBatchAction",
  ]) {
    const actionStart = actions.indexOf(`export async function ${actionName}`);
    assert.notEqual(actionStart, -1, `${actionName} is missing`);
    const nextActionStart = actions.indexOf("export async function ", actionStart + 1);
    const actionBody = actions.slice(
      actionStart,
      nextActionStart === -1 ? actions.length : nextActionStart,
    );
    assert.match(
      actionBody,
      /const actor = await requireAdmin\(\);/,
      `${actionName} must re-check live Admin authority`,
    );
  }

  for (const source of [
    loader,
    presenter,
    actions,
    institutionFields,
    catalogWorkspace,
  ]) {
    assert.doesNotMatch(source, /localStorage|demo fallback|mock provider/i);
  }
});
