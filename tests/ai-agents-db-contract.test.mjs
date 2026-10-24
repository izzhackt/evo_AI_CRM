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
  AI_AGENT_TOOL_ERROR_CODES,
} from "../src/lib/ai-agents/contract.ts";
import {
  AI_CONSENT_MISSING_CODE,
  AI_CONSENT_POLICY_VERSION,
  AI_CONSENT_SOURCES,
  AI_CONSENT_STATUSES,
} from "../src/lib/ai-agents/consent.ts";

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
// Migration 320 (student consent to AI helpers, 25.10.2026) replaces the account-deletion closure of 280, two functions of 317 and three
// of 319, and adds one table, three RPCs and six closed helpers.
const SOURCE_280 = readFileSync(new URL("../supabase/migrations/280_platform_account_deletion.sql", import.meta.url), "utf8");
const SOURCE_315 = readFileSync(new URL("../supabase/migrations/315_platform_account_deletion_p3.sql", import.meta.url), "utf8");
const SOURCE_320 = readFileSync(new URL("../supabase/migrations/320_platform_student_ai_consent.sql", import.meta.url), "utf8");
const SUITE_320 = readFileSync(new URL("../supabase/tests/platform_student_ai_consent.sql", import.meta.url), "utf8");
const TEST_SCRIPT = readFileSync(new URL("../scripts/test-postgres-authorization.sh", import.meta.url), "utf8");

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

// ---------------------------------------------------------------------------------------------------------------------------------
// Migration 320: the student's consent to AI helpers.
// ---------------------------------------------------------------------------------------------------------------------------------

/** The body text between `AS $$` and the closing `$$;` of one function in a migration, the way Postgres stores it in prosrc. */
function functionBody(source, header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, header);
  const from = source.indexOf("AS $$", start) + "AS $$".length;
  return source.slice(from, source.indexOf("\n$$;", from) + 1);
}
const md5 = (text) => createHash("md5").update(text, "utf8").digest("hex");

