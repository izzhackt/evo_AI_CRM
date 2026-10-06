// «WhatsApp: отвечать могут все сотрудники» (решение владельца 06.10.2026,
// «нет, все могут»). Узел-слой: меню и маршрут следуют праву communication.read.full,
// решения страницы WhatsApp, которые зависят только от актёра, и контракт миграции 261
// (самопроверяемая правка оценщика прав, одна добавочная строка контекста, только две
// permission-ключа и только очередь продаж). Что сотрудник видит и в какие диалоги
// отвечает, решает база: это доказывает настоящая цепочка Postgres,
// supabase/tests/platform_whatsapp_team_inbox.sql (scripts/test-postgres-authorization.sh),
// а не этот файл.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { staffCan, staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { inboxPresentationQueue, inboxReadsGeminiDrafts } from "../src/lib/v3/inbox-access.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import { staffRoleKeys } from "./e2e/staff-role-templates.cjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const staff = (keys) => ({
  systemRole: "staff", presentationRole: null, platformAccessVersion: 1, assignments: [], permissionKeys: keys,
});
const preview = (role) => ({
  systemRole: "admin", presentationRole: role, platformAccessVersion: 1, assignments: [], permissionKeys: [],
});
const menu = (actor, href = "/v3/main") => {
  const url = new URL(href, "https://team-inbox.test");
  const model = buildV3Navigation(actor, url.pathname, url.searchParams);
  const every = [...(model.home ? [model.home] : []), ...model.groups.flatMap((group) => group.links), ...model.common];
  return {
    model,
    every,
    place: (id) => model.groups.find((group) => group.links.some((link) => link.id === id))?.id ?? null,
  };
};

// ---------------------------------------------------------------------------
// The menu: «WhatsApp» for every holder of communication.read.full (06.10.2026)
// ---------------------------------------------------------------------------
for (const role of ["admissions", "admissions-manager", "sales", "sales-manager"]) {
  test(`${role} (migration 173 bundle + common role): WhatsApp stands in «Продажи» and its page opens`, () => {
    const keys = staffRoleKeys(role);
    assert.ok(keys.includes("communication.read.full") && keys.includes("communication.manual.send"), "the bundle holds both WhatsApp keys");
    const { every, place } = menu(staff(keys));
    assert.equal(place("inbox"), "sales", role);
    assert.deepEqual(every.find((link) => link.id === "inbox"), {
      id: "inbox", href: "/v3/inbox", route: "/v3/inbox", label: "WhatsApp",
    });
    assert.equal(every.filter((link) => link.id === "inbox").length, 1, "stands once");
    assert.equal(staffCanAccessRoute(staff(keys), "/v3/inbox"), true);
    assert.equal(staffCan(staff(keys), "messaging.send"), true, "the send action's capability hint");
    // The page highlights its own item.
    assert.equal(menu(staff(keys), "/v3/inbox?waiting=1").model.activeId, "inbox");
  });
}

test("rule D still hides the sales board from admissions roles; only WhatsApp joined «Заявки» and «Отчёт продаж»", () => {
  for (const role of ["admissions", "admissions-manager"]) {
    const { model, every } = menu(staff(staffRoleKeys(role)));
    assert.deepEqual(model.groups.find((group) => group.id === "sales")?.links.map((link) => link.id),
      ["requests", "inbox", "sales-report"], role);
    assert.equal(every.some((link) => link.id === "pipeline"), false, `${role}: no sales board`);
  }
  for (const role of ["sales", "sales-manager"]) {
    assert.deepEqual(menu(staff(staffRoleKeys(role))).model.groups[0].links.map((link) => link.id),
      ["requests", "pipeline", "inbox", "sales-report"], role);
  }
});

test("the menu still follows the permission: no communication.read.full, no WhatsApp item and no page", () => {
  const without = [
    ["sales common role alone", staffRoleKeys("sales-common")],
    ["admissions common role alone", staffRoleKeys("admissions-common")],
    ["case reader", ["case.read.full"]],
    ["manual send without read", ["communication.manual.send", "lead.sales.workflow.manage"]],
    ["team only", ["staff.task.read", "team.chat.general"]],
    ["no rights", []],
  ];
  for (const [label, keys] of without) {
    const { every } = menu(staff(keys));
    assert.equal(every.some((link) => link.id === "inbox"), false, label);
    assert.equal(staffCanAccessRoute(staff(keys), "/v3/inbox"), false, `${label}: /v3/inbox`);
  }
});

