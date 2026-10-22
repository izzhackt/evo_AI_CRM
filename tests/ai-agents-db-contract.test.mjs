import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_AGENT_CATALOG,
  AI_AGENT_DRAFT_STATUSES,
  AI_AGENT_LIMITS,
  AI_AGENT_MCP_RPC,
  AI_AGENT_MODELS,
  AI_AGENT_RUNTIME_RPC,
  AI_AGENT_RUN_STATUSES,
  AI_AGENT_STAFF_RPC,
  AI_AGENT_TOOLS,
  AI_AGENT_TRIGGER_KINDS,
  AI_AGENT_DIGEST_KINDS,
} from "../src/lib/ai-agents/contract.ts";

// Migration 317 mirrors the frozen contract (src/lib/ai-agents/contract.ts): the tool schemas the database enforces,
// the seeded catalog, the RPC names, the status lists and the numeric limits. The database is the last line of
// defence, so a contract edit that is not carried into the migration must fail here, not in production.
const SOURCE = readFileSync(new URL("../supabase/migrations/317_platform_ai_agents_managed.sql", import.meta.url), "utf8");
const SUITE = readFileSync(new URL("../supabase/tests/platform_ai_agents_managed.sql", import.meta.url), "utf8");

test("the tool schema table is the contract's registry, row for row", () => {
  const rows = [...SOURCE.matchAll(/\('([a-z_]+)', '(read|write)', '(none|read|write)', \$j\$(.*?)\$j\$::jsonb\)/gsu)].map(
    ([, name, kind, audit, schema]) => ({ name, kind, audit, schema: JSON.parse(schema) }),
  );
  assert.equal(rows.length, AI_AGENT_TOOLS.length);
  assert.equal(rows.length, 24);
  for (const tool of AI_AGENT_TOOLS) {
    const row = rows.find((candidate) => candidate.name === tool.name);
    assert.ok(row, `${tool.name} is seeded`);
    assert.equal(row.kind, tool.kind, `${tool.name} kind`);
    assert.equal(row.audit, tool.audit, `${tool.name} audit`);
    assert.deepEqual(row.schema, JSON.parse(JSON.stringify(tool.inputSchema)), `${tool.name} schema`);
  }
});

