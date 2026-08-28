import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readDatabaseStatus } from "../src/lib/server/database-status.ts";

test("database status blocks without DATABASE_URL and never opens a legacy fallback", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.EVO_DB_PATH = "/tmp/legacy.sqlite";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";

  try {
    assert.deepEqual(await readDatabaseStatus(), {
      ok: false,
      status: "blocked",
      database: "postgresql",
      code: "database_configuration_missing",
    });
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
    delete process.env.EVO_DB_PATH;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
});

test("the neutral probe is exact and leaves frozen V1 health unchanged", async () => {
  const [route, health, proxy] = await Promise.all([
    readFile(new URL("../src/app/api/database/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /readDatabaseStatus/);
  assert.match(route, /status\.ok \? 200 : 503/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.equal(
    health,
    'import { NextResponse } from "next/server";\n\nexport const dynamic = "force-dynamic";\n\nexport function GET() {\n  return NextResponse.json(\n    { ok: true, status: "live", service: "evo-crm" },\n    { headers: { "Cache-Control": "no-store" } },\n  );\n}\n',
  );
  assert.match(proxy, /path === "\/api\/database\/status"/);
  assert.match(proxy, /path\.startsWith\("\/api\/database\/status"\)/);
  assert.match(proxy, /new NextResponse\(null, \{ status: 404 \}\)/);
});