test("Student-private surfaces are not opened by the WhatsApp rule: «Переписка» and the case chat keep case.read.full", () => {
  const whatsappOnly = staff(["communication.read.full", "communication.manual.send"]);
  const { every } = menu(whatsappOnly);
  assert.equal(every.some((link) => link.id === "inbox"), true);
  assert.equal(every.some((link) => link.id === "messages"), false, "no «Переписка» without case.read.full");
  assert.equal(staffCanAccessRoute(whatsappOnly, "/v3/messages"), false);
  assert.equal(staffCan(whatsappOnly, "admissions.read"), false);
  // The reverse stays too: the student chat reader gets no WhatsApp without the key.
  const caseReader = staff(["case.read.full", "profile.read.full"]);
  assert.equal(menu(caseReader).every.some((link) => link.id === "messages"), true);
  assert.equal(menu(caseReader).every.some((link) => link.id === "inbox"), false);
});

test("the Admin's role preview follows the role: «Приёмная» and «Продажи» both list WhatsApp, the Admin keeps it", () => {
  for (const role of ["admissions", "sales", null]) {
    const { place } = menu(preview(role));
    assert.equal(place("inbox"), "sales", String(role));
  }
});

// ---------------------------------------------------------------------------
// The two page decisions that depend only on the actor
// ---------------------------------------------------------------------------
test("role preview queue: only «Продажи» is filtered; «Приёмная» and the Admin see every queue (06.10.2026)", () => {
  assert.equal(inboxPresentationQueue({ presentationRole: "sales" }), "sales");
  assert.equal(inboxPresentationQueue({ presentationRole: "admissions" }), undefined);
  assert.equal(inboxPresentationQueue({ presentationRole: "admin" }), undefined);
  assert.equal(inboxPresentationQueue({ presentationRole: null }), undefined);
});

