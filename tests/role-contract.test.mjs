import assert from "node:assert/strict";
import test from "node:test";

import { DICTS, LOCALES } from "../src/lib/i18n-data.ts";
import { ROLES, STAFF_ROLES, isRole } from "../src/lib/roles.ts";

test("release role policy excludes a separate visa role", () => {
  assert.deepEqual(STAFF_ROLES, ["admin", "sales", "curator", "finance"]);
  assert.deepEqual(ROLES, ["admin", "sales", "curator", "finance", "client"]);
  assert.equal(isRole("visa"), false);
  assert.equal(isRole("curator"), true);
  assert.equal(isRole("unknown"), false);

  for (const locale of LOCALES) {
    assert.equal(DICTS[locale]["role.visa"], undefined, locale);
    assert.equal(typeof DICTS[locale]["role.curator"], "string", locale);
  }
});