test("320 pins the six bodies it replaces by md5, each the text of the migration that last wrote it", () => {
  const pinned = Object.fromEntries(
    [...SOURCE_320.matchAll(/\('((?:platform|platform_private)\.[a-z0-9_]+\([a-z0-9,]*\))', '([0-9a-f]{32})'\)/gu)].map(([, signature, hash]) => [signature, hash]),
  );
  assert.deepEqual(Object.keys(pinned).sort(), [
    "platform.ai_agent_mcp_file_resolve_v1(text)",
    "platform.ai_agent_tool_get_case_chat_v1(uuid,text,jsonb)",
    "platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)",
    "platform.ai_agent_tool_get_document_file_v1(uuid,text,jsonb)",
    "platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)",
    "platform_private.account_deletion_closure(uuid,uuid)",
  ]);
  // Last writer of each: 317 (file resolver and the chat list; neither 318 nor 319 touches them), 319 (the three reads). The closure was
  // written by 280 and extended by 284 and 285 by a fragment edit of the live body (their own-table list), so no file holds its final
  // text: its anchor is proven against a live database by the tamper check of the Postgres script (a pinned md5 of the live body).
  assert.ok(!/FUNCTION platform_private\.account_deletion_closure\(/u.test(SOURCE_315), "315 never rewrote the closure");
  const closureWriters = ["280_platform_account_deletion", "284_platform_student_country_choice", "285_platform_csca_learning_engine"];
  for (const file of closureWriters) {
    assert.ok(readFileSync(new URL(`../supabase/migrations/${file}.sql`, import.meta.url), "utf8").includes("account_deletion_closure"), file);
  }
  assert.ok(!readFileSync(new URL("../supabase/migrations/286_platform_csca_math_part1.sql", import.meta.url), "utf8").includes("account_deletion_closure"));
  for (const name of ["ai_agent_mcp_file_resolve_v1", "ai_agent_tool_list_conversations_v1"]) {
    assert.ok(!SOURCE_318.includes(`FUNCTION platform.${name}(`) && !SOURCE_319.includes(`FUNCTION platform.${name}(`), `${name}: 317 is the last text`);
  }
  assert.match(pinned["platform_private.account_deletion_closure(uuid,uuid)"], /^[0-9a-f]{32}$/u);
  assert.equal(md5(functionBody(SOURCE, "CREATE FUNCTION platform.ai_agent_mcp_file_resolve_v1(")),
    pinned["platform.ai_agent_mcp_file_resolve_v1(text)"], "the file resolver anchor is the 317 text");
  assert.equal(md5(functionBody(SOURCE, "CREATE FUNCTION platform.ai_agent_tool_list_conversations_v1(")),
    pinned["platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)"], "the chat list anchor is the 317 text");
  for (const name of ["ai_agent_tool_get_document_file_v1", "ai_agent_tool_get_conversation_v1", "ai_agent_tool_get_case_chat_v1"]) {
    assert.equal(md5(functionBody(SOURCE_319, `CREATE OR REPLACE FUNCTION platform.${name}(`)), pinned[`platform.${name}(uuid,text,jsonb)`],
      `${name}: the anchor is the 319 text`);
  }
  // The re-run refusal comes before the md5 check (a second apply says "already applied", not "drift").
  assert.ok(SOURCE_320.indexOf("a320_already_applied") < SOURCE_320.indexOf("a320_anchor_drift: % is not the expected definition"));
});

test("320 carries the shared consent contract: version, statuses, sources, the three RPCs and their grants", () => {
  // One policy version in the database and in the code.
  assert.match(SOURCE_320, new RegExp(`SELECT '${AI_CONSENT_POLICY_VERSION}'::TEXT`, "u"));
  assert.equal(AI_CONSENT_POLICY_VERSION, "2026-10-25");
  const table = SOURCE_320.slice(SOURCE_320.indexOf("CREATE TABLE platform_private.student_ai_consents"), SOURCE_320.indexOf("COMMENT ON TABLE"));
  for (const status of AI_CONSENT_STATUSES) assert.match(table, new RegExp(`'${status}'`, "u"), status);
  for (const source of AI_CONSENT_SOURCES) assert.match(table, new RegExp(`'${source}'`, "u"), source);
  assert.match(table, /UNIQUE \(organization_id, auth_user_id\)/u, "one current row per organization and Auth user");
  assert.match(table, /auth_user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/u);
  assert.match(SOURCE_320, /FORCE ROW LEVEL SECURITY/u);
  // The RPC signatures the web and iPhone streams call.
  assert.match(SOURCE_320, /CREATE FUNCTION platform\.portal_ai_consent_get_v1\(\)/u);
  assert.match(SOURCE_320, /CREATE FUNCTION platform\.portal_ai_consent_set_v1\(p_status TEXT, p_policy_version TEXT, p_source TEXT, p_request_id UUID\)/u);
  assert.match(SOURCE_320, /CREATE FUNCTION platform\.staff_student_ai_consent_v1\(p_organization_id UUID, p_student_case_id UUID\)/u);
  assert.match(SOURCE_320, /'status', p_status, 'policyVersion', p_policy_version, 'decidedAt', p_decided_at,\s*'currentPolicyVersion'/u);
  assert.match(SOURCE_320, /GRANT EXECUTE ON FUNCTION\s+platform\.portal_ai_consent_get_v1\(\),\s+platform\.portal_ai_consent_set_v1\(TEXT, TEXT, TEXT, UUID\),\s+platform\.staff_student_ai_consent_v1\(UUID, UUID\)\s+TO authenticated;/u);
  assert.doesNotMatch(SOURCE_320, /GRANT[^;]*(?:service_role|anon|PUBLIC)/u, "nothing is granted to another role");
  // Exactly these functions are created; everything in the tool family is a replacement (grants stay).
  assert.deepEqual([...SOURCE_320.matchAll(/CREATE FUNCTION platform\.([a-z0-9_]+)\(/gu)].map(([, name]) => name).sort(),
    ["portal_ai_consent_get_v1", "portal_ai_consent_set_v1", "staff_student_ai_consent_v1"]);
  assert.deepEqual([...SOURCE_320.matchAll(/CREATE FUNCTION platform_private\.([a-z0-9_]+)\(/gu)].map(([, name]) => name).sort(), [
    "ai_agent_conversation_ai_allowed", "ai_agent_student_ai_allowed", "p7a_safe_audit_actions", "p7a_safe_audit_resource_types",
    "student_ai_consent_org", "student_ai_consent_policy_version", "student_ai_consent_state", "student_case_ai_consent",
  ]);
  assert.deepEqual([...SOURCE_320.matchAll(/CREATE OR REPLACE FUNCTION platform\.([a-z0-9_]+)\(/gu)].map(([, name]) => name).sort(), [
    "ai_agent_mcp_file_resolve_v1", "ai_agent_tool_get_case_chat_v1", "ai_agent_tool_get_conversation_v1",
    "ai_agent_tool_get_document_file_v1", "ai_agent_tool_list_conversations_v1",
  ]);
  // The replaced functions keep their parameters (migration and app can ship in either order).
  for (const name of ["ai_agent_tool_get_case_chat_v1", "ai_agent_tool_get_conversation_v1", "ai_agent_tool_get_document_file_v1", "ai_agent_tool_list_conversations_v1", "ai_agent_mcp_file_resolve_v1"]) {
    const after = SOURCE_320.match(new RegExp(`CREATE OR REPLACE FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u"))[1];
    const before = (SOURCE.match(new RegExp(`CREATE FUNCTION platform\\.${name}\\(([^)]*)\\)`, "u")) ?? [])[1];
    assert.equal(after.replace(/\s+/gu, " "), before.replace(/\s+/gu, " "), `${name}: same parameters`);
  }
});

test("320 asks the question before it serves anything: consent first, then the 319 audit row, then the data", () => {
  const replaced = (name) => functionBody(SOURCE_320, `CREATE OR REPLACE FUNCTION platform.${name}(`);
  // The tools that return a case chat, a file link or a WhatsApp chat refuse with the code and SQLSTATE 42501.
  const guards = {
    ai_agent_tool_get_case_chat_v1: "ai_agent_student_ai_allowed(p_organization_id, s.id)",
    ai_agent_tool_get_document_file_v1: "ai_agent_student_ai_allowed(p_organization_id, v.student_case_id)",
    ai_agent_tool_get_conversation_v1: "ai_agent_conversation_ai_allowed(p_organization_id, cv.id)",
  };
  for (const [name, guard] of Object.entries(guards)) {
    const text = replaced(name);
    assert.equal([...text.matchAll(/RAISE EXCEPTION 'ai_consent_missing' USING ERRCODE = '42501'/gu)].length, 1, `${name}: one refusal`);
    assert.ok(text.includes(`IF NOT platform_private.${guard} THEN`), `${name}: the check is ${guard}`);
    const refusal = text.indexOf("'ai_consent_missing'");
    // After the target is found (an unknown id stays not_found: the consent state of nothing is not disclosed) ...
    assert.ok(refusal > text.indexOf("'not_found'"), `${name}: after the not-found check`);
    // ... and before the audit row, the file grant and every data read.
    assert.ok(refusal < text.indexOf("ai_agent_audit_read("), `${name}: before the read audit`);
    assert.ok(refusal < text.indexOf("jsonb_build_object("), `${name}: before any data is built`);
    assert.equal([...text.matchAll(/ai_agent_audit_read\(/gu)].length, 1, `${name}: the 319 audit stays`);
  }
  const file = replaced("ai_agent_tool_get_document_file_v1");
  assert.ok(file.indexOf("'ai_consent_missing'") < file.indexOf("INSERT INTO platform_private.ai_agent_file_grants"));
  // The list keeps every row and withholds only the text.
  const list = replaced("ai_agent_tool_list_conversations_v1");
  assert.doesNotMatch(list, /'ai_consent_missing'\s+USING/u);
  assert.match(list, /'last_text_preview', CASE WHEN platform_private\.ai_agent_conversation_ai_allowed\(q\.organization_id, q\.id\)\s+THEN left\(q\.last_body, 200\) END/u);
  assert.match(list, /jsonb_build_object\('ai_consent_missing', TRUE\)/u);
  // An issued file link dies with the consent; the refusal rolls back the use count.
  const resolve = replaced("ai_agent_mcp_file_resolve_v1");
  assert.ok(resolve.indexOf("UPDATE platform_private.ai_agent_file_grants") < resolve.indexOf("ai_agent_student_ai_allowed("));
  assert.match(resolve, /ai_agent_student_ai_allowed\(g\.organization_id, \(SELECT v\.student_case_id/u);
  // The code the tools answer with is the contract's, and the same words as the code constant.
  assert.ok(AI_AGENT_TOOL_ERROR_CODES.includes(AI_CONSENT_MISSING_CODE));
  assert.equal(AI_CONSENT_MISSING_CODE, "ai_consent_missing");
});

test("320 decides by the rules of the owner: declined closes, undecided closes only a portal account, a stale version is undecided", () => {
  const helper = functionBody(SOURCE_320, "CREATE FUNCTION platform_private.ai_agent_student_ai_allowed(");
  const order = ["c.status = 'declined' THEN FALSE", "c.status = 'granted' AND c.policy_version = platform_private.student_ai_consent_policy_version() THEN TRUE", "WHEN c.has_portal THEN FALSE", "ELSE TRUE"];
  let at = -1;
  for (const fragment of order) {
    const next = helper.indexOf(fragment);
    assert.ok(next > at, `${fragment} comes in this order`);
    at = next;
  }
  assert.match(helper, /COALESCE\(\(/u, "an unknown case falls to FALSE (fail closed)");
  assert.match(helper, /\), FALSE\)/u);
  // A portal account is an ACTIVE membership with the student role on the case.
  const state = functionBody(SOURCE_320, "CREATE FUNCTION platform_private.student_case_ai_consent(");
  assert.match(state, /m\.id IS NOT NULL AND m\.status = 'active' AND m\."current_role" = 'student'/u);
  // The identity is the one the account deletion resolves (not a copy of its rules).
  assert.match(functionBody(SOURCE_320, "CREATE FUNCTION platform_private.student_ai_consent_org("), /account_deletion_is_staff\(p_auth_user_id\)[\s\S]*account_deletion_subject\(p_auth_user_id\)/u);
  // The decision is idempotent by request id, conflicts on a changed reuse, and writes one journal row per change.
  const set = functionBody(SOURCE_320, "CREATE FUNCTION platform.portal_ai_consent_set_v1(");
  assert.equal([...set.matchAll(/INSERT INTO platform\.audit_events/gu)].length, 1);
  assert.match(set, /'ai_consent_request_conflict' USING ERRCODE = '55000'/u);
  assert.match(set, /pg_advisory_xact_lock\(hashtextextended\('evo:ai-consent-subject:'/u);
  assert.match(set, /CASE p_status WHEN 'granted' THEN 'ai\.consent\.grant' ELSE 'ai\.consent\.decline' END/u);
  assert.match(set, /'system', 'auth:' \|\| uid::TEXT/u);
});

test("320 keeps account deletion automatic for a student with a consent row: the table joins the closure's own list, in one place", () => {
  assert.equal([...SOURCE_280.matchAll(/'platform\.audit_events'\];/gu)].length, 1, "one place in the 280 text");
  assert.ok(SOURCE_320.includes("v_from CONSTANT TEXT := E'''platform.audit_events''];';"));
  assert.ok(SOURCE_320.includes("''platform_private.student_ai_consents''];"));
  assert.match(SOURCE_320, /\) \/ length\(v_from\) <> 1/u, "the fragment must occur exactly once or the migration stops");
  // No guard trigger on the table: the foreign key from auth.users cascades, the erasure deletes the row itself.
  assert.doesNotMatch(SOURCE_320, /CREATE TRIGGER/u);
});

test("320 adds two journal actions and one object type by the rename-and-union wrapper", () => {
  assert.match(SOURCE_320, /RENAME TO p7a_safe_audit_actions_pre_student_ai_consent/u);
  assert.match(SOURCE_320, /RENAME TO p7a_safe_audit_resource_types_pre_student_ai_consent/u);
  assert.match(SOURCE_320, /'ai\.consent\.decline',\s+'ai\.consent\.grant'/u);
  assert.match(SOURCE_320, /'student_ai_consent'\s+\]::TEXT\[\]/u);
});

test("320 and its suite hold no secret, no address and no real person; the suite is hooked into the Postgres script", () => {
  assert.doesNotMatch(SOURCE_320, /sk-ant-|Bearer [A-Za-z0-9]|\+996\d{6,}|@gmail\.|@mail\./u);
  assert.doesNotMatch(SUITE_320, /sk-ant-|Bearer [A-Za-z0-9]|@gmail\.|@mail\./u);
  for (const address of SUITE_320.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu)) {
    assert.ok(/\.invalid$|^(true_|false_)?\d+@c\.us$/u.test(address[0]), `unexpected address ${address[0]}`);
  }
  assert.match(SUITE_320, /A320_STUDENT_AI_CONSENT_SUITE_PASSED/u);
  // The script applies the pre-image tamper check before 320, refuses a second apply and insists on the suite's marker.
  assert.match(TEST_SCRIPT, /\*_platform_student_ai_consent\.sql/u);
  assert.match(TEST_SCRIPT, /a320_anchor_drift/u);
  assert.match(TEST_SCRIPT, /a320_already_applied/u);
  assert.match(TEST_SCRIPT, /platform_student_ai_consent\.sql[\s\S]*A320_STUDENT_AI_CONSENT_SUITE_PASSED/u);
  // The six pinned functions are the six the script tampers with.
  const tampered = TEST_SCRIPT.slice(TEST_SCRIPT.indexOf("for t320_pinned in"), TEST_SCRIPT.indexOf("t320_tamper_log=")).match(/'[a-z0-9_.]+\([a-z,]*\)'/gu);
  assert.equal(tampered.length, 6);
});
