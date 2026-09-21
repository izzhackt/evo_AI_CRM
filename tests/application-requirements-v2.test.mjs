import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseApplicationRequirementsV2 } from "../src/lib/portal/application-requirements-v2.ts";
import {
  parseApplicationRequirements,
  parseApplicationRequirementsIntent,
  parseApplicationRequirementsReceipt,
} from "../src/lib/portal/application-requirements.ts";

// Protocol-only vectors shared with Swift. These are not university facts,
// backend execution, customer data, or evidence of the reserved full-write path.
const corpus = JSON.parse(readFileSync(new URL("./fixtures/application-requirements-v2.json", import.meta.url), "utf8"));
const parse = value => parseApplicationRequirementsV2(value, corpus.studentCaseId, corpus.applicationId);
for (const vector of corpus.cases) {
  test(`requirements v2 codec: ${vector.name}`, () => {
    const result = parse(vector.value);
    if (vector.valid) assert.deepEqual(result, vector.value);
    else assert.equal(result, null);
  });
}

test("v2 bounds use Unicode scalars and reject unpaired UTF-16 surrogates", () => {
  for (const key of ["label", "groupLabel", "instructions"]) {
    const value = structuredClone(corpus.cases.find(item => item.name === "full_three_items_optional_and_distinct_compatibility").value);
    value.items[0][key] = "\ud800";
    assert.equal(parse(value), null);
  }
});

test("v2 reads do not widen the historical v1 starter or initialization receipt", () => {
  const { protocolVersion, ...v1 } = structuredClone(corpus.cases.find(item => item.name === "starter_missing_files").value);
  assert.equal(protocolVersion, 2);
  v1.items = v1.items.map(({ deadline, reviewScope, definitionImpact, ...item }) => {
    assert.equal(deadline, null); assert.equal(reviewScope, "document_version"); assert.equal(definitionImpact, null);
    return item;
  });
  assert.deepEqual(parseApplicationRequirements(v1, corpus.studentCaseId, corpus.applicationId), v1);
  const intent = { studentCaseId: corpus.studentCaseId, applicationId: corpus.applicationId, requestId: "b3e10000-0000-4000-8000-000000000090" };
  assert.deepEqual(parseApplicationRequirementsIntent(intent), intent);
  const receipt = {
    ...intent, revisionId: v1.revisionId, revisionVersion: v1.revisionVersion, origin: v1.origin,
    configurationState: v1.configurationState, initializedAt: v1.initializedAt,
    items: v1.items.map(({ requirementItemId, requirementKey, documentSlotId }) => ({ requirementItemId, requirementKey, documentSlotId })),
  };
  assert.deepEqual(parseApplicationRequirementsReceipt(receipt, intent), receipt);
  assert.equal(parseApplicationRequirementsReceipt({ ...receipt, protocolVersion: 2 }, intent), null);
  assert.equal(parseApplicationRequirementsReceipt({ ...receipt, origin: "staff_confirmed", configurationState: "confirmed" }, intent), null);
  const full = structuredClone(corpus.cases.find(item => item.name === "full_three_items_optional_and_distinct_compatibility").value);
  delete full.protocolVersion;
  for (const item of full.items) {
    delete item.deadline; delete item.reviewScope; delete item.definitionImpact;
  }
  assert.equal(parseApplicationRequirements(full, corpus.studentCaseId, corpus.applicationId), null);
  assert.equal(parse(v1), null, "a v1 response must not be a v2 fallback success");
});
