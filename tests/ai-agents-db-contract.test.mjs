import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
// Migration 318 (review #1290) replaces three 317 functions and adds two runtime functions (the environment lease).
const SOURCE_318 = readFileSync(new URL("../supabase/migrations/318_platform_ai_agents_followups.sql", import.meta.url), "utf8");
const SUITE_318 = readFileSync(new URL("../supabase/tests/platform_ai_agents_followups.sql", import.meta.url), "utf8");
// Migration 319 (stack audit of 24.10.2026) replaces ten more 317 functions: the repeat key of three writes, the audit of
// six reads and the action log; it adds three closed helpers and no function of schema platform.
const SOURCE_319 = readFileSync(new URL("../supabase/migrations/319_platform_ai_agents_hardening.sql", import.meta.url), "utf8");
const SUITE_319 = readFileSync(new URL("../supabase/tests/platform_ai_agents_hardening.sql", import.meta.url), "utf8");

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
  const created318 = new Set([...SOURCE_318.matchAll(/CREATE FUNCTION platform\.([a-z0-9_]+)\(/gu)].map(([, name]) => name));
  for (const name of created318) assert.ok(!created.has(name), `${name} is new in 318`);
  for (const name of [
    ...Object.values(AI_AGENT_STAFF_RPC),
    ...Object.values(AI_AGENT_RUNTIME_RPC),
    ...Object.values(AI_AGENT_MCP_RPC),
    ...AI_AGENT_TOOLS.map((tool) => tool.rpc),
  ]) {
    assert.ok(created.has(name) || created318.has(name), `platform.${name} is created by 317 or 318`);
  }
  // Nothing extra in the public schema: 9 + 14 + 3 + 24 functions in 317, the two environment-lease functions in 318.
  assert.equal(created.size, 9 + 14 + 3 + 24);
  assert.deepEqual(
    [...created318].sort(),
    [AI_AGENT_RUNTIME_RPC.environmentClaim, AI_AGENT_RUNTIME_RPC.environmentRelease].sort(),
  );
});

test("318 pins the three 317 bodies it replaces by md5, and the md5 is the one of the text in the 317 file", () => {
  const body = (name) => {
    const start = SOURCE.indexOf(`CREATE FUNCTION platform.${name}(`);
    assert.notEqual(start, -1, name);
    const from = SOURCE.indexOf("AS $$", start) + "AS $$".length;
    return SOURCE.slice(from, SOURCE.indexOf("\n$$;", from) + 1);
  };
  const pinned = [...SOURCE_318.matchAll(/\('platform\.([a-z0-9_]+)\(([a-z0-9,]*)\)', '([0-9a-f]{32})'\)/gu)];
  assert.deepEqual(
    pinned.map(([, name]) => name).sort(),
    ["ai_agent_runtime_dispatch_targets_v1", "ai_agent_tool_send_message_v1", "ai_agents_run_authorize_v1"],
  );
  for (const [, name, , md5] of pinned) {
    assert.equal(createHash("md5").update(body(name), "utf8").digest("hex"), md5, `${name}: the anchor is the 317 text`);
    // Each pinned function is replaced in place, not duplicated under another name.
    assert.ok(SOURCE_318.includes(`CREATE OR REPLACE FUNCTION platform.${name}(`), `${name} is replaced`);
  }
  // The re-run refusal comes before the md5 check (a second apply says "already applied", not "drift").
  assert.ok(SOURCE_318.indexOf("a318_already_applied") < SOURCE_318.indexOf("a318_anchor_drift: % is not the 317 definition"));
});

