import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

test("the superseded Supabase catalog runtime is absent from the V2 application path", () => {
  for (const path of [
    "src/lib/platform-catalog-actions.ts",
    "src/lib/platform-catalog-pagination.ts",
    "src/lib/platform-catalog-provenance.ts",
    "src/lib/platform-catalog.ts",
  ]) {
    assert.equal(existsSync(repoFile(path)), false, path);
  }

  const route = readFileSync(
    repoFile("src/app/(staff)/applications/page.tsx"),
    "utf8",
  );
  assert.match(route, /listCanonicalUniversityApplications/);
  assert.match(route, /data-testid="canonical-application-queue"/);
  assert.doesNotMatch(route, /platform-catalog|CatalogImport|Supabase|SQLite/i);
});
