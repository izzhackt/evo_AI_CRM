import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isConnectedPlatformApi,
  isConnectedPlatformPage,
  isConnectedPlatformPrivateApi,
} from "../src/lib/platform-route-contract.ts";
import * as routeContract from "../src/lib/platform-route-contract.ts";
import * as orchestrator from "../src/lib/server/platform-provider-orchestrator.ts";
import * as workflows from "../src/lib/platform-provider-workflows.ts";
import { settingsIntegrations } from "../src/lib/v3/settings-health.ts";

/*
 * ИИ-агент P1, срез 6 (docs/EVO_AI_AGENT_PLAN_2026-10-06.md §5.6, §14):
 * перенос «Базы знаний» больше не создаёт папку «ИИ-ассистент», а старые
 * пути ИИ в CRM (staff-assistant и черновики Gemini U9) удалены. SQL-таблицы
 * и функции 030/054/065–067/075/091 остаются — их здесь не проверяем.
 */
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const AI_FOLDER = "ИИ-ассистент";

test("the import structure never creates the «ИИ-ассистент» folder", () => {
  const source = read("src/components/v3/knowledge/import-structure.ts");
  const list = source.match(/const paths = (\[[\s\S]*?\]);/u);
  assert.ok(list, "prepareKnowledgeStructure keeps one literal folder list");
  const paths = JSON.parse(list[1].replace(/,\s*\]$/u, "]"));
  assert.deepEqual(paths, [
    ["Компания", "О компании"], ["Компания", "Услуги и условия EVO"], ["Команда и партнёры"], ["Процессы и инструкции"],
    ["Шаблоны документов"], ["Словарь EVO"], ["Страны и поступление"], ["Входящие"],
  ]);
  assert.equal(paths.flat().includes(AI_FOLDER), false);
});

const PYTHON_ROUTING = String.raw`
import hashlib, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import inventory, prepare_import

def row(scope, root_name, within, size=120):
    return {'sourceRoot': '/synthetic', 'relativePath': root_name + '/' + within, 'status': 'hashed',
            'scope': scope, 'extension': Path(within).suffix, 'bytes': size,
            'proposedFolder': inventory.proposal(scope, Path(within))}

client = 'Клиентская база знаний ЭВО'
internal = 'Внутренняя база знаний ЭВО'
planned = {
    'faq': prepare_import.plan(row('approved-client-knowledge', client, 'FAQ и шаблоны ответов/Гарантия поступления.md')),
    'rules': prepare_import.plan(row('approved-client-knowledge', client, 'О базе и правила ответов/Утверждено для ИИ.md')),
    'readme': prepare_import.plan(row('approved-client-knowledge', client, 'README.md')),
}
out = {k: {'area': v['area'], 'folders': v['folders'], 'kind': v['kind'], 'classification': v['classification']}
       for k, v in planned.items()}

with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp)
    for key, within, text in [
        ('internalFaq', 'Утверждено для внутреннего ИИ/Продажи и ответы/FAQ по обучению.md', '# FAQ по обучению и визе\n\nСинтетический текст.\n'),
        ('assistantHeading', 'Утверждено для внутреннего ИИ/Сценарии/Ответы.md', '# Ассистент: сценарии ответов\n\nСинтетический текст.\n'),
    ]:
        data = text.encode('utf-8')
        source = base / internal / within
        source.parent.mkdir(parents=True)
        source.write_bytes(data)
        entry = prepare_import.plan(row('internal', internal, within, len(data)))
        entry['sha256'] = hashlib.sha256(data).hexdigest()
        done = prepare_import.classify_reviewed_text(entry, base)
        out[key] = {'area': done['area'], 'folders': done['folders'], 'kind': done['kind'],
                    'classification': done['classification']}

out['topics'] = sorted(set(prepare_import.TOPICS.values()))
print(json.dumps(out, ensure_ascii=False))
`;

