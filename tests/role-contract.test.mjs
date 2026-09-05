import assert from "node:assert/strict";
import test from "node:test";

import { DICTS, LOCALES } from "../src/lib/i18n-data.ts";
import { ROLES, STAFF_ROLES, isRole } from "../src/lib/roles.ts";

test("the product role policy exposes only the three fixed staff roles", () => {
  assert.deepEqual(STAFF_ROLES, ["admin", "sales", "admissions"]);
  assert.deepEqual(ROLES, ["admin", "sales", "admissions"]);
  assert.equal(isRole("client"), false);
  assert.equal(isRole("visa"), false);
  assert.equal(isRole("admissions"), true);
  assert.equal(isRole("curator"), false);
  assert.equal(isRole("finance"), false);
  assert.equal(isRole("unknown"), false);

  for (const locale of LOCALES) {
    assert.equal(DICTS[locale]["role.visa"], undefined, locale);
    assert.equal(typeof DICTS[locale]["role.admissions"], "string", locale);
  }
});
