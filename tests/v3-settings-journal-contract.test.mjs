import assert from "node:assert/strict";
import test from "node:test";

import { normalizeJournalFilters } from "../src/lib/v3/settings-journal-contract.ts";

test("V3 journal keeps only canonical audit query filters", () => {
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case", role: "Staff" }),
    { objectType: "visa_case", role: "Staff" },
  );
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "not-a-resource", role: "Director" }),
    {},
  );
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case", role: "Director" }),
    { objectType: "visa_case" },
  );
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "not-a-resource", role: "System" }),
    { role: "System" },
  );
});