test("the local-base import plan routes FAQ, answer rules and the README outside «ИИ-ассистент»", () => {
  const scripts = fileURLToPath(new URL("scripts/knowledge-library/", root));
  const run = spawnSync("python3", ["-B", "-c", PYTHON_ROUTING, scripts], { encoding: "utf8" });
  assert.equal(run.error, undefined, "python3 must be available for the knowledge import scripts");
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(run.stdout);

  assert.deepEqual(plan.faq, { area: "internal", folders: ["Компания", "Вопросы и ответы"], kind: "page",
    classification: "historically_approved_general_client_knowledge" });
  assert.deepEqual(plan.rules, { area: "internal", folders: ["Процессы и инструкции", "Правила ответов"], kind: "page",
    classification: "historically_approved_general_client_knowledge" });
  assert.deepEqual(plan.readme, { area: "internal", folders: ["Процессы и инструкции", "Устройство базы знаний"],
    kind: "page", classification: "historically_approved_general_client_knowledge" });
  // Заголовок «FAQ» раньше уводил страницу в «ИИ-ассистент»; теперь — в «Компанию».
  assert.deepEqual(plan.internalFaq, { area: "internal", folders: ["Компания", "Продажи и ответы"], kind: "page",
    classification: "historically_approved_internal_knowledge" });
  // Слово «ассистент» в заголовке больше не выбирает папку.
  assert.deepEqual(plan.assistantHeading, { area: "internal", folders: ["Внутренние знания", "Сценарии"], kind: "page",
    classification: "historically_approved_internal_knowledge" });
  assert.equal(plan.topics.includes(AI_FOLDER), false);
  assert.equal(JSON.stringify(plan).includes(AI_FOLDER), false);
});

test("the staff-assistant route and its server code are gone and the path stays closed", () => {
  for (const removed of [
    "src/app/api/platform-ai/staff-assistant/route.ts",
    "src/lib/server/platform-staff-assistant-config.ts",
    "src/lib/server/platform-staff-assistant-contract.ts",
    "src/lib/server/platform-staff-assistant-provider.ts",
    "src/lib/server/platform-staff-assistant-service.ts",
    "src/lib/server/platform-staff-knowledge-repository.ts",
  ]) {
    assert.equal(existsSync(new URL(removed, root)), false, removed);
  }
  const path = "/api/platform-ai/staff-assistant";
  assert.equal(isConnectedPlatformApi(path), false);
  assert.equal(isConnectedPlatformPrivateApi(path), false);
  assert.equal(isConnectedPlatformPage(path), false);
  assert.equal("isDirectPlatformStaffAssistantApi" in routeContract, false);
  assert.doesNotMatch(read("src/proxy.ts"), /StaffAssistant|platform-ai/u);
  assert.doesNotMatch(read(".env.example"), /EVO_PLATFORM_STAFF_ASSISTANT_ENABLED/u);
});

test("the U9 Gemini proposal path is gone while the manual WhatsApp send path stays", () => {
  assert.equal(existsSync(new URL("src/lib/server/platform-gemini-provider.ts", root)), false);
  for (const name of ["executePlatformGeminiProposal", "PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA"]) {
    assert.equal(name in orchestrator, false, name);
  }
  for (const name of ["requestGeminiProposal", "beginGeminiProposal", "finishGeminiProposal", "readStaffGeminiProposal",
    "reviewGeminiProposal", "listStaffGeminiProposalReviews", "PLATFORM_GEMINI_MODEL_REF"]) {
    assert.equal(name in workflows, false, name);
  }
  for (const name of ["executePlatformManualWhatsAppSend", "executePlatformManualWhatsAppReconciliation",
    "sendClaimedManualWhatsApp"]) {
    assert.equal(typeof orchestrator[name], "function", name);
  }
  for (const name of ["requestManualWhatsAppSendWithAuthorization", "claimManualWhatsAppSendItem",
    "finishManualWhatsAppSend", "finishManualWhatsAppReconciliation"]) {
    assert.equal(typeof workflows[name], "function", name);
  }
  assert.equal(workflows.PLATFORM_WAHA_BASE_URL, "http://evo-crm-waha:3000");
});

