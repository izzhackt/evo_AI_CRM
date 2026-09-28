// Э8.11 «Критичные правки» (PLAN_CHANGES 28.09, «Э8»): имена в «Студентах»,
// доска поступления на телефоне и источник в «Добавить лида». Журнал
// действий — в tests/v3-settings-journal-contract.test.mjs. Браузерные
// проверки — статические стенды: students-static-render.cjs (1440/1280/390),
// boards-static-render.cjs (--screenshots и --hydrate, телефон 390) и
// requests-static-render.cjs --manual-lead-form.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import { admissionsNarrowStage } from "../src/lib/platform-admissions-pipeline-contract.ts";
import { MANUAL_LEAD_SOURCE_REQUIRED, MANUAL_LEAD_SOURCES } from "../src/lib/platform-manual-lead-contract.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("«Студенты»: the student column is at least 14rem, the name wraps to two lines, stage and curator grow from a fixed minimum", () => {
  const table = read("src/components/v3/students/StudentsQueueTable.tsx");
  // Каждая строка — своя сетка: у каждой колонки постоянный минимум и доля
  // (fit-content развёл бы колонки строк). Этап и куратор растут с таблицей:
  // от 1366 «ждёт принятия» помещается под именем куратора одной строкой.
  assert.match(table, /const WIDE_COLUMNS = "@min-\[60rem\]\/students:grid-cols-\[minmax\(14rem,1\.4fr\)_minmax\(0,1\.5fr\)_minmax\(5\.25rem,\.5fr\)_minmax\(7\.5rem,\.9fr\)_minmax\(6\.5rem,\.9fr\)_minmax\(11rem,\.9fr\)_2\.75rem\]/u);
  assert.match(table, /const WIDE_COLUMNS_MINE = "@min-\[60rem\]\/students:grid-cols-\[minmax\(14rem,1\.4fr\)_minmax\(0,1\.8fr\)_minmax\(5\.25rem,\.5fr\)_minmax\(7\.5rem,\.9fr\)_minmax\(11rem,1fr\)_2\.75rem\]/u);
  assert.doesNotMatch(table, /grid-cols-\[[^\]]*fit-content/u);
  // Имя-ссылка строки: до двух строк, полное имя — в подсказке.
  const link = table.match(/<Link\s+href=\{links\.open\}[\s\S]*?<\/Link>/u)?.[0] ?? "";
  assert.match(link, /title=\{row\.studentDisplayName\}/u);
  assert.match(link, /className="line-clamp-2 break-words t-item text-fg /u);
  assert.doesNotMatch(link, /\btruncate\b/u);
  // Строка «направление · уровень» по-прежнему в одну строку.
  assert.match(table, /<span className="block truncate t-meta text-fg-2" title=\{meta\}>/u);
});

test("phone admissions board opens on the ?stage= stage, else the first stage with cases, else the first", () => {
  const rows = (...stages) => stages.map((pipelineStage) => ({ pipelineStage }));
  // Пустой первый этап не открывается, если дела есть дальше.
  assert.equal(admissionsNarrowStage("admission", rows("documents", "awaiting_decision"), null), "documents");
  assert.equal(admissionsNarrowStage("admission", rows("new", "documents"), undefined), "new");
  // Все этапы раздела пусты (дела только в другом разделе) — первый.
  assert.equal(admissionsNarrowStage("admission", rows("visa"), null), "new");
  assert.equal(admissionsNarrowStage("visa", [], null), "confirmed");
  assert.equal(admissionsNarrowStage("visa", rows("new", "predeparture"), null), "predeparture");
  // `?stage=` раздела — открыт он, даже пустой: обновление страницы сохраняет выбор.
  assert.equal(admissionsNarrowStage("admission", rows("documents"), "awaiting_decision"), "awaiting_decision");
  // Этап другого раздела или чужое слово — не учитываются.
  assert.equal(admissionsNarrowStage("admission", rows("documents"), "visa"), "documents");
  assert.equal(admissionsNarrowStage("admission", rows("documents"), "<script>"), "documents");
});

test("phone admissions board: the page passes ?stage= and the picker (or a followed card) writes it back without a server round trip", () => {
  const page = read("src/app/(v3)/v3/admissions-pipeline/page.tsx");
  assert.match(page, /stage\?: string \| string\[\];/u);
  assert.match(page, /requestedStage=\{singleValue\(params\.stage\) \?\? null\}/u);
  const board = read("src/components/v3/AdmissionsPipelineBoard.tsx");
  assert.match(board, /useState<AdmissionsPipelineStage>\(\(\) => admissionsNarrowStage\(tab, rows, requestedStage\)\)/u);
  assert.match(board, /setPreviousTab\(tab\);\s*setNarrowStage\(admissionsNarrowStage\(tab, rows, requestedStage\)\);/u);
  assert.match(board, /onChange=\{\(event\) => chooseNarrowStage\(event\.target\.value as AdmissionsPipelineStage\)\}/u);
  // Список, последовавший за карточкой после ответа сервера, тоже пишет адрес.
  assert.match(board, /function showStage\(stage: AdmissionsPipelineStage\) \{\s*if \(admissionsPipelineTabOf\(stage\) === tab\) chooseNarrowStage\(stage\);\s*\}/u);
  assert.match(board, /search\.set\("stage", next\);\s*window\.history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\?\$\{search\.toString\(\)\}`\);/u);
  assert.doesNotMatch(board, /useState<AdmissionsPipelineStage>\(ADMISSIONS_PIPELINE_TAB_STAGES\[tab\]\[0\]\)/u);
});

test("«Добавить лида»: the source opens on «Не выбрано», is required, and keeps the five existing keys", () => {
  // WhatsApp и Instagram не добавлены: проверка 143 их не знает (нужна миграция),
  // а ручной лид с источником WhatsApp встал бы в очередь «Заявки» (221, 250).
  assert.deepEqual(Object.keys(MANUAL_LEAD_SOURCES), ["office", "phone_call", "referral", "website", "other"]);
  assert.equal(MANUAL_LEAD_SOURCE_REQUIRED, "Выберите источник");
  const form = read("src/components/v3/ManualLeadForm.tsx");
  assert.match(form, /<select name="source" required defaultValue=""/u);
  assert.match(form, /<option value="">Не выбрано<\/option>\{Object\.entries\(MANUAL_LEAD_SOURCES\)\.map/u);
  assert.match(form, /event\.currentTarget\.setCustomValidity\(MANUAL_LEAD_SOURCE_REQUIRED\);/u);
  assert.match(form, /onChange=\{\(event\) => \{ event\.currentTarget\.setCustomValidity\(""\); setSourceMissing\(false\); \}\}/u);
  assert.match(form, /aria-invalid=\{sourceMissing \|\| undefined\} aria-describedby=\{sourceMissing \? sourceErrorId : undefined\}/u);
  assert.match(form, /\{sourceMissing \? <span id=\{sourceErrorId\} role="alert" className="mt-1 block t-body-compact text-danger">\{MANUAL_LEAD_SOURCE_REQUIRED\}<\/span> : null\}/u);
  assert.match(form, /source_required: `\$\{MANUAL_LEAD_SOURCE_REQUIRED\}\.`/u);
});

/**
 * Серверное действие — настоящий модуль с подменёнными границами (смотрящий,
 * права, запись лида, кеш Next). Не Supabase и не живой сервер.
 */
function manualLeadAction() {
  const require = createRequire(import.meta.url);
  const compile = (path, boundary = () => undefined) => {
    const code = ts.transpileModule(read(path), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const compiled = { exports: {} };
    new Function("require", "module", "exports", code)((id) => boundary(id) ?? require(id), compiled, compiled.exports);
    return compiled.exports;
  };
  const created = [];
  const action = compile("src/lib/platform-manual-lead-actions.ts", (id) => ({
    "./platform-access.ts": { isStaffPreview: () => false, staffHasPermission: () => true },
    "next/cache": { revalidatePath() {} },
    "./platform-guards": { requirePlatformStaffActor: async () => ({ organizationId: "org" }) },
    "./platform-manual-lead-contract": compile("src/lib/platform-manual-lead-contract.ts"),
    "./platform-sales-register-contract": compile("src/lib/platform-sales-register-contract.ts"),
    "./server/action-form-fields": compile("src/lib/server/action-form-fields.ts", (inner) => (inner === "server-only" ? {} : undefined)),
    "./v3/manual-lead-source": {
      createManualLead: async (_actor, input) => {
        created.push(input);
        return { status: "duplicate", requestId: input.requestId, leadId: null };
      },
    },
  })[id]);
  return { createManualLeadAction: action.createManualLeadAction, created };
}

test("«Добавить лида» on the server: no source is «Выберите источник», an unknown key stays invalid, a chosen key is saved as is", async () => {
  const { createManualLeadAction, created } = manualLeadAction();
  const requestId = "11111111-2222-4333-8444-555555555555";
  const form = (source) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({
      request_id: requestId, name: "Тест Синтетический", phone: "+996 555 000 000", email: "", source,
      owner_id: "66666666-7777-4888-8999-000000000000", direction: "", next_action: "", due_date: "",
    })) data.set(key, value);
    return data;
  };
  const idle = { status: "idle", requestId, leadId: null };
  assert.deepEqual(await createManualLeadAction(idle, form("")), { status: "source_required", requestId, leadId: null });
  assert.deepEqual(await createManualLeadAction(idle, form("   ")), { status: "source_required", requestId, leadId: null });
  assert.equal(created.length, 0, "nothing is written without a source");
  for (const unknown of ["whatsapp", "instagram", "Звонок"]) {
    assert.equal((await createManualLeadAction(idle, form(unknown))).status, "invalid", unknown);
  }
  assert.equal(created.length, 0);
  assert.equal((await createManualLeadAction(idle, form("phone_call"))).status, "duplicate");
  assert.deepEqual(created.map((input) => input.source), ["phone_call"]);
});
