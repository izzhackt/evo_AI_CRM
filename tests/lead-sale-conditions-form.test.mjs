import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Compile the real server-only decoder and its dependencies; no RPC/Auth mocks.
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/server/lead-sale-conditions-form.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", conditions: ["react-server"],
});
const { decodeLeadSaleConditionsGroupForm: decode } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const groups = {
  sale: ["service_label", "signing_date", "service_cost_raw", "service_cost_minor", "service_cost_currency", "paid_raw", "paid_minor", "paid_currency", "payment_note"],
  wishes: ["wishes_countries", "wishes_study_fields", "wishes_education_level", "wishes_intake_year", "wishes_intake_season", "wishes_universities"],
  education: ["education_current", "education_grade", "education_marks", "education_english", "education_certificates"],
  conditions: ["conditions_budget_raw", "conditions_budget_minor", "conditions_budget_currency", "conditions_budget_period", "conditions_scholarship", "conditions_note"],
};
function direct(group) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ lead_id: "lead", request_id: "unchanged-request", expected_revision: "3", field_group: group })) {
    form.append(key, value);
  }
  for (const key of groups[group]) form.append(key, "");
  return form;
}
function envelope(form) {
  const wrapped = new FormData();
  wrapped.append("0", "previous-state");
  wrapped.append("_1_$ACTION_REF_12", "");
  wrapped.append("_1_$ACTION_12:0", "{}");
  wrapped.append("_1_$ACTION_KEY", "state-key");
  for (const [key, value] of form) wrapped.append(`_1_${key}`, value);
  return wrapped;
}

test("all four direct card forms decode only their own exact keys", () => {
  for (const group of Object.keys(groups)) {
    const form = direct(group);
    const decoded = decode(form);
    assert.equal(decoded.group, group);
    assert.deepEqual([...decoded.fields], [...form]);
    assert.deepEqual([...decoded.commandForm], [...form]);
  }
});
test("React19 envelopes preserve decoded group and IDs for outcome/retry", () => {
  for (const group of Object.keys(groups)) {
    const form = direct(group);
    const decoded = decode(envelope(form));
    assert.equal(decoded.group, group);
    assert.deepEqual([...decoded.commandForm], [...form]);
    assert.equal(decoded.commandForm.get("request_id"), "unchanged-request");
    assert.equal(decoded.commandForm.get("lead_id"), "lead");
  }
});
test("duplicate discriminators and duplicate own fields fail closed", () => {
  for (const key of ["field_group", "wishes_countries"]) {
    const form = direct("wishes"); form.append(key, "wishes");
    assert.equal(decode(form), null);
    assert.equal(decode(envelope(form)), null);
  }
});
test("missing own keys and extra sibling keys fail closed", () => {
  const missing = direct("sale"); missing.delete("paid_currency");
  const sibling = direct("wishes"); sibling.append("education_english", "");
  for (const form of [missing, sibling]) {
    assert.equal(decode(form), null);
    assert.equal(decode(envelope(form)), null);
  }
});
test("a discriminator cannot select a different group's fields or an inherited key", () => {
  for (const group of ["education", "unknown", "__proto__"]) {
    const form = direct("wishes"); form.set("field_group", group);
    assert.equal(decode(form), null);
    assert.equal(decode(envelope(form)), null);
  }
});
test("mixed and incomplete React envelopes fail closed", () => {
  const mixed = envelope(direct("wishes")); mixed.append("field_group", "wishes");
  const noState = envelope(direct("sale")); noState.delete("0");
  assert.equal(decode(mixed), null);
  assert.equal(decode(noState), null);
});