test("every RPC the contract names exists in the migration, in the right schema", () => {
  const created = new Set([...SOURCE.matchAll(/CREATE FUNCTION platform\.([a-z0-9_]+)\(/gu)].map(([, name]) => name));
  for (const name of [
    ...Object.values(AI_AGENT_STAFF_RPC),
    ...Object.values(AI_AGENT_RUNTIME_RPC),
    ...Object.values(AI_AGENT_MCP_RPC),
    ...AI_AGENT_TOOLS.map((tool) => tool.rpc),
  ]) {
    assert.ok(created.has(name), `platform.${name} is created by 317`);
  }
  // Nothing extra in the public schema: 9 + 14 + 3 + 24 functions.
  assert.equal(created.size, 9 + 14 + 3 + 24);
});

test("the seeded catalog repeats AI_AGENT_CATALOG verbatim", () => {
  const start = SOURCE.indexOf("FROM (VALUES\n      ('director'");
  assert.notEqual(start, -1, "the catalog VALUES list is found");
  const block = SOURCE.slice(start, SOURCE.indexOf(") AS c(key, group_key", start));
  const rows = [
    ...block.matchAll(
      /\('([a-z-]+)', '([a-z]+)', (\d+)::SMALLINT, '([^']+)',\s*'([^']+)',\s*(NULL(?:::TEXT)?|'[A-Z]+'),\s*(NULL(?:::TEXT)?|'[^']+'(?:::TEXT)?),\s*'([^']+)', (TRUE|FALSE), (TRUE|FALSE)\)/gu,
    ),
  ].map(([, key, group, sort, title, roleLine, direction, cron, tz, site, whatsapp]) => ({
    key,
    groupKey: group,
    sortOrder: Number(sort),
    title,
    roleLine,
    direction: direction.startsWith("NULL") ? null : direction.slice(1, -1),
    scheduleCron: cron.startsWith("NULL") ? null : cron.replace(/'/gu, "").replace("::TEXT", ""),
    scheduleTz: tz,
    triggerWebsiteLead: site === "TRUE",
    triggerWhatsappInbound: whatsapp === "TRUE",
  }));
  assert.equal(rows.length, AI_AGENT_CATALOG.length);
  for (const entry of AI_AGENT_CATALOG) {
    const row = rows.find((candidate) => candidate.key === entry.key);
    assert.ok(row, `${entry.key} is seeded`);
    assert.deepEqual(row, {
      key: entry.key,
      groupKey: entry.groupKey,
      sortOrder: entry.sortOrder,
      title: entry.title,
      roleLine: entry.roleLine,
      direction: entry.direction,
      scheduleCron: entry.scheduleCron,
      scheduleTz: entry.scheduleTz,
      triggerWebsiteLead: entry.triggerWebsiteLead,
      triggerWhatsappInbound: entry.triggerWhatsappInbound,
    });
  }
  // The test suite repeats the catalog as its own literal; the two must not drift apart either.
  for (const entry of AI_AGENT_CATALOG) {
    assert.ok(SUITE.includes(`'${entry.key}'`) && SUITE.includes(entry.title) && SUITE.includes(entry.roleLine), `${entry.key} is in the SQL suite`);
  }
});

test("the CHECK lists carry the contract's models, run / draft statuses, trigger and digest kinds", () => {
  const constraint = (name) => {
    const at = SOURCE.indexOf(`CONSTRAINT ${name} CHECK`);
    assert.notEqual(at, -1, `${name} exists`);
    return SOURCE.slice(at, SOURCE.indexOf(",\n  CONSTRAINT", at) === -1 ? at + 600 : Math.min(SOURCE.indexOf(",\n  CONSTRAINT", at), at + 800));
  };
  for (const model of AI_AGENT_MODELS) assert.ok(constraint("ai_agents_model_check").includes(`'${model.id}'`), model.id);
  for (const status of AI_AGENT_RUN_STATUSES) assert.ok(constraint("ai_agent_runs_status_check").includes(`'${status}'`), status);
  for (const kind of AI_AGENT_TRIGGER_KINDS) assert.ok(constraint("ai_agent_runs_trigger_check").includes(`'${kind}'`), kind);
  for (const status of AI_AGENT_DRAFT_STATUSES) assert.ok(constraint("ai_agent_drafts_status_check").includes(`'${status}'`), status);
  for (const kind of AI_AGENT_DIGEST_KINDS) assert.ok(constraint("ai_agent_digests_kind_check").includes(`'${kind}'`), kind);
});

test("the numeric limits of the contract are the ones the database applies", () => {
  assert.equal(AI_AGENT_LIMITS.whatsappStaffQuietMinutes, 30);
  assert.match(SOURCE, /ai_agent_staff_active\(p_organization_id, v_conv\.id, 30\)/u);
  assert.equal(AI_AGENT_LIMITS.whatsappPerConversationPerHour, 6);
  assert.equal(AI_AGENT_LIMITS.whatsappPerOrganizationPerHour, 60);
  assert.match(SOURCE, /d\.id IS DISTINCT FROM p_exclude\s+AND d\.created_at > clock_timestamp\(\) - INTERVAL '1 hour'\) >= 6/u);
  assert.match(SOURCE, /\) >= 60\s*\$\$/u);
  assert.equal(AI_AGENT_LIMITS.draftTtlDays, 7);
  assert.match(SOURCE, /expires_at TIMESTAMPTZ NOT NULL DEFAULT now\(\) \+ INTERVAL '7 days'/u);
  assert.equal(AI_AGENT_LIMITS.tokenPreviousGraceMinutes, 10);
  assert.match(SOURCE, /v_now \+ INTERVAL '10 minutes'/u);
  assert.equal(AI_AGENT_LIMITS.fileGrantTtlSeconds, 600);
  assert.match(SOURCE, /v_ttl INTEGER := 600/u);
  assert.equal(AI_AGENT_LIMITS.fileGrantMaxUses, 3);
  assert.match(SOURCE, /max_uses INTEGER NOT NULL DEFAULT 3/u);
  assert.equal(AI_AGENT_LIMITS.fileMaxBytes, 26_214_400);
  assert.match(SOURCE, /v_max_bytes CONSTANT BIGINT := 26214400/u);
  assert.equal(AI_AGENT_LIMITS.instructionsMaxChars, 60_000);
  assert.match(SOURCE, /char_length\(instructions_override\) <= 60000/u);
  assert.equal(AI_AGENT_LIMITS.whatsappTextMaxChars, 4_000);
  assert.equal(AI_AGENT_LIMITS.portalTextMaxChars, 8_000);
  assert.match(SOURCE, /WHEN 'whatsapp' THEN 4000 ELSE 8000/u);
  assert.equal(AI_AGENT_LIMITS.digestBodyMaxChars, 30_000);
  assert.equal(AI_AGENT_LIMITS.digestMetricsMaxBytes, 16_384);
  assert.match(SOURCE, /octet_length\(metrics::TEXT\) <= 16384/u);
});

test("the migration never stores a secret or a person: no key, no token value, no real contact", () => {
  assert.doesNotMatch(SOURCE, /sk-ant-|EVO_ANTHROPIC_API_KEY\s*=|Bearer [A-Za-z0-9]/u);
  assert.doesNotMatch(SOURCE, /\+996\d{6,}|@gmail\.|@mail\.|IBAN|BIC\b/u);
  assert.doesNotMatch(SUITE, /sk-ant-|@gmail\.|@mail\./u);
  // Synthetic e-mail addresses of the suite are on the reserved .invalid domain; WhatsApp chat ids are the harness's
  // synthetic numbers (the same 7996770NNNN family the other WAHA suites use).
  for (const address of SUITE.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu)) {
    assert.ok(/\.invalid$|^a\*\*\*@|^(true_|false_)?\d+@c\.us$/u.test(address[0]), `unexpected address ${address[0]}`);
  }
});
