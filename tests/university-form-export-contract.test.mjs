import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUniversityFormInput } from "../src/lib/university-form-export-contract.ts";
import { formInput } from "./helpers/university-form-input.mjs";


test("closed form input preserves both source formats and a deeply frozen confirmed-only capsule", () => {
  for (const format of ["docx", "pdf"]) {
    const original = formInput(format), parsed = normalizeUniversityFormInput(original);
    assert.deepEqual(parsed, original);
    original.frozen_profile.fields[0].value = "caller mutation";
    assert.equal(parsed.frozen_profile.fields[0].value, "Айлин Synthetic");
    assert.ok(Object.isFrozen(parsed.mapping.mappings[0]));
    assert.ok(Object.isFrozen(parsed.frozen_profile.fields[0].proposals));
  }
});

test("closed capsule rejects type confusion, hidden proposed values, invented DOCX text and mismatched bindings", () => {
  for (const mutate of [
    x => { x.extra = true; }, x => { x.mode = ["final"]; }, x => { x.form.validation_day = "2026-02-30"; },
    x => { x.template.manifest.slots[0].text = "invented"; }, x => { x.template.manifest.slots[0].editable = [true]; },
    x => { x.mapping.mappings[0].manual = [[false]]; }, x => { x.review.state = ["approved"]; },
    x => { x.review.mappingSha256 = "d".repeat(64); }, x => { x.form.template_version_id = x.form.template_id; },
    x => { x.frozen_profile.fields[0].review_state = "extracted"; },
    x => { x.frozen_profile.fields[0].proposals = [{}]; }, x => { x.frozen_profile.can_review = true; },
    x => { x.frozen_profile.fields[1].review_state = "conflict"; x.frozen_profile.fields[1].source_document_version_id = x.form.review_id; },
  ]) {
    const input = formInput(); mutate(input); assert.throws(() => normalizeUniversityFormInput(input));
  }
  for (const field of Object.keys(formInput())) for (const invalid of [[], [[formInput()[field]]], {}, null]) {
    if (field === "font_sha256" && invalid === null) continue;
    assert.throws(() => normalizeUniversityFormInput({ ...formInput(), [field]: invalid }), field);
  }
  const pdf = formInput("pdf"); pdf.template.manifest.slots.push({ id: "pdf-1", editable: true });
  assert.throws(() => normalizeUniversityFormInput(pdf));
});
