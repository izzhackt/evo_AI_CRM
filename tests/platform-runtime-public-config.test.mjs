import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the successor env template exposes only publishable Supabase values to the browser", () => {
  for (const path of ["deploy/env.production.example"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_URL=/mu, path);
    assert.match(source, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_SUPABASE_SECRET_KEY=/mu, path);
    assert.match(source, /^EVO_PLATFORM_ORGANIZATION_ID=/mu, path);
    assert.doesNotMatch(
      source,
      /^NEXT_PUBLIC_.*(?:SECRET|SERVICE_ROLE)/mu,
      `${path} exposes a server-only Supabase credential`,
    );
    assert.doesNotMatch(
      source,
      /AUTH_SECRET|EVO_SECRET_ENCRYPTION_KEY|EVO_DB_PATH|EVO_BACKUP_DIR|EVO_AGENT_WAHA_SESSION|EVO_PLATFORM_(?:MANUAL_SEND|LEAD_AGENT)|EVO_LEAD_AGENT_|crm_primary|evo-inbox/u,
      `${path} retains a superseded authority or static WAHA session selection`,
    );
  }
});
