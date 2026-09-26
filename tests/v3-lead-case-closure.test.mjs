// «Закрыть лид» и «Завершить дело» (миграция 246, решение владельца
// 26.09.2026): статические проверки миграции и её набора на реальном
// Postgres, контракт команд и чтений, слова и разметка настоящих экранов
// (статические рендеры tests/e2e/*-static-render.cjs с синтетикой). Права,
// версии и состояния решает SQL — их доказывает набор
// supabase/tests/platform_lead_case_closure.sql (контрольная точка 246 в
// scripts/test-postgres-authorization.sh), а не этот файл.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CASE_CLOSE_OUTCOMES,
  CLOSURE_NOTE_MAX_LENGTH,
  LEAD_CLOSE_REASONS,
  closureNoteInput,
  closureStatusFromRpcError,
  normalizeCaseClosure,
  normalizeCaseClosureReceipt,
  normalizeClosedLeadsPage,
  normalizeLeadClosureReceipt,
  parseClosedLeadsCursor,
} from "../src/lib/platform-closure-contract.ts";
import { isClosedLeadsReturn, parsePipelineReturnTo } from "../src/lib/v3/pipeline-return.ts";
import { caseCloseOpenTasks, caseCloseOutcome, closureOutcome, closureWords, leadCloseReason } from "../src/lib/v3/wording.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/246_platform_lead_case_closure.sql");
const suite = read("supabase/tests/platform_lead_case_closure.sql");
const script = read("scripts/test-postgres-authorization.sh");
const harness = (name) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL(`./e2e/${name}-static-render.cjs`, import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const texts = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
// Строка закрытия: части через «·», разделитель у начала строки срезан (DotRun), а
// «Вернуть в работу» — своей строкой после неё, не внутри <p>.
const RUN_OPEN = '<p class="overflow-hidden t-body-compact text-fg-2"><span class="-ms-5 flex flex-wrap items-baseline">';
const RUN_DOT = '<span aria-hidden="true" class="w-5 shrink-0 text-center text-fg-3">·</span>';
const REOPEN_ROW = /<\/p><button type="button"[^>]*class="mt-1\.5 flex min-h-11 w-fit items-center[^"]*"[^>]*>Вернуть в работу<\/button>/u;

const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const LEAD = "dddddddd-3333-4333-8333-000000000001";
const CASE = "cccccccc-2222-4222-8222-000000000001";
const REQUEST = "99999999-0000-4000-8000-000000000001";
const AT = "2026-09-26T09:30:00.123456+00:00";

/** Тело одной функции 246 до закрывающего $$. */
function functionBody(name) {
  const start = migration.indexOf(`CREATE FUNCTION ${name}(`);
  assert.notEqual(start, -1, name);
  return migration.slice(migration.indexOf("AS $$", start), migration.indexOf("$$;", migration.indexOf("AS $$", start) + 5));
}

test("246 is one forward-only, additive transaction of four new definer functions", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.doesNotMatch(migration, /\bDROP\s+(FUNCTION|TABLE|POLICY|TRIGGER|TYPE)\b/iu);
  assert.doesNotMatch(migration, /\b(CREATE|ALTER)\s+(TABLE|TYPE)\b/iu);
  assert.doesNotMatch(migration, /ADD VALUE/iu, "no new enum value: the existing 'disqualified' is used");
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION/iu, "nothing existing is replaced");
  const created = [...migration.matchAll(/CREATE FUNCTION ([a-z_]+\.[a-z0-9_]+)\(/gu)].map((match) => match[1]);
  assert.deepEqual(created, [
    "platform.set_lead_closed_v1",
    "platform.staff_closed_leads_v1",
    "platform.set_student_case_closed_v1",
    "platform.staff_student_case_closure_v1",
  ]);
  assert.equal((migration.match(/SECURITY DEFINER SET search_path = ''/gu) ?? []).length, 4);
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;\nGRANT EXECUTE ON FUNCTION/u);
  assert.doesNotMatch(migration, /GRANT [A-Z ,]+ TO (anon|service_role|PUBLIC)/u);
  assert.match(migration, /a246_closure_anchor_drift/u);
  assert.match(migration, /a246_closure_verification_failed/u);
});

