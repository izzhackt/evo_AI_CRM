import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROFILE_CANONICAL_FIELDS,
  PROFILE_FIELDS,
} from "../src/lib/student-profile-fields.ts";

// This is a cross-layer registry check, not a claim that PostgreSQL executed the
// migration. Root's real database/application workflow validates the commands.
test("database field keys, order, limits and canonical mappings match the UI registry", () => {
  const sql = readFileSync(new URL(
    "../supabase/migrations/159_platform_student_profile_field_reviews.sql",
    import.meta.url,
  ), "utf8");
  const registry = sql.slice(
    sql.indexOf("SELECT * FROM (VALUES"),
    sql.indexOf(") AS fields(field_key"),
  );
  const fields = [...registry.matchAll(
    /\('([^']+)', (\d+), (\d+), (?:'([^']+)'|NULL::TEXT)\)/g,
  )].map((match) => ({
    key: match[1],
    ordinal: Number(match[2]),
    maxLength: Number(match[3]),
    canonicalColumn: match[4] ?? null,
  }));
  assert.equal(fields.length, 61);
  assert.deepEqual(fields, PROFILE_FIELDS.map((field, index) => ({
    key: field.key,
    ordinal: index + 1,
    maxLength: field.maxLength,
    canonicalColumn: PROFILE_CANONICAL_FIELDS[field.key] ?? null,
  })));
  assert.equal(fields.filter((field) => field.canonicalColumn !== null).length, 3);
  assert.equal(fields.filter((field) => field.canonicalColumn === null).length, 58);
});