test("«Настройки → Интеграции» names what the CRM Gemini key still does, not reply drafts", () => {
  // Ключ CRM распознаёт документы; черновики ответов — в evo-ai-agent со своим ключом (ADR 0032).
  const now = new Date("2026-10-06T06:00:00.000Z");
  for (const gemini of ["not_configured", "configured_not_verified", "blocked", "ready"]) {
    const row = settingsIntegrations({
      waha: { display: "not_configured", sessionStatus: undefined, observedAt: null },
      gemini,
      amo: { status: "blocked", reason: "configuration_missing" },
    }, now).find((item) => item.key === "gemini");
    assert.equal(row.name, "Gemini · распознавание документов", gemini);
    assert.doesNotMatch(`${row.name} ${row.detail ?? ""} ${row.without ?? ""}`, /черновик|ответ/iu, gemini);
  }
});

test("the seed runbook seeds only through the admin RPC and trashes the folder reversibly", () => {
  const runbook = read("docs/runbooks/ai-agent-seed.md");
  for (const required of [
    "platform.ai_agent_seed_from_kb_v1",
    "'document'",
    "'rules'",
    "historically_approved_general_client_knowledge",
    "historically_approved_internal_knowledge",
    "«В корзину»",
    "«Восстановить»",
    "ai_agent_consent_record_v1",
  ]) {
    assert.ok(runbook.includes(required), required);
  }
  // Агент сам ничего не применяет в production; прямых записей в таблицы ИИ нет.
  assert.doesNotMatch(runbook, /INSERT\s+INTO\s+platform_private\.ai_/iu);
  assert.doesNotMatch(runbook, /UPDATE\s+platform_private\.(?:ai_|kb_)/iu);
  assert.doesNotMatch(runbook, /n\.kind\s*=\s*'file'/u);
});

test("every SQL block of the seed runbook runs verbatim in the Postgres suite", () => {
  const runbook = read("docs/runbooks/ai-agent-seed.md");
  const suite = read("supabase/tests/platform_ai_agent_seed_runbook.sql");
  assert.match(read("scripts/test-postgres-authorization.sh"),
    /-f \/workspace\/supabase\/tests\/platform_ai_agent_seed_runbook\.sql/u);
  const blocks = [...runbook.matchAll(/```sql\n([\s\S]*?)```/gu)].map((match) => match[1]);
  assert.equal(blocks.length, 9, "preview ×2, steps 2–4, checks ×4");
  const placeholders = [["'<ORGANIZATION_ID>'", ":'org'"], ["'<ADMIN_AUTH_USER_ID>'", ":'admin_uid'"],
    ["'<REQUEST_ID>'", ":'req'"], ["'<EXPECTED_COUNT>'", ":'expected'"]];
  let writes = 0;
  for (const block of blocks) {
    let sql = placeholders.reduce((text, [from, to]) => text.replaceAll(from, to), block);
    assert.doesNotMatch(sql.replaceAll("<>", ""), /</u, "every placeholder is one of the four documented ones");
    if (sql.startsWith("BEGIN;\n")) {
      assert.ok(sql.endsWith("COMMIT;\n"), "a write block ends with COMMIT (ROLLBACK for the rehearsal)");
      assert.match(sql, /\nSET LOCAL ROLE authenticated;\nSELECT platform\.ai_agent_seed_from_kb_v1\(/u);
      assert.match(sql, /platform_private\.custom_access_token_hook/u);
      sql = sql.slice("BEGIN;\n".length, -"COMMIT;\n".length);
      writes += 1;
    } else {
      assert.match(sql, /^(?:WITH|SELECT)\b/u, "a check block only reads");
    }
    assert.ok(suite.includes(sql.trimEnd()), `the suite runs this runbook block verbatim:\n${sql.slice(0, 160)}`);
  }
  assert.equal(writes, 3);
});