test("246 relies on the existing transitions and says so in self-verifying anchors", () => {
  assert.ok(migration.includes(`$q$NEW.lifecycle_state NOT IN ('open', 'disqualified', 'archived')$q$`));
  assert.ok(migration.includes(`$q$OR (OLD.state = 'closed' AND NEW.state = 'active')$q$`));
  assert.ok(migration.includes("to_regprocedure('platform.staff_sales_handoff_facts(uuid,uuid[])')"));
  // «Поступил» до подтверждённого прибытия — у playbook 'cancelled': ни один отчёт не должен его считать.
  const anchors = migration.slice(migration.indexOf("DO $a246_anchors$"), migration.indexOf("$a246_anchors$;"));
  assert.match(anchors, /'platform\.admissions_direction_summary_v1\(text,uuid,date,date\)'::regprocedure\),\s+'admissions_outcome'\) <> 0/u);
});

test("an enrolled playbook case is never reported as cancelled (real-Postgres assertions)", () => {
  assert.match(suite, /set_student_case_closed_v1\(pg_temp\.n246_id\(1\), pg_temp\.n246_id\(506\), 1, TRUE, 'enrolled', NULL,/u);
  assert.match(suite, /staff_student_case_closure_v1\(pg_temp\.n246_id\(1\), pg_temp\.n246_id\(506\)\) ->> 'outcome' = 'enrolled'/u);
  assert.match(suite, /NOT \(s \?\| ARRAY\['cancelled', 'arrived'\]\)/u);
  assert.match(suite, /'admissions_outcome'\) = 0,\n  'the latest admissions summary does not read the playbook outcome'/u);
});

