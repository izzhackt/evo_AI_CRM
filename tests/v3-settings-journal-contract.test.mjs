import assert from "node:assert/strict";
import test from "node:test";

import { normalizeJournalFilters } from "../src/lib/v3/settings-journal-contract.ts";

test("V3 journal keeps only canonical audit query filters", () => {
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case" }),
    { objectType: "visa_case" },
  );
  assert.deepEqual(normalizeJournalFilters({ objectType: "not-a-resource" }), {});
  assert.deepEqual(normalizeJournalFilters({}), {});
});

test("V3 journal filters carry no actor filter", () => {
  // Фильтр по актору сознательно отсутствует: серверная страница аудита не
  // умеет фильтровать по роли, а клиентский отбор поверх пагинации лжёт.
  assert.deepEqual(
    normalizeJournalFilters({ objectType: "visa_case", role: "Staff" }),
    { objectType: "visa_case" },
  );
});