test("318 replaces only the conditions it says: usable agent, derived send key, replay by draft state", () => {
  // (a) one shared rule, read by authorize and by the event targets; the 317 conditions are gone from both.
  assert.equal([...SOURCE_318.matchAll(/platform_private\.ai_agent_claude_usable\(a\)/gu)].length, 2, "exactly two callers: authorize and the event targets");
  const replaced = (name) => {
    const start = SOURCE_318.indexOf(`CREATE OR REPLACE FUNCTION platform.${name}(`);
    assert.notEqual(start, -1, name);
    return SOURCE_318.slice(start, SOURCE_318.indexOf("\n$$;", start));
  };
  for (const name of ["ai_agents_run_authorize_v1", "ai_agent_runtime_dispatch_targets_v1"]) {
    const text = replaced(name);
    assert.doesNotMatch(text, /sync_status <> 'ok'|sync_status = 'ok'/u, `${name}: the status no longer decides alone`);
    assert.match(text, /ai_agent_claude_usable\(a\)/u, name);
  }
  // (b) the derived key: separate namespace, per target and per normalized text, the 10-minute window, one lock, the replay helper.
  assert.match(SOURCE_318, /'send_message_auto:' \|\| platform_private\.ai_agent_sha256\(v_channel/u);
  assert.match(SOURCE_318, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_organization_id::TEXT/u);
  assert.match(SOURCE_318, /ai_agent_dedupe_get\(p_organization_id, p_agent_key, v_key, INTERVAL '10 minutes'\)/u);
  assert.match(SOURCE_318, /RETURN platform_private\.ai_agent_send_replay\(p_organization_id, v_prior\)/u);
  assert.match(SOURCE_318, /ai_agent_dedupe_put\(p_organization_id, p_agent_key, v_key, v_result\)/u);
  assert.equal(AI_AGENT_LIMITS.idempotencyWindowMinutes, 10);
  // (c) the lease is three minutes and lives on the organization settings row.
  assert.match(SOURCE_318, /environment_claim_until = v_now \+ INTERVAL '3 minutes'/u);
  assert.match(SOURCE_318, /SELECT \* INTO s FROM platform_private\.ai_agents_org_settings x WHERE x\.organization_id = p_organization_id FOR UPDATE/u);
  // The migration and its suite carry no secret, address or person.
  assert.doesNotMatch(SOURCE_318, /sk-ant-|Bearer [A-Za-z0-9]|\+996\d{6,}|@gmail\.|@mail\./u);
  assert.doesNotMatch(SUITE_318, /sk-ant-|Bearer [A-Za-z0-9]|@gmail\.|@mail\./u);
  for (const address of SUITE_318.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu)) {
    assert.ok(/\.invalid$/u.test(address[0]), `unexpected address ${address[0]}`);
  }
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

test("event runs: a stale open run does not block the next event; the Director is the system Admin's only", () => {
  // Reserve: an open website_lead / whatsapp_inbound run blocks the next only while it is younger than 15 minutes.
  assert.match(
    SOURCE,
    /r\.status IN \('starting', 'running'\) AND r\.started_at > clock_timestamp\(\) - INTERVAL '15 minutes'\s+ORDER BY r\.started_at DESC LIMIT 1/u,
  );
  // Authorize, runs list and run get (so also follow-up, interrupt, poll and transcript): the Director needs the system Admin.
  for (const guard of [
    /IF p_key = 'director' AND NOT v_actor\.is_admin THEN\s+RAISE EXCEPTION 'ai_agent_forbidden' USING ERRCODE = '42501';/gu,
    /IF r\.agent_key = 'director' AND NOT v_actor\.is_admin THEN\s+RAISE EXCEPTION 'ai_agent_forbidden' USING ERRCODE = '42501';/gu,
  ]) {
    assert.ok(guard.test(SOURCE), String(guard));
  }
  assert.equal([...SOURCE.matchAll(/IF p_key = 'director' AND NOT v_actor\.is_admin THEN/gu)].length, 2);
});

const REPLACED_319 = [
  "ai_agent_mcp_log_v1",
  "ai_agent_tool_add_note_v1",
  "ai_agent_tool_create_task_v1",
  "ai_agent_tool_get_case_chat_v1",
  "ai_agent_tool_get_case_v1",
  "ai_agent_tool_get_client_card_v1",
  "ai_agent_tool_get_conversation_v1",
  "ai_agent_tool_get_document_file_v1",
  "ai_agent_tool_get_lead_v1",
  "ai_agent_tool_post_digest_v1",
];

test("319 pins the ten 317 bodies it replaces by md5, and the md5 is the one of the text in the 317 file", () => {
  const body = (name) => {
    const start = SOURCE.indexOf(`CREATE FUNCTION platform.${name}(`);
    assert.notEqual(start, -1, name);
    const from = SOURCE.indexOf("AS $$", start) + "AS $$".length;
    return SOURCE.slice(from, SOURCE.indexOf("\n$$;", from) + 1);
  };
  const pinned = [...SOURCE_319.matchAll(/\('platform\.([a-z0-9_]+)\(([a-z0-9,]*)\)', '([0-9a-f]{32})'\)/gu)];
  assert.deepEqual(pinned.map(([, name]) => name).sort(), REPLACED_319);
  for (const [, name, , md5] of pinned) {
    assert.equal(createHash("md5").update(body(name), "utf8").digest("hex"), md5, `${name}: the anchor is the 317 text`);
    // Each pinned function is replaced in place (same signature, same grants), not duplicated under another name.
    assert.ok(SOURCE_319.includes(`CREATE OR REPLACE FUNCTION platform.${name}(`), `${name} is replaced`);
    assert.ok(!SOURCE_318.includes(`FUNCTION platform.${name}(`), `${name} was not touched by 318, so the 317 text is its last text`);
  }
  // 319 adds no function to schema platform: the RPC lists above stay exact.
  assert.doesNotMatch(SOURCE_319, /CREATE FUNCTION platform\./u);
  assert.deepEqual(
    [...SOURCE_319.matchAll(/CREATE FUNCTION platform_private\.([a-z0-9_]+)\(/gu)].map(([, name]) => name).sort(),
    ["ai_agent_audit_read", "ai_agent_auto_key", "ai_agent_dedupe_once"],
  );
  // The re-run refusal comes before the md5 check (a second apply says "already applied", not "drift").
  assert.ok(SOURCE_319.indexOf("a319_already_applied") < SOURCE_319.indexOf("a319_anchor_drift: % is not the 317 definition"));
});

test("319 gives the three writes a derived repeat key under one lock, in the contract's window", () => {
  const replaced = (name) => {
    const start = SOURCE_319.indexOf(`CREATE OR REPLACE FUNCTION platform.${name}(`);
    assert.notEqual(start, -1, name);
    return SOURCE_319.slice(start, SOURCE_319.indexOf("\n$$;", start));
  };
  for (const [tool, namespace] of [
    ["create_task", "create_task"],
    ["add_note", "add_note"],
    ["post_digest", "post_digest"],
  ]) {
    const text = replaced(`ai_agent_tool_${tool}_v1`);
    assert.match(text, new RegExp(`platform_private\\.ai_agent_auto_key\\('${namespace}', jsonb_build_array\\(`, "u"), `${tool}: the derived key`);
    assert.match(text, /v_prior := platform_private\.ai_agent_dedupe_once\(p_organization_id, p_agent_key, v_key\)/u, `${tool}: lock + lookup`);
    assert.match(text, /ai_agent_dedupe_put\(p_organization_id, p_agent_key, v_key, v_result\)/u, `${tool}: the first answer is stored under the same key`);
    // Normalized text as in 318: whitespace and case do not make a new call.
    assert.match(text, /ai_agent_send_text_norm\(p_args ->> '(title|body|body_md)'\)/u, `${tool}: normalized text`);
  }
  // The model's own keys keep their old names, so entries written by 317 stay valid.
  assert.match(replaced("ai_agent_tool_create_task_v1"), /'create_task:' \|\| v_idem/u);
  assert.match(replaced("ai_agent_tool_add_note_v1"), /'add_note:' \|\| v_idem/u);
  // Every part of a create_task call is in its key (the key expression itself, not the rest of the body).
  const createTask = replaced("ai_agent_tool_create_task_v1");
  const createTaskKey = createTask.slice(createTask.indexOf("ai_agent_auto_key('create_task'"), createTask.indexOf(")) END;"));
  for (const part of ["'title'", "'description'", "'assignee_id'", "'due_on'", "v_priority", "'case_id'", "'lead_id'"]) {
    assert.ok(createTaskKey.includes(part), `create_task key: ${part}`);
  }
  // add_note: the target (lead or case) and the text; post_digest: kind, title, text, charts, period.
  const addNoteText = replaced("ai_agent_tool_add_note_v1");
  const addNoteKey = addNoteText.slice(addNoteText.indexOf("ai_agent_auto_key('add_note'"), addNoteText.indexOf(")) END;"));
  for (const part of ["'lead_id'", "'case_id'", "'body'"]) assert.ok(addNoteKey.includes(part), `add_note key: ${part}`);
  const digestText = replaced("ai_agent_tool_post_digest_v1");
  const digestKey = digestText.slice(digestText.indexOf("ai_agent_auto_key('post_digest'"), digestText.indexOf("ai_agent_dedupe_once("));
  for (const part of ["'kind'", "'title'", "'body_md'", "'metrics'", "'period_from'", "'period_to'"]) {
    assert.ok(digestKey.includes(part), `post_digest key: ${part}`);
  }
  // The lock is the one of 318 (organization, agent, key) and lives until the end of the transaction; the window is the contract's.
  const once = SOURCE_319.slice(SOURCE_319.indexOf("CREATE FUNCTION platform_private.ai_agent_dedupe_once("));
  assert.match(once, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(\s*p_organization_id::TEXT \|\| ':' \|\| p_agent_key \|\| ':' \|\| p_dedupe_key, 0\)\)/u);
  assert.match(once, /ai_agent_dedupe_get\(p_organization_id, p_agent_key, p_dedupe_key, INTERVAL '10 minutes'\)/u);
  assert.equal(AI_AGENT_LIMITS.idempotencyWindowMinutes, 10);
  // Derived keys fit the table's 200-character limit (longest namespace + 64 hex).
  assert.ok("post_digest_auto:".length + 64 <= 200 && "create_task_auto:".length + 64 <= 200);
  assert.match(SOURCE, /char_length\(dedupe_key\) BETWEEN 1 AND 200/u);
});

test("319 writes the audit of the six sensitive reads inside the read, and the action log no longer audits", () => {
  const replaced = (name) => {
    const start = SOURCE_319.indexOf(`CREATE OR REPLACE FUNCTION platform.${name}(`);
    assert.notEqual(start, -1, name);
    return SOURCE_319.slice(start, SOURCE_319.indexOf("\n$$;", start));
  };
  // The six are exactly the contract's audited reads.
  const audited = AI_AGENT_TOOLS.filter((tool) => tool.audit === "read").map((tool) => tool.name).sort();
  assert.equal(audited.length, 6);
  for (const name of audited) {
    const text = replaced(`ai_agent_tool_${name}_v1`);
    assert.equal([...text.matchAll(/ai_agent_audit_read\(/gu)].length, 1, `${name}: one audit call`);
    assert.match(text, new RegExp(`ai_agent_audit_read\\(p_organization_id, p_agent_key, '${name}',`, "u"), name);
    // Audit comes after the target is found (a refused read audits nothing) and before the data is built.
    assert.ok(text.indexOf("ai_agent_audit_read(") > text.indexOf("P0002"), `${name}: after the not-found check`);
  }
  assert.deepEqual(REPLACED_319.filter((name) => name.startsWith("ai_agent_tool_get_")).map((name) => name.slice(14, -3)).sort(), audited);
  // The audit helper: one journal row, service principal of the agent, only agent and tool in after_state; the file has its own action.
  const helper = SOURCE_319.slice(SOURCE_319.indexOf("CREATE FUNCTION platform_private.ai_agent_audit_read("));
  assert.match(helper, /jsonb_build_object\('agentKey', p_agent_key, 'tool', p_tool\)/u);
  assert.match(helper, /WHEN 'get_document_file' THEN 'ai\.agent\.document\.read' ELSE 'ai\.agent\.tool\.read'/u);
  // The action log keeps its row and loses the audit.
  const log = replaced("ai_agent_mcp_log_v1");
  assert.doesNotMatch(log, /ai_agent_audit\(|audit_event_id\s*=|v_audit/u);
  assert.match(log, /INSERT INTO platform_private\.ai_agent_actions/u);
  assert.match(log, /RETURN jsonb_build_object\('actionId', v_action\)/u);
  // No parameter was added to any tool or to the log: the app calls them as before (migration and app can ship in either order).
  for (const name of REPLACED_319) {
    const signature = SOURCE_319.match(new RegExp(`CREATE OR REPLACE FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u"))[1];
    const before = SOURCE.match(new RegExp(`CREATE FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u"))[1];
    assert.equal(signature.replace(/\s+/gu, " "), before.replace(/\s+/gu, " "), `${name}: same parameters`);
  }
  // The migration and its suite carry no secret, address or person.
  assert.doesNotMatch(SOURCE_319, /sk-ant-|Bearer [A-Za-z0-9]|\+996\d{6,}|@gmail\.|@mail\./u);
  assert.doesNotMatch(SUITE_319, /sk-ant-|Bearer [A-Za-z0-9]|@gmail\.|@mail\./u);
  for (const address of SUITE_319.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu)) {
    assert.ok(/\.invalid$|^(true_|false_)?\d+@c\.us$/u.test(address[0]), `unexpected address ${address[0]}`);
  }
  assert.match(SUITE_319, /A319_AI_AGENTS_HARDENING_SUITE_PASSED/u);
});
