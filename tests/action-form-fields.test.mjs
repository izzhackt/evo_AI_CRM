import assert from "node:assert/strict";
import test from "node:test";

import { exactActionStringFields } from "../src/lib/server/action-form-fields.ts";

const EXPECTED_KEYS = ["lead_id", "request_id"];

function entries(fields) {
  return Object.fromEntries(fields ?? []);
}

test("direct action fields remain exact while official metadata is ignored", () => {
  const form = new FormData();
  form.append("$ACTION_ID_deadbeef", "");
  form.append("lead_id", "lead");
  form.append("request_id", "request");

  assert.deepEqual(
    entries(exactActionStringFields(form, EXPECTED_KEYS)),
    { lead_id: "lead", request_id: "request" },
  );
});

test("React useActionState envelope exposes only its prefixed user fields", () => {
  const form = new FormData();
  form.append("_1_$ACTION_REF_12", "");
  form.append("_1_$ACTION_12:0", "{}");
  form.append("_1_$ACTION_12:1", "");
  form.append("_1_$ACTION_KEY", "state-key");
  form.append("_1_lead_id", "lead");
  form.append("_1_request_id", "request");
  form.append("0", "previous-state");

  assert.deepEqual(
    entries(exactActionStringFields(form, EXPECTED_KEYS)),
    { lead_id: "lead", request_id: "request" },
  );
});

test("unknown, duplicate, and malformed envelope fields fail closed", () => {
  const unknown = new FormData();
  unknown.append("lead_id", "lead");
  unknown.append("request_id", "request");
  unknown.append("unexpected", "value");
  assert.equal(exactActionStringFields(unknown, EXPECTED_KEYS), null);

  const duplicate = new FormData();
  duplicate.append("lead_id", "lead");
  duplicate.append("lead_id", "second");
  duplicate.append("request_id", "request");
  assert.equal(exactActionStringFields(duplicate, EXPECTED_KEYS), null);

  const missingStateSlot = new FormData();
  missingStateSlot.append("_1_$ACTION_REF_8", "");
  missingStateSlot.append("_1_lead_id", "lead");
  missingStateSlot.append("_1_request_id", "request");
  assert.equal(
    exactActionStringFields(missingStateSlot, EXPECTED_KEYS),
    null,
  );

  const forgedMetadata = new FormData();
  forgedMetadata.append("$ACTION_NOT_FRAMEWORK", "");
  forgedMetadata.append("lead_id", "lead");
  forgedMetadata.append("request_id", "request");
  assert.equal(exactActionStringFields(forgedMetadata, EXPECTED_KEYS), null);
});
