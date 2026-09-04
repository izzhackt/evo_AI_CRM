import assert from "node:assert/strict";
import test from "node:test";

import { hasMeaningfulAuditError } from "../scripts/check-npm-audit-allowlist.mjs";

test("empty npm audit placeholder errors are ignored", () => {
  assert.equal(
    hasMeaningfulAuditError({ summary: "", detail: "" }),
    false,
  );
  assert.equal(
    hasMeaningfulAuditError({ summary: "   ", detail: "" }),
    false,
  );
});

test("non-empty npm audit errors remain fatal inputs", () => {
  assert.equal(
    hasMeaningfulAuditError({ summary: "registry unavailable", detail: "" }),
    true,
  );
  assert.equal(
    hasMeaningfulAuditError({ code: "EAUDITNOLOCK" }),
    true,
  );
  assert.equal(
    hasMeaningfulAuditError(null),
    false,
  );
});