test("lead command: permission on the lead decides, a handoff refuses, the stage stays", () => {
  const body = functionBody("platform.set_lead_closed_v1");
  assert.match(body, /a\.platform_role IS DISTINCT FROM 'student'/u);
  assert.match(body, /staff_can_access\(a\.organization_id, a\.membership_id,\s+'lead\.sales\.workflow\.manage', 'lead', p_lead_id\)/u);
  assert.doesNotMatch(body, /platform_role\s*(NOT\s+)?IN\s*\(|platform_role\s*(<>|=)\s*'/u, "no coarse-role gate");
  assert.match(body, /platform\.staff_sales_handoff_facts\(p_organization_id, ARRAY\[p_lead_id\]\)/u);
  assert.match(body, /RAISE EXCEPTION 'lead_lifecycle_handed_off' USING ERRCODE = '55000'/u);
  assert.match(body, /'disqualified'::platform\.lead_lifecycle_state/u);
  // Only lifecycle_state changes: stage, owner, next step and workflow_version stay.
  const update = body.slice(body.indexOf("UPDATE platform.leads"), body.indexOf("RETURNING * INTO changed"));
  assert.match(update, /SET lifecycle_state = /u);
  assert.doesNotMatch(update, /stage_key|current_owner_membership_id|next_action|workflow_version\s*=/u);
  assert.match(body, /RAISE EXCEPTION 'lead_lifecycle_version_conflict' USING ERRCODE = 'PT409'/u);
  assert.match(body, /RAISE EXCEPTION 'lead_lifecycle_request_conflict' USING ERRCODE = '22023'/u);
  // Replay before the state checks, after the authority check (the 241 shape).
  assert.ok(body.indexOf("lead_lifecycle_forbidden") < body.indexOf("lead_lifecycle_request_conflict"));
  assert.ok(body.indexOf("lead_lifecycle_request_conflict") < body.indexOf("lead_lifecycle_version_conflict"));
  assert.match(body, /'lead\.lifecycle\.change', 'lead'/u);
});

test("case command: the 137/241 operator chain with case.lifecycle.change, version +1, both journals", () => {
  const body = functionBody("platform.set_student_case_closed_v1");
  assert.match(body, /caller\.platform_role IS NOT DISTINCT FROM 'student'/u);
  assert.match(body, /platform_private\.u7_require_case_workspace_actor\(p_student_case_id\)/u);
  assert.match(body, /platform_private\.admissions_lock_case\(p_student_case_id, 'case\.lifecycle\.change'\)/u);
  assert.ok(body.indexOf("u7_require_case_workspace_actor") < body.indexOf("lock_p2d_request")
    && body.indexOf("lock_p2d_request") < body.indexOf("admissions_lock_case"), "preflight, request lock, case lock");
  assert.match(body, /admissions_version = sc\.admissions_version \+ 1/u);
  assert.match(body, /INSERT INTO platform\.student_case_lifecycle_events/u);
  assert.match(body, /'case\.lifecycle\.change', 'student_case'/u);
  assert.match(body, /RAISE EXCEPTION 'case_closure_version_conflict' USING ERRCODE = 'PT409'/u);
  assert.match(body, /RAISE EXCEPTION 'case_closure_state_conflict' USING ERRCODE = 'PT409'/u);
  assert.match(body, /WHEN NOT p_closed THEN 'active'/u, "a playbook case returns to the active playbook outcome");
  assert.doesNotMatch(body, /change_student_case_state/u);
});

test("reads: staff only, lock-free, scoped per row", () => {
  const leads = functionBody("platform.staff_closed_leads_v1");
  assert.match(leads, /a\.platform_role IS NOT DISTINCT FROM 'student'/u);
  assert.match(leads, /l\.lifecycle_state = 'disqualified'/u);
  assert.match(leads, /staff_can_access\(l\.organization_id, a\.membership_id, 'lead\.read', 'lead', l\.id\)/u);
  const closure = functionBody("platform.staff_student_case_closure_v1");
  assert.match(closure, /u7_require_case_workspace_actor\(p_student_case_id\)/u);
  for (const body of [leads, closure]) assert.doesNotMatch(body, /FOR (UPDATE|SHARE|KEY SHARE)|advisory/iu);
  assert.match(migration, /CREATE FUNCTION platform\.staff_closed_leads_v1\([\s\S]*?\) RETURNS JSONB LANGUAGE plpgsql STABLE/u);
  assert.match(migration, /CREATE FUNCTION platform\.staff_student_case_closure_v1\([\s\S]*?\) RETURNS JSONB LANGUAGE plpgsql STABLE/u);
});

test("the real-Postgres suite runs at checkpoint 246 with production-shaped members", () => {
  assert.match(script, /== 246_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_lead_case_closure\.sql/u);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N246_LEAD_CASE_CLOSURE_SUITE_PASS/u);
  assert.match(suite, /= ARRAY\[35, 36, 23, 12, 16\], 'role bundles have the production key counts/u);
  assert.match(suite, /"current_role" IS NULL AND current_bundle_id IS NULL/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
  for (const probe of ["'42501:lead_lifecycle_forbidden'", "'55000:lead_lifecycle_handed_off'", "'PT409:lead_lifecycle_version_conflict'",
    "'22023:lead_lifecycle_request_conflict'", "'42501:Student case is unavailable'", "'PT409:case_closure_version_conflict'",
    "'22023:case_closure_request_conflict'", "'PT409:case_closure_state_conflict'", "LIKE '42501:permission denied for %'"]) {
    assert.ok(suite.includes(probe), probe);
  }
  for (const claim of ["n246_sales_manager_b", "n246_admissions_b", "n246_student", "n246_no_member"]) assert.ok(suite.includes(claim), claim);
});

test("contract: the note is required and allowed only for «Другое», one line up to 500", () => {
  assert.deepEqual(closureNoteInput(null, ""), { ok: false, error: "key" });
  assert.deepEqual(closureNoteInput("budget", "ignored"), { ok: true, note: null });
  assert.deepEqual(closureNoteInput("other", "   "), { ok: false, error: "note_required" });
  assert.deepEqual(closureNoteInput("other", "  Уехал учиться сам  "), { ok: true, note: "Уехал учиться сам" });
  assert.deepEqual(closureNoteInput("other", "две\nстроки"), { ok: false, error: "note_invalid" });
  assert.deepEqual(closureNoteInput("other", "x".repeat(CLOSURE_NOTE_MAX_LENGTH + 1)), { ok: false, error: "note_invalid" });
  assert.deepEqual(closureNoteInput("other", "x".repeat(CLOSURE_NOTE_MAX_LENGTH)), { ok: true, note: "x".repeat(CLOSURE_NOTE_MAX_LENGTH) });
});

test("contract: RPC errors map to honest statuses", () => {
  assert.equal(closureStatusFromRpcError({ code: "42501", message: "lead_lifecycle_forbidden" }), "forbidden");
  assert.equal(closureStatusFromRpcError({ code: "42501", message: "Student case is unavailable" }), "forbidden");
  assert.equal(closureStatusFromRpcError({ code: "PT409", message: "lead_lifecycle_version_conflict" }), "stale");
  assert.equal(closureStatusFromRpcError({ code: "PT409", message: "case_closure_state_conflict" }), "stale");
  assert.equal(closureStatusFromRpcError({ code: "55000", message: "lead_lifecycle_handed_off" }), "handed_off");
  assert.equal(closureStatusFromRpcError({ code: "22023", message: "case_closure_request_conflict" }), "request_conflict");
  assert.equal(closureStatusFromRpcError({ code: "22023", message: "lead_lifecycle_invalid" }), "invalid");
  assert.equal(closureStatusFromRpcError({ code: "08006", message: "connection failure" }), "unavailable");
  assert.equal(closureStatusFromRpcError(null), "unavailable");
});

test("contract: receipts must be the committed row for this request", () => {
  const lead = { organization_id: ORG, lead_id: LEAD, lifecycle: "closed", reason: "other", note: "Уехал", stage_key: "qualified",
    workflow_version: "3", request_id: REQUEST, changed_at: AT };
  const expected = { organizationId: ORG, leadId: LEAD, requestId: REQUEST, closed: true };
  assert.deepEqual(normalizeLeadClosureReceipt(lead, expected),
    { leadId: LEAD, lifecycle: "closed", reason: "other", note: "Уехал", workflowVersion: "3", changedAt: AT });
  for (const broken of [{ ...lead, lead_id: CASE }, { ...lead, request_id: LEAD }, { ...lead, lifecycle: "open" },
    { ...lead, reason: "lost" }, { ...lead, reason: "budget" }, { ...lead, workflow_version: 3 }]) {
    assert.throws(() => normalizeLeadClosureReceipt(broken, expected));
  }
  const reopened = normalizeLeadClosureReceipt({ ...lead, lifecycle: "open", reason: null, note: null }, { ...expected, closed: false });
  assert.equal(reopened.lifecycle, "open");

  const kase = { organization_id: ORG, student_case_id: CASE, state: "closed", outcome: "enrolled", note: null, closed_at: AT,
    admissions_version: "5", request_id: REQUEST, changed_at: AT };
  const caseExpected = { organizationId: ORG, studentCaseId: CASE, requestId: REQUEST, closed: true };
  assert.equal(normalizeCaseClosureReceipt(kase, caseExpected).admissionsVersion, "5");
  for (const broken of [{ ...kase, closed_at: null }, { ...kase, outcome: null }, { ...kase, admissions_version: "0" },
    { ...kase, note: "текст" }, { ...kase, state: "active" }]) {
    assert.throws(() => normalizeCaseClosureReceipt(broken, caseExpected));
  }
});

test("contract: the closed list and the case closure read decode exactly", () => {
  const row = { lead_id: LEAD, client_display_name: "Лид Синтетический", owner_display_name: null, stage_key: "contacting",
    workflow_version: "2", closed_at: AT, reason: "no_response", note: null, closed_by_display_name: "Менеджер", can_manage: true };
  const page = normalizeClosedLeadsPage({ organization_id: ORG, rows: [row], next_cursor: null }, ORG, 50);
  assert.equal(page.rows[0].reason, "no_response");
  assert.equal(page.rows[0].canManage, true);
  assert.throws(() => normalizeClosedLeadsPage({ organization_id: ORG, rows: [row, row], next_cursor: null }, ORG, 50), "duplicate lead");
  assert.throws(() => normalizeClosedLeadsPage({ organization_id: CASE, rows: [], next_cursor: null }, ORG, 50), "other organization");
  assert.throws(() => normalizeClosedLeadsPage({ organization_id: ORG, rows: [{ ...row, closed_at: null }], next_cursor: null }, ORG, 50));
  assert.equal(parseClosedLeadsCursor(`2026-09-26T09:30:00.123456Z|${LEAD}`), `2026-09-26T09:30:00.123456Z|${LEAD}`);
  assert.equal(parseClosedLeadsCursor("bogus"), null);

  const closure = { organization_id: ORG, student_case_id: CASE, state: "closed", admissions_version: "6", closed_at: AT,
    outcome: "other", note: "Переехал", closed_by_display_name: "Куратор", can_change: false };
  assert.equal(normalizeCaseClosure(closure, ORG, CASE).note, "Переехал");
  assert.throws(() => normalizeCaseClosure({ ...closure, state: "active" }, ORG, CASE), "an active case has no closure date");
  assert.throws(() => normalizeCaseClosure({ ...closure, can_change: "yes" }, ORG, CASE));
});

test("wording: every reason, outcome and outcome message has Russian words", () => {
  assert.deepEqual(LEAD_CLOSE_REASONS.map(leadCloseReason),
    ["Не отвечает", "Выбрал другое агентство", "Не подходит по бюджету", "Дубликат", "Другое"]);
  assert.deepEqual(CASE_CLOSE_OUTCOMES.map(caseCloseOutcome), ["Поступил", "Отказался", "Не прошёл", "Другое"]);
  assert.equal(leadCloseReason("lost"), null, "a raw key never reaches the screen");
  for (const kind of ["lead", "case"]) {
    for (const status of ["saved", "invalid", "forbidden", "preview", "stale", "handed_off", "request_conflict", "unavailable"]) {
      assert.ok(closureOutcome(status, kind, true), `${kind}:${status}`);
    }
  }
  assert.equal(closureWords.lead.action, "Закрыть лид");
  assert.equal(closureWords.case.action, "Завершить дело");
  assert.equal(closureWords.reopen, "Вернуть в работу");
  // Окно «Завершить дело»: задачи дела остаются — числом, если оно прочитано.
  assert.equal(caseCloseOpenTasks(3), "Открытые задачи дела (3) останутся в\u00a0«Задачах».");
  assert.equal(caseCloseOpenTasks(null), "Открытые задачи дела останутся в\u00a0«Задачах».", "not read — the rule without a number");
  assert.equal(caseCloseOpenTasks(0), null, "no open tasks — nothing to say");
});

test("board: «⋯» in the lead panel, a handed-off lead says why, «Закрытые» is a quiet link and a list", () => {
  const surfaces = harness("boards");
  const panel = surfaces.get("sales-panel");
  const lead = panel.slice(panel.indexOf('data-testid="v3-pipeline-lead-panel"'));
  assert.match(lead, /aria-label="Ещё действия"/u);
  assert.match(lead, /Закрыть лид…/u);
  assert.doesNotMatch(lead, /Лид передан в поступление/u);
  const handed = surfaces.get("sales-panel-handed");
  const handedPanel = handed.slice(handed.indexOf('data-testid="v3-pipeline-lead-panel"'));
  assert.match(handedPanel, /<button type="button" aria-disabled="true"[^>]*>Закрыть лид<\/button><p [^>]*>Лид передан в поступление — это продажа\. Закрыть его как потерянный нельзя\.<\/p>/u);
  const link = surfaces.get("sales").match(/<a[^>]*data-testid="v3-pipeline-closed-link"[^>]*>Закрытые<\/a>/u)?.[0] ?? "";
  assert.match(link, /href="\/v3\/pipeline\?view=closed"/u);
  assert.doesNotMatch(link, /bg-accent/u, "a quiet link, not a red button");
  const closedHtml = surfaces.get("sales-closed");
  const closed = texts(closedHtml);
  assert.match(closed, /Закрытые лиды 3/u);
  // Имя, сразу причина и дата (заголовок уже говорит «Закрытые» — без «Закрыт» в строке), затем факты и возврат.
  assert.match(closed, /Нурлан Закрытов · Не отвечает · \d{2}\.\d{2}\.\d{4} · Этап: Связались · Ответственный: Менеджер Первый · Закрыл: Менеджер Первый Вернуть в работу/u);
  assert.match(closed, /Асель Отказова · Другое: Решила поступать через родственников в Казани · \d{2}\.\d{2}\.\d{4} · Этап:/u);
  assert.doesNotMatch(closed, /Закрыт ·/u);
  assert.match(closedHtml, /<time dateTime="[^"]+" class="font-mono tabular-nums">\d{2}\.\d{2}\.\d{4}<\/time>/u);
  assert.ok(closedHtml.includes(`${RUN_OPEN}<span class="inline-flex min-w-0 items-baseline">${RUN_DOT}<span class="min-w-0 break-words">Не отвечает</span>`));
  assert.match(closedHtml, /<p class="overflow-hidden t-meta text-fg-2"><span class="-ms-5 flex flex-wrap items-baseline">/u, "facts wrap without a leading «·» too");
  assert.match(closedHtml, REOPEN_ROW);
  // Закрытый список — не доска: без её красной кнопки.
  assert.doesNotMatch(surfaces.get("sales-closed"), /Добавить лида/u);
});

test("«Студенты»: «Завершить дело…» in the quick view of a case in work, the closed line of a closed case", () => {
  const surfaces = harness("students");
  const open = surfaces.get("panel-close");
  const panel = open.slice(open.indexOf("<dialog"));
  assert.match(panel, /<button type="button" class="[^"]*" data-testid="v3-close-case">Завершить дело…<\/button>/u);
  assert.doesNotMatch(surfaces.get("admin-panel").slice(surfaces.get("admin-panel").indexOf("<dialog")), /v3-close-case/u,
    "without a closure read there is no action");
  const closedPanel = surfaces.get("panel-closed").slice(surfaces.get("panel-closed").indexOf("<dialog"));
  const closed = texts(closedPanel);
  assert.match(closed, /Состояние · Закрыто · Не прошёл · 22\.09\.2026 Вернуть в работу/u);
  assert.ok(closedPanel.includes(`${RUN_OPEN}<span class="inline-flex min-w-0 items-baseline">${RUN_DOT}<span class="font-medium text-fg">Закрыто</span>`));
  assert.match(closedPanel, REOPEN_ROW);
  assert.match(closed, /Дело закрыто: шаг не меняется\./u);
  assert.doesNotMatch(closed, /Завершить дело/u);
});

test("Student 360 and Lead 360: the closed line, and the lead view keeps its overview", () => {
  const surfaces = harness("case");
  const closedHtml = surfaces.get("closed-outcome");
  const closed = texts(closedHtml);
  assert.match(closed, /Состояние · Закрыто · Поступил · 22\.09\.2026 Вернуть в работу/u);
  assert.match(closedHtml, REOPEN_ROW);
  // Шапка закрытого дела говорит то же, что «Быстрый просмотр»: шаг — последний, не живой.
  assert.match(closed, /Следующий шаг Собрать апостиль на аттестат 20\.09 Дело закрыто: шаг не меняется\./u);
  assert.match(texts(surfaces.get("closed")), /Состояние Дело закрыто/u, "without the closure read the fact stays as before");
  // Закрытый лид: без красной ссылки и сырого text-sm; почему нет контактов — одной тихой строкой.
  const view = read("src/components/v3/closure/ClosedLeadView.tsx");
  assert.doesNotMatch(view, /text-accent|text-sm\b|<Link/u);
  assert.match(view, /closureWords\.lead\.detailsAfterReopen : closureWords\.lead\.detailsOpenOnly/u);
  assert.equal(closureWords.lead.detailsAfterReopen, "Контакты и история вернутся после «Вернуть в работу».");
});

test("pages wire the reads, the hints and the preview rule", () => {
  const profile = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profile, /readCaseClosure\(actor, caseTarget\.studentCaseId\)\.catch\(\(\) => null\)/u);
  assert.match(profile, /params\.open \? readCaseClosure\(actor, params\.open\)\.catch\(\(\) => null\)/u);
  assert.match(profile, /closure && isStaffPreview\(actor\) \? \{ \.\.\.closure, canChange: false \} : closure/u);
  assert.match(profile, /staffHasPermission\(actor, "lead\.sales\.workflow\.manage"\)/u);
  assert.match(profile, /blockedReason=\{view\.sales\.handoff\.handedOffAt \? closureWords\.lead\.handedOff : null\}/u);
  assert.match(profile, /readClosedLeads\(actor, \{ leadId: explicitTarget\.leadId, limit: 1 \}\)/u);
  const pipeline = read("src/components/v3/Pipeline.tsx");
  assert.match(pipeline, /blockedReason=\{terminal \? closureWords\.lead\.handedOff : null\}/u);
  const actions = read("src/lib/platform-closure-actions.ts");
  assert.match(actions, /if \(isStaffPreview\(actor\)\) return refusal\("lead", closed, "preview", requestId\);/u);
  assert.match(actions, /if \(isStaffPreview\(actor\)\) return refusal\("case", closed, "preview", requestId\);/u);
  assert.equal(parsePipelineReturnTo("/v3/pipeline?view=closed"), "/v3/pipeline?view=closed");
  assert.equal(parsePipelineReturnTo("/v3/pipeline?view=open"), null);
  // Закрытый лид: возврат над заголовком (PartShell back), «К закрытым лидам», если пришли из списка.
  assert.equal(isClosedLeadsReturn("/v3/pipeline?view=closed"), true);
  assert.equal(isClosedLeadsReturn("/v3/pipeline?stage=new"), false);
  assert.match(profile, /pipelineReturnTo && isClosedLeadsReturn\(pipelineReturnTo\) \? closureWords\.lead\.backToClosed/u);
  assert.match(profile, /back=\{caseBack \?\? closedLeadBack\}/u);
  assert.match(profile, /: closedLead \? closedLead\.name \?\? "Лид без имени"/u);
  // Окно «Завершить дело» получает число открытых задач, прочитанное «Обзором» и панелью.
  assert.match(profile, /openTasks=\{caseWork\?\.tasks\.kind === "ready" \? caseWork\.tasks\.tasks\.length : null\}/u);
  assert.match(read("src/components/v3/students/StudentQuickView.tsx"), /openTasks=\{tasks\?\.kind === "ready" \? tasks\.tasks\.length : null\}/u);
  // Строка доски после закрытия скрывается настоящей кнопкой 44 px; итог возврата — её же строка.
  assert.match(pipeline, /<button type="button" onClick=\{dismissNotice\} aria-label=\{closureWords\.dismiss\}/u);
  assert.match(pipeline, /className="flex size-11 shrink-0 items-center justify-center rounded-nav/u);
  assert.match(pipeline, /Лид «\{closedNotice\.name\}» снова в работе\./u);
});