test("a role without ai.draft.review opens the transcript without the AI block instead of failing the page", () => {
  assert.equal(inboxReadsGeminiDrafts(staff(["communication.read.full", "communication.manual.send"])), false);
  assert.equal(inboxReadsGeminiDrafts(staff(["communication.read.full", "ai.draft.review"])), true);
  assert.equal(inboxReadsGeminiDrafts({ systemRole: "admin", presentationRole: null, permissionKeys: [] }), true);

  const adapter = source("src/lib/v3/inbox-source.ts");
  // Both Gemini readers sit behind the one decision; the transcript, the command
  // context and the latest send attempt are always read.
  assert.match(adapter, /const readsGeminiDrafts = inboxReadsGeminiDrafts\(actor\);/u);
  assert.match(adapter, /readsGeminiDrafts\s*\?\s*readStaffGeminiProposal\(/u);
  assert.match(adapter, /readsGeminiDrafts\s*\?\s*listStaffGeminiProposalReviews\(/u);
  assert.match(adapter, /: Promise\.resolve\(null\),/u);
  assert.match(adapter, /readLatestManualWhatsAppSendAttempt\(staffClient,/u);
  assert.equal([...adapter.matchAll(/readStaffGeminiProposal\(/gu)].length, 1, "one call site");
  assert.equal([...adapter.matchAll(/listStaffGeminiProposalReviews\(/gu)].length, 1, "one call site");
});

// ---------------------------------------------------------------------------
// Migration 261: a self-verifying, additive patch of the evaluator
// ---------------------------------------------------------------------------
const MIGRATION = "supabase/migrations/261_platform_whatsapp_team_inbox.sql";

/** The body of platform_private.staff_access_evaluate as migration 155 installs it. */
function evaluatorBodyOf155() {
  const sql = source("supabase/migrations/155_platform_scoped_staff_roles.sql");
  const start = sql.indexOf("CREATE FUNCTION platform_private.staff_access_evaluate(");
  assert.ok(start > 0, "155 defines the evaluator");
  const open = sql.indexOf("$$", start) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
}

test("261 asserts the exact 155 source of the evaluator and replaces one fragment of it", () => {
  const sql = source(MIGRATION);
  const body = evaluatorBodyOf155();
  const expectedMd5 = sql.match(/expected_md5 CONSTANT TEXT := '([0-9a-f]{32})'/u)?.[1];
  assert.equal(createHash("md5").update(body).digest("hex"), expectedMd5, "the md5 in 261 is the md5 of 155's body");
  const oldFragment = sql.match(/old_fragment CONSTANT TEXT :=\s*\$old\$([\s\S]*?)\$old\$/u)?.[1];
  assert.equal(oldFragment, "p_resource_kind IN ('lead','staff_task','sales_register')");
  assert.equal(body.split(oldFragment).length - 1, 1, "the replaced fragment occurs exactly once");
  assert.match(sql, /IF pg_catalog\.md5\(installed_source\) IS DISTINCT FROM expected_md5 THEN\s*RAISE EXCEPTION 'whatsapp_team_inbox_source_drift/u);
  assert.match(sql, /IF matches IS DISTINCT FROM 1 THEN\s*RAISE EXCEPTION/u);
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;$/mu);
});

test("261 only ADDS one context row: sales queue, the two WhatsApp keys, never the receiving-assignment path", () => {
  const sql = source(MIGRATION);
  const added = sql.match(/new_fragment CONSTANT TEXT :=\s*\$new\$([\s\S]*?)\$new\$/u)?.[1] ?? "";
  // The old fragment is kept verbatim at the front: nothing the evaluator did before is removed.
  assert.ok(added.startsWith("p_resource_kind IN ('lead','staff_task','sales_register')\n"));
  assert.match(added, /UNION ALL SELECT p_membership_id,NULL::UUID,NULL::TEXT WHERE NOT p_receiving_assignment/u);
  assert.match(added, /AND p_resource_kind='conversation'/u);
  assert.match(added, /AND p_permission_key IN \('communication\.read\.full','communication\.manual\.send'\)/u);
  assert.match(added, /FROM platform\.communication_conversations team_inbox/u);
  assert.match(added, /team_inbox\.organization_id=p_organization_id AND team_inbox\.id=p_resource_id/u);
  assert.match(added, /team_inbox\.queue='sales'/u);
  // Exactly two permission keys and one queue: nothing else is named by the new row.
  assert.deepEqual([...added.matchAll(/'([a-z]+(?:\.[a-z]+)+)'/gu)].map((match) => match[1]).sort(),
    ["communication.manual.send", "communication.read.full"]);
  assert.equal(/curator/iu.test(added), false, "the handed-off (curator) queue stays owner-scoped");
  // No new object, grant or data change: only the evaluator is replaced.
  assert.equal(/\b(CREATE\s+(TABLE|FUNCTION|POLICY|TRIGGER|INDEX)|DROP\s|ALTER\s|GRANT\s|REVOKE\s|INSERT\s|UPDATE\s|DELETE\s)/iu
    .test(sql.replace(/--.*$/gmu, "").replace(/\$(old|new)\$[\s\S]*?\$\1\$/gu, "")), false);
});

test("261 does not touch migrations 259/260 and is independent of 260's needles", () => {
  const sql = source(MIGRATION).replace(/--.*$/gmu, "");
  for (const needle of ["259_", "260_", "waha_history", "history.message", "private_waha_history_binding", "acquire_waha_canonical_identity"]) {
    assert.equal(sql.includes(needle), false, needle);
  }
});

test("the send form's generic failure hint is neutral: a colleague may already have answered (one reply per inbound message) or the service is down", () => {
  const controls = source("src/components/v3/InboxProviderWorkflowControls.tsx");
  assert.match(controls, /unavailable:\s*"Не удалось отправить\. Обновите страницу: возможно, коллега уже ответил на это сообщение, или сервис временно недоступен\."/u);
  // The action keeps one generic failure state: no new state, no new right, no retry.
  const actions = source("src/lib/platform-provider-actions.ts");
  assert.match(actions, /status: "unavailable" \}\);\s*\}\s*\}\s*export async function reconcilePlatformWhatsAppSendAction/u);
});

test("the Postgres harness runs the real-chain suite right after migration 261", () => {
  const harness = source("scripts/test-postgres-authorization.sh");
  assert.match(harness, /if \[\[ "\$\(basename "\$migration"\)" == 261_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_whatsapp_team_inbox\.sql\s+fi/u);
  const suite = source("supabase/tests/platform_whatsapp_team_inbox.sql");
  assert.match(suite, /N261_WHATSAPP_TEAM_INBOX_SUITE_START/u);
  assert.match(suite, /^ROLLBACK;$/mu, "the suite leaves no rows");
  // Two different non-owners answer one conversation (4b), and the identity and
  // assignment filters still bind (4c evaluator, 4d real RPCs with a valid JWT).
  assert.match(suite, /-- 4b\. Two DIFFERENT non-owners reply in the same conversation/u);
  assert.match(suite, /two different non-owners answered in one conversation/u);
  for (const state of ["membership inactive", "membership blocked", "membership invited", "profile blocked", "role archived", "assignment revoked"]) {
    assert.ok(suite.includes(`'${state}'`), state);
  }
  assert.match(suite, /revoked assignment, valid JWT: the send request is refused/u);
});
