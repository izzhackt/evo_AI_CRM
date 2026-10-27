// «Новый вид» (решение владельца 27.10.2026), поток «ИИ-агенты»: хаб и страница агента из набора виджетов.
// Данные синтетические (tests/e2e/ai-agents-next-fixtures.cjs). Проверяется: настоящие страницы `/v3/ai-agents` и
// `/v3/ai-agents/[key]` (границы данных и прав подменены, `isNextUi` и правило переключателя — настоящие) рисуют новый вид только
// настоящему администратору с cookie, а всем остальным — прежний; новый вид строится из набора и не теряет предупреждений;
// пояснения ушли за «?»; условия запуска те же, что у прежнего `AgentBody`. Живую вёрстку, фокус и доступность
// меряет tests/e2e/ai-agents-next-static-render.cjs.
//
//   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-next-ui.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { AI_AGENT_CATALOG } from "../src/lib/ai-agents/contract.ts";
import { canUseNextUi, isNextUiFor } from "../src/lib/ui-next-contract.ts";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const require = createRequire(import.meta.url);
const { makeFixtures, ACTOR } = require("./e2e/ai-agents-next-fixtures.cjs");
const F = makeFixtures(AI_AGENT_CATALOG);

/* ------------------------------------------------------------------ сборка страниц */

const FIXTURES_PATH = root("tests/e2e/ai-agents-next-fixtures.cjs");
const LINK_SHIM = `const React = require("react");
function Link(props) { const { href, prefetch, scroll, replace, children, ...rest } = props; return React.createElement("a", { ...rest, href: String(href) }, children); }
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;`;
const ACTION_STUB = `const f = async () => ({ status: "idle", code: null, message: null, requestId: null });
module.exports = { updateAiAgentAction: f, saveAiAgentInstructionsAction: f, syncAiAgentAction: f, startAiAgentRunAction: f, followUpAiAgentRunAction: f,
  pollAiAgentRunAction: async () => ({ ok: false, code: "unavailable" }), interruptAiAgentRunAction: f, loadAiAgentRunTranscriptAction: async () => ({ ok: false, code: "unavailable" }), decideAiAgentDraftAction: f };`;
/** Границы данных и прав страниц: чтения возвращают синтетические данные, сверка и базы нет. `isNextUi` — настоящий. */
const STUBS = {
  "@/lib/platform-guards": `export async function requireV3PageActor() { return globalThis.__world.actor; }`,
  "@/lib/supabase/server": `export async function createSupabaseServerClient() { return {}; }`,
  "@/lib/server/ai-agents/config-hash": `export const computeAiAgentConfigHash = () => "a".repeat(64); export const resolveAiAgentsMcpUrl = () => "https://crm.example.invalid/api/mcp/v1";`,
  "@/lib/server/ai-agents/runtime": `export const aiAgentsRuntimeAvailability = () => ({ configured: globalThis.__world.configured !== false });
export const aiAgentsWhatsappDailyCapCents = () => 1000;
export const readAiAgentWhatsappCap = async () => ({ spentCents: 230, reservedCents: 0 });
export const reconcileAiAgentRuns = async () => undefined;`,
  "@/lib/v3/ai-agents-source": `import { AI_AGENT_CATALOG } from "@/lib/ai-agents/contract";
import fixtures from ${JSON.stringify(FIXTURES_PATH)};
const F = fixtures.makeFixtures(AI_AGENT_CATALOG);
export const readAiAgents = async () => F.available(F.LIST);
export const readAiAgent = async (_actor, key) => F.available(F.detail(key));
export const readAiAgentDigests = async () => F.available({ digests: F.DIGESTS });
export const readAiAgentRuns = async () => F.available({ runs: F.RUNS, hasMore: false });
export const readAiAgentRun = async () => F.available(F.RUN_DETAIL);
export const readAiAgentDrafts = async () => F.available(F.DRAFTS);`,
  "next/headers": `export async function cookies() { return { get: (name) => (name === "evo_ui" && globalThis.__world.cookie ? { name, value: globalThis.__world.cookie } : undefined) }; }`,
  "next/navigation": `export function notFound() { throw new Error("NEXT_NOT_FOUND"); }`,
};

const ENTRY = `
import { renderToStaticMarkup } from "react-dom/server";
import HubPage from "@/app/(v3)/v3/ai-agents/page";
import AgentPage from "@/app/(v3)/v3/ai-agents/[key]/page";
import { AgentBody } from "@/components/v3/ai-agents/AgentBody";
import { AgentsHub } from "@/components/v3/ai-agents/AgentsHub";
import { NextAgentPage } from "@/components/v3/ai-agents-next/NextAgentPage";
import { NextAgentsView } from "@/components/v3/ai-agents-next/NextAgentsView";
import { NextAgentSwitches } from "@/components/v3/ai-agents-next/NextAgentSwitches";
import { NextOverview } from "@/components/v3/ai-agents-next/NextOverview";
import { NextSettings } from "@/components/v3/ai-agents-next/NextSettings";
import { NextRunSheetBody } from "@/components/v3/ai-agents-next/NextRunSheet";
import { DraftCard } from "@/components/v3/ai-agents/DraftCard";
import { agentGate } from "@/components/v3/ai-agents-next/agent-gate";
export const html = {
  hubPage: async (world) => { globalThis.__world = world; return renderToStaticMarkup(await HubPage()); },
  agentPage: async (world, key, search = {}) => { globalThis.__world = world; return renderToStaticMarkup(await AgentPage({ params: Promise.resolve({ key }), searchParams: Promise.resolve(search) })); },
  legacyBody: (props) => renderToStaticMarkup(<AgentBody {...props} />),
  legacyHub: (list, runtimeConfigured, preview) => renderToStaticMarkup(<AgentsHub list={list} runtimeConfigured={runtimeConfigured} preview={preview} />),
  nextPage: (props) => renderToStaticMarkup(<NextAgentPage {...props} />),
  nextHub: (read, runtimeConfigured, preview) => renderToStaticMarkup(<NextAgentsView read={read} runtimeConfigured={runtimeConfigured} preview={preview} />),
  switches: (props) => renderToStaticMarkup(<NextAgentSwitches {...props} />),
  overview: (props) => renderToStaticMarkup(<NextOverview {...props} />),
  settings: (props) => renderToStaticMarkup(<NextSettings {...props} />),
  runSheet: (props) => renderToStaticMarkup(<NextRunSheetBody {...props} />),
  draftCard: (props) => renderToStaticMarkup(<DraftCard {...props} />),
  agentGate,
};
`;

let bundle;
async function views() {
  if (bundle) return bundle;
  const dir = mkdtempSync(join(tmpdir(), "aia-next-"));
  try {
    writeFileSync(join(dir, "entry.tsx"), ENTRY);
    const outfile = join(dir, "out.cjs");
    const base = root("");
    await build({
      entryPoints: [join(dir, "entry.tsx")], outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      tsconfig: root("tsconfig.json"), absWorkingDir: base, nodePaths: [root("node_modules")], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "aia-next-test",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
          b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: base, loader: "js" }));
          b.onResolve({ filter: /^@\/lib\/platform-ai-agents-actions$/ }, () => ({ path: "actions-stub", namespace: "actions" }));
          b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: ACTION_STUB, loader: "js" }));
          b.onResolve({ filter: /^(@\/lib\/platform-guards|@\/lib\/supabase\/server|@\/lib\/server\/ai-agents\/config-hash|@\/lib\/server\/ai-agents\/runtime|@\/lib\/v3\/ai-agents-source|next\/headers|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], resolveDir: base, loader: "ts" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        },
      }],
    });
    bundle = createRequire(root("package.json"))(outfile).html;
    return bundle;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ADMIN = ACTOR;
const STAFF = { ...ACTOR, systemRole: "staff", presentationRole: null, displayName: "Сотрудник Синтетический", permissionKeys: ["ai.agent.use", "ai.agent.manage"] };
const PREVIEW = { ...ACTOR, presentationRole: "sales" };
const world = (actor, cookie, extra = {}) => ({ actor, cookie, ...extra });
const strip = (markup) => markup.replace(/<!-- -->/gu, "");

/* ------------------------------------------------------------------ переключатель: прежний вид — всем, кроме администратора с cookie */

test("хаб: новый вид только настоящему администратору с cookie, остальные — прежний вид, один и тот же", async () => {
  const { hubPage } = await views();
  const on = strip(await hubPage(world(ADMIN, "next")));
  const legacy = [
    strip(await hubPage(world(ADMIN, undefined))),
    strip(await hubPage(world(ADMIN, "legacy"))),
    strip(await hubPage(world(STAFF, "next"))),
    strip(await hubPage(world(PREVIEW, "next"))),
  ];
  assert.match(on, /data-slot="stat-tile"/u, "новый вид — плитки набора");
  assert.match(on, /data-testid="v3-aia-hub"/u);
  for (const [index, markup] of legacy.entries()) {
    assert.doesNotMatch(markup, /data-slot="(?:card|stat-tile)"/u, `прежний вид без виджетов набора (${index})`);
    assert.match(markup, /data-testid="v3-aia-hub"/u);
    assert.match(markup, /Запуски, 14 дней/u, "прежняя карточка со спарклайном");
  }
  assert.equal(legacy[2], legacy[0], "сотруднику cookie ничего не даёт: разметка та же, что у администратора без cookie");
  assert.equal(legacy[1], legacy[0], "чужое значение cookie не включает новый вид");
  assert.equal(canUseNextUi(ADMIN) && isNextUiFor(ADMIN, "next"), true);
  assert.equal(isNextUiFor(PREVIEW, "next"), false, "просмотр роли — не администратор");
});

test("страница агента: на каждой вкладке новый вид только у администратора с cookie; чтения и права те же", async () => {
  const { agentPage } = await views();
  for (const [search, marker] of [
    [{ tab: "overview" }, "v3-aia-overview"], [{ tab: "runs" }, "v3-aia-runs"], [{ tab: "drafts" }, "v3-aia-drafts"],
    [{ tab: "instructions" }, "v3-aia-instructions"], [{ tab: "settings" }, "v3-aia-settings"], [{}, "v3-aia-workspace"],
  ]) {
    const on = strip(await agentPage(world(ADMIN, "next"), "director", search));
    const off = strip(await agentPage(world(ADMIN, undefined), "director", search));
    const staff = strip(await agentPage(world(STAFF, "next"), "director", search));
    const preview = strip(await agentPage(world(PREVIEW, "next"), "director", search));
    assert.match(on, new RegExp(`data-testid="${marker}`, "u"), `${JSON.stringify(search)}: вкладка на месте`);
    assert.match(on, /data-slot="(?:card|switch|button)"/u, `${JSON.stringify(search)}: виджеты набора`);
    assert.doesNotMatch(off, /data-slot="(?:card|stat-tile|switch)"/u, `${JSON.stringify(search)}: прежний вид без виджетов набора`);
    assert.match(off, new RegExp(`data-testid="${marker}`, "u"));
    assert.doesNotMatch(staff, /data-slot="(?:card|stat-tile|switch)"/u, `${JSON.stringify(search)}: сотрудник`);
    assert.doesNotMatch(preview, /data-slot="(?:card|stat-tile|switch)"/u, `${JSON.stringify(search)}: просмотр роли`);
  }
  // Запуск целиком: адрес `?run=` тот же, содержимое — карточки набора.
  const run = strip(await agentPage(world(ADMIN, "next"), "director", { tab: "runs", run: "11111111-1111-4111-8111-000000000001" }));
  assert.match(run, /data-testid="v3-aia-run-detail"/u);
  assert.match(run, /Вся история работы/u);
  // Неизвестная вкладка и ключ — 404 в обоих видах (до выбора вида).
  await assert.rejects(agentPage(world(ADMIN, "next"), "director", { tab: "nope" }), /NEXT_NOT_FOUND/u);
  await assert.rejects(agentPage(world(ADMIN, "next"), "nope", {}), /NEXT_NOT_FOUND/u);
});

/* ------------------------------------------------------------------ хаб */

test("хаб, новый вид: плитки, три группы, карточки со ссылками и «?», ряд «Не настроены», Gemini; пояснения за «?»", async () => {
  const { nextHub, legacyHub } = await views();
  const next = strip(nextHub(F.available(F.LIST), true, false));
  const legacy = strip(legacyHub(F.LIST, true, false));
  assert.equal((next.match(/data-slot="stat-tile"/gu) ?? []).length, 4);
  for (const label of ["Включено агентов", "Запусков за 7 дней", "Расход за 7 дней", "Ждут решения"]) assert.match(next, new RegExp(label, "u"));
  for (const group of ["sales", "analytics", "curators"]) assert.match(next, new RegExp(`data-testid="v3-aia-group-${group}"`, "u"));
  for (const key of ["director", "sales", "curator-cn", "curator-my", "curator-eu", "curator-ae", "curator-tr"]) assert.match(next, new RegExp(`data-testid="v3-aia-card-${key}"`, "u"), key);
  assert.match(next, /href="\/v3\/ai-agents\/director\?tab=drafts"/u, "очередь черновиков — ссылкой с карточки");
  assert.match(next, /href="\/v3\/ai-agents\/sales"/u);
  assert.match(next, /Не настроены:/u);
  assert.match(next, /aria-label="Пояснение: Директор \/ Аналитик"/u, "роль агента — за «?»");
  // Режем: пояснения и украшения не на экране.
  for (const gone of ["Считает продажи, воронку и поступление", "Подсказывает ответ, сам ничего не отправляет.", "Запуски, 14 дней", "data-testid=\"v3-aia-sparkline\""]) {
    assert.doesNotMatch(next, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `новый вид: «${gone}» убрано с экрана`);
    assert.ok(legacy.includes(gone), `прежний вид: «${gone}» на месте`);
  }
  // Те же данные: число «ждут решения» по каждому агенту.
  assert.match(next, /7 черновиков ждут решения/u);
  assert.match(next, /3 черновика ждут решения/u);
});

test("хаб, предупреждения остаются: ключ Claude не задан, просмотр роли, «Раздел готовится», отказ", async () => {
  const { nextHub } = await views();
  assert.match(nextHub(F.available(F.LIST), false, false), /data-testid="v3-aia-key-missing"[^>]*>[\s\S]*Ключ Claude API не задан в CRM: агенты не запустятся\. Его добавляет администратор\./u);
  assert.doesNotMatch(nextHub(F.available(F.LIST), false, false), /data-testid="v3-aia-ask-/u, "без ключа «Поручить» не предлагается");
  assert.match(nextHub(F.available(F.LIST), true, true), /Вы смотрите раздел глазами роли: кнопки действий отключены\./u);
  assert.doesNotMatch(nextHub(F.available(F.LIST), true, true), /data-testid="v3-aia-ask-/u, "в просмотре роли «Поручить» нет");
  assert.match(nextHub({ status: "not_ready" }, true, false), /Раздел готовится/u);
  const denied = nextHub({ status: "denied" }, true, false);
  assert.match(denied, /Нет доступа к этому разделу\./u);
  assert.doesNotMatch(denied, /Повторить/u);
  assert.match(nextHub({ status: "unavailable" }, true, false), /Не удалось загрузить агентов\.[\s\S]*Повторить/u);
});

/* ------------------------------------------------------------------ условия запуска: те же, что у прежнего AgentBody */

test("условия запуска совпадают с прежним видом: слова причины и состояние поля «Чат» по сценариям", async () => {
  const { legacyBody, agentGate } = await views();
  const scenarios = [
    ["готов", {}, {}],
    ["просмотр роли", { preview: true }, {}],
    ["директор, не администратор", { canEdit: false }, {}],
    ["ключ Claude не задан", { runtimeConfigured: false }, {}],
    ["агент выключен", {}, { enabled: false }],
    ["не синхронизирован", {}, { sync: F.sync({ status: "never", claudeAgentId: null, agentVersion: null, environmentId: null, vaultId: null }) }],
    ["правил нет", {}, { key: "curator-eu", enabled: true, hasInstructionsOverride: false }],
  ];
  for (const [name, bodyOver, detailOver] of scenarios) {
    const key = detailOver.key ?? "director";
    const detail = { ...F.detail(key), ...detailOver };
    const props = F.bodyProps("command", { detail, ...bodyOver, resume: { runId: null, sendAuthority: false } });
    const legacy = strip(legacyBody(props));
    const gate = agentGate({ detail, canEdit: props.canEdit, preview: props.preview, runtimeConfigured: props.runtimeConfigured });
    assert.equal(legacy.includes('data-testid="v3-aia-input"'), gate.canRun, `${name}: поле поручения есть тогда и только тогда, когда можно запускать`);
    if (gate.blockedNote) assert.ok(legacy.includes(gate.blockedNote), `${name}: слова причины те же («${gate.blockedNote}»)`);
    else assert.equal(legacy.includes("Писать агенту пока нельзя"), false, `${name}: чат открыт`);
    assert.equal(gate.canRun, gate.blockedNote === null, `${name}: запрет и причина совпадают`);
  }
  // Первый несделанный шаг у администратора.
  assert.equal(agentGate({ detail: F.detail("curator-eu", { hasInstructionsOverride: false }), canEdit: true, preview: false, runtimeConfigured: true }).step, "instructions");
  assert.equal(agentGate({ detail: F.detail("director", { enabled: false }), canEdit: true, preview: false, runtimeConfigured: true }).step, "enable");
  assert.equal(agentGate({ detail: F.detail("director", { sync: F.sync({ status: "never", claudeAgentId: null }) }), canEdit: true, preview: false, runtimeConfigured: true }).step, "sync");
  assert.equal(agentGate({ detail: F.detail("director"), canEdit: false, preview: false, runtimeConfigured: true }).step, null, "не администратору шагов нет");
});

/* ------------------------------------------------------------------ вкладки */

test("шапка страницы агента: «?» с ролью, «Включён» и «Авто» переключателями набора, шесть вкладок-ссылок, число на «На одобрение»", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("overview")));
  assert.match(page, /<h1[^>]*>Директор \/ Аналитик<\/h1>/u);
  assert.match(page, /aria-label="Пояснение: Директор \/ Аналитик"/u);
  assert.doesNotMatch(page, /Считает продажи, воронку/u, "строка роли — за «?»");
  assert.equal((page.match(/role="switch"/gu) ?? []).length, 2, "ровно два переключателя: «Включён» и «Авто»");
  assert.match(page, /data-testid="v3-aia-switch-enabled"/u);
  assert.match(page, /data-testid="v3-aia-switch-auto"/u);
  for (const [label, tab] of [["Чат", null], ["Обзор", "overview"], ["История работы", "runs"], ["На одобрение", "drafts"], ["Правила агента", "instructions"], ["Настройки", "settings"]]) {
    const href = tab ? `/v3/ai-agents/director?tab=${tab}` : "/v3/ai-agents/director";
    assert.match(page, new RegExp(`<a[^>]*href="${href.replace(/[?]/gu, "\\?")}"[^>]*>${label}`, "u"), label);
  }
  assert.match(page, /aria-current="page"[^>]*>Обзор/u);
  assert.match(page, /На одобрение<span[^>]*>3<\/span>/u);
  assert.match(page, /href="\/v3\/ai-agents"[^>]*>[\s\S]*Все ИИ-агенты/u, "возврат к списку");
  // Не администратор видит состояние словом, а не переключатели.
  const staff = strip(nextPage(F.bodyProps("overview", { canEdit: false })));
  assert.equal((staff.match(/role="switch"/gu) ?? []).length, 0);
  assert.match(staff, /data-testid="v3-aia-switch-enabled-readonly"[\s\S]*Включён/u);
});

test("предупреждения остаются на виду во всех вкладках: ключ Claude, просмотр роли, синхронизация, правил нет", async () => {
  const { nextPage } = await views();
  const noKey = strip(nextPage(F.bodyProps("runs", { runtimeConfigured: false })));
  assert.match(noKey, /data-testid="v3-aia-key-missing"/u);
  const preview = strip(nextPage(F.bodyProps("overview", { preview: true, canEdit: false })));
  assert.match(preview, /Вы смотрите раздел глазами роли/u);
  const failed = F.bodyProps("overview", { detail: F.detail("director", { sync: F.sync({ status: "error", error: "сбой сети" }) }) });
  const page = strip(nextPage(failed));
  assert.match(page, /data-testid="v3-aia-sync-error"[\s\S]*Синхронизация с Claude не удалась: сбой сети\./u);
  assert.match(page, /Повторить синхронизацию/u);
  assert.match(strip(nextPage(F.bodyProps("drafts", { needsSync: true }))), /data-testid="v3-aia-needs-sync"[\s\S]*Изменения не отправлены в Claude/u);
  // «Настройки» говорят о синхронизации в своей карточке, а не второй плашкой над вкладками.
  const settings = strip(nextPage(F.bodyProps("settings", { needsSync: true })));
  assert.doesNotMatch(settings, /data-testid="v3-aia-needs-sync"/u);
  assert.match(settings, /data-testid="v3-aia-sync-panel"[\s\S]*Изменения не отправлены в Claude — агент работает по прежним настройкам\./u);
  const noRules = F.detail("curator-eu", { hasInstructionsOverride: false, enabled: false });
  const rules = strip(nextPage(F.bodyProps("instructions", { detail: noRules })));
  assert.match(rules, /data-testid="v3-aia-no-instructions"[\s\S]*Правил нет\. Без них агента не включить\./u);
  assert.match(strip(nextPage(F.bodyProps("overview", { detail: noRules }))), /data-testid="v3-aia-setup"[\s\S]*Агент не настроен/u, "три шага запуска вместо пустых блоков");
});

test("«Обзор»: плитки, последний отчёт, графики, «Работа агента»; инструменты и прошлые отчёты в панелях", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("overview")));
  assert.equal((page.match(/data-slot="stat-tile"/gu) ?? []).length, 4);
  assert.match(page, /Последний отчёт/u);
  assert.match(page, /Неделя 12–18 октября/u);
  assert.match(page, /Запуски по дням/u);
  assert.match(page, /Расход по дням/u);
  assert.match(page, /Работа агента/u);
  assert.match(page, /Что делает агент/u);
  assert.match(page, /Прошлые отчёты/u);
  assert.doesNotMatch(page, /data-testid="v3-aia-tool-bars"/u, "столбики инструментов — в панели, не на экране");
  assert.doesNotMatch(page, /Неделя 5–11 октября/u, "прошлые отчёты — в панели");
  assert.doesNotMatch(page, /<details[^>]*data-testid="v3-aia-tools-panel"/u, "инструменты — не раскрывающаяся строка: второстепенное — в панели");
  assert.match(page, /href="\/v3\/ai-agents\/director\?tab=drafts"/u, "плитка «Ждут решения» ведёт в очередь");
  const never = strip(nextPage(F.bodyProps("overview", { detail: F.detail("director", { stats: F.stats({ lastRunAt: null, lastRunStatus: null, runs7d: 0 }), lastDigest: null }) })));
  assert.match(never, /Запусков ещё не было/u);
  assert.match(never, /Поручить первую задачу/u);
  assert.equal((never.match(/data-slot="stat-tile"/gu) ?? []).length, 0, "у не работавшего агента нет четырёх нулевых плиток");
  assert.doesNotMatch(page, /Что делает агент\s*<span/u, "на кнопке нет числа без единицы: вызовы за 30 дней названы в панели");
  assert.match(read("src/components/v3/ai-agents-next/NextOverviewSheets.tsx"), /Вызовы инструментов за 30 дней: \$\{total\}/u, "единица и период — в описании панели, а не на кнопке");
});

test("«Работа агента»: выключенный агент — одно предупреждение, а не по одному под каждым фактом; один факт занимает всю ширину", async () => {
  const { nextPage } = await views();
  const off = F.detail("director", { enabled: false, triggerWebsiteLead: true, triggerWhatsappInbound: true });
  const both = strip(nextPage(F.bodyProps("overview", { detail: off })));
  assert.equal((both.match(/Агент выключен — не запускается\./gu) ?? []).length, 1, "расписание и события, а предупреждение одно");
  assert.match(both, /Расписание[\s\S]*Реагирует на события[\s\S]*Агент выключен — не запускается\./u, "одна строка под обоими фактами");
  assert.match(both, /<dl class="grid gap-x-4 gap-y-3 grid-cols-1 @md:grid-cols-2"/u, "два факта — по половине от 28rem блока, на телефоне столбцом");
  const single = strip(nextPage(F.bodyProps("overview", { detail: F.detail("director", { enabled: false }) })));
  assert.equal((single.match(/Агент выключен — не запускается\./gu) ?? []).length, 1);
  assert.match(single, /<dl class="grid gap-x-4 gap-y-3 grid-cols-1"/u, "один факт (расписание) — на всю ширину, а не в половине");
  const nothing = strip(nextPage(F.bodyProps("overview", { detail: F.detail("director", { enabled: false, scheduleCron: null }) })));
  assert.doesNotMatch(nothing, /Агент выключен — не запускается\./u, "нечего не запускать — предупреждения нет");
  assert.doesNotMatch(strip(nextPage(F.bodyProps("overview"))), /Агент выключен/u, "включённый — без предупреждения");
});

test("«История работы»: таблица запусков, строка открывает панель; карточки телефона; «Показать ещё» — прежним адресом", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("runs", { runs: F.available({ runs: F.RUNS_MANY, hasMore: true }) })));
  assert.match(page, /data-slot="data-table"/u);
  assert.match(page, /role="region"[^>]*aria-label="История работы агента"/u);
  assert.match(page, /Подготовь недельный отчёт за прошлую неделю/u);
  assert.match(page, /Остановлен по лимиту/u);
  assert.match(page, /Дневной лимит на WhatsApp исчерпан/u, "причина остановки — словами, а не пустой итог");
  assert.match(page, /href="\/v3\/ai-agents\/director\?tab=runs&amp;limit=60"/u, "тот же шаг чтения, что раньше");
  assert.match(page, /data-slot="data-table-cards"/u, "карточки для телефона рядом с таблицей");
  // Сервер отдал «последние 30 и есть ещё»: один листатель, без «1–25 из 30», поиск назван поиском среди показанных.
  assert.equal((page.match(/<tbody[\s\S]*?<\/tbody>/u)[0].match(/<tr/gu) ?? []).length, 30, "все загруженные запуски — без страниц таблицы");
  assert.doesNotMatch(page, /data-slot="data-table-pagination"|\d+–\d+ из \d+/u, "общего числа и второго листателя нет");
  assert.match(page, /data-testid="v3-aia-runs-more"[\s\S]*Показать ещё[\s\S]*Показаны последние 30 запусков/u);
  assert.match(page, /placeholder="Поиск среди показанных"/u);
  const whole = strip(nextPage(F.bodyProps("runs")));
  assert.doesNotMatch(whole, /Показать ещё|Показаны последние|data-testid="v3-aia-runs-more"/u, "загружено всё — ни кнопки, ни оговорки");
  assert.match(whole, /placeholder="Поиск по поручениям"/u);
  const capped = strip(nextPage(F.bodyProps("runs", { runsLimit: 120, runs: F.available({ runs: F.RUNS_MANY, hasMore: true }) })));
  assert.doesNotMatch(capped, /Показать ещё/u, "потолок чтения — кнопки нет");
  assert.match(capped, /Показаны последние 30 запусков/u, "а оговорка остаётся: показано не всё");
  const empty = strip(nextPage(F.bodyProps("runs", { runs: F.available({ runs: [], hasMore: false }) })));
  assert.match(empty, /Запусков ещё не было/u);
  assert.match(empty, /href="\/v3\/ai-agents\/director"[^>]*>Поручить/u);
});

test("запуск целиком: карточка, действия таблицей (ошибка первой), черновики запуска, переписка по кнопке; нет такого запуска — слова", async () => {
  const { nextPage } = await views();
  const props = F.bodyProps("runs", { runId: F.RUN_DETAIL.run.id, run: F.available(F.RUN_DETAIL), runs: null });
  const page = strip(nextPage(props));
  assert.match(page, /data-testid="v3-aia-run-detail"/u);
  assert.match(page, /1 действие не выполнено/u, "«Готово» при ошибках говорит об этом");
  const firstRow = page.match(/<tbody[^>]*>\s*<tr[^>]*>([\s\S]*?)<\/tr>/u)?.[1] ?? "";
  assert.match(firstRow, /ошибка · лимит запросов/u, "неудавшееся действие — первым");
  assert.match(page, /Черновики этого запуска/u);
  assert.match(page, /Показать переписку/u);
  assert.match(page, /Технические данные/u);
  assert.doesNotMatch(page, /Читается у Claude, в CRM не хранится\./u, "пояснение — за «?»");
  assert.match(strip(nextPage(F.bodyProps("runs", { runId: "11111111-1111-4111-8111-000000000077", run: { status: "missing" }, runs: null }))), /data-testid="v3-aia-run-missing"[\s\S]*Такого запуска нет\./u);
  assert.match(strip(nextPage(F.bodyProps("runs", { runs: { status: "unavailable" } }))), /Не удалось загрузить запуски\./u);
  assert.match(strip(nextPage(F.bodyProps("runs", { runs: { status: "not_ready" } }))), /Раздел готовится/u);
});

test("«На одобрение»: ряд «Ждут решения · Все», таблица, строка открывает панель; не имеющему права — слова", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("drafts")));
  assert.match(page, /Ждут решения<span[^>]*>3<\/span>/u);
  assert.match(page, /Все<span[^>]*>5<\/span>/u);
  assert.match(page, /WhatsApp · Клиент Синтетический 1/u);
  assert.match(page, /Кабинет студента · Клиент Синтетический 3/u);
  assert.doesNotMatch(page, /data-testid="v3-aia-draft"/u, "карточка черновика — в панели, не в списке");
  assert.doesNotMatch(page, /data-testid="v3-aia-drafts-readonly"/u);
  assert.match(strip(nextPage(F.bodyProps("drafts", { canManage: false }))), /data-testid="v3-aia-drafts-readonly"[\s\S]*Решает сотрудник с правом управлять ИИ-агентами\./u);
  // Риск виден в строке, не открывая её: здоровый черновик — слово «Ждёт решения», без строк; остался в очереди — с причиной; срок близок — с «действует до».
  const rows = page.match(/<tbody[\s\S]*?<\/tbody>/u)[0].match(/<tr[\s\S]*?<\/tr>/gu);
  assert.equal(rows.length, 3, "под «Ждут решения» — только ждущие, как отдаёт сервер");
  assert.doesNotMatch(rows[0], /Остаётся в очереди|действует до/u);
  assert.match(rows[1], /data-testid="v3-aia-draft-note"[^>]*>Остаётся в очереди: WhatsApp сейчас не подключён/u);
  assert.match(rows[2], /data-testid="v3-aia-draft-expires"[^>]*>действует до /u);
  assert.match(page, /placeholder="Поиск по черновикам"/u);
  assert.doesNotMatch(page, /data-slot="data-table-pagination"|\d+–\d+ из \d+|v3-aia-drafts-capped/u, "список ограничен сервером: ни «из N», ни второго листателя");
  assert.match(page.match(/<ul class="grid grid-cols-1 gap-2 md:hidden"[\s\S]*?<\/ul>/u)[0], /line-clamp-2 break-words t-meta text-fg-3 md:hidden">Здравствуйте!/u, "на телефоне ответ агента — вторая строка заголовка карточки");
  const all = strip(nextPage(F.bodyProps("drafts", { draftsFilter: "all" })));
  assert.match(all, /Отправлен<\/span>/u, "вкладка «Все» показывает и решённые");
  // Сервер отдаёт последние 50: когда в очереди больше, экран так и говорит и не называет 50 общим числом.
  const big = { drafts: F.DRAFTS.drafts, counts: { ...F.DRAFTS.counts, pending: 140 } };
  const capped = strip(nextPage(F.bodyProps("drafts", { drafts: F.available(big) })));
  assert.match(capped, /data-testid="v3-aia-drafts-capped"[^>]*>Показаны последние 3 из 140/u);
  assert.match(capped, /placeholder="Поиск среди показанных"/u);
  assert.match(capped, /Ждут решения<span[^>]*>140<\/span>/u, "число на вкладке — настоящее");
  const none = strip(nextPage(F.bodyProps("drafts", { drafts: F.available({ drafts: [], counts: { pending: 0, approved: 0, sending: 0, sent: 0, discarded: 0, failed: 0, expired: 0 } }) })));
  assert.match(none, /Нет черновиков, которые ждут решения\./u);
  assert.doesNotMatch(none, /Ждут решения<span/u, "ряда нет, пока черновиков не было вообще");
});

test("«Правила агента» и «Настройки»: карточки набора; не администратор читает; пояснения за «?»", async () => {
  const { nextPage } = await views();
  const rules = strip(nextPage(F.bodyProps("instructions")));
  assert.match(rules, /Правила агента/u);
  assert.match(rules, /Стандартные правила EVO/u);
  assert.match(rules, /Общие правила EVO/u);
  assert.match(rules, /data-testid="v3-aia-instructions-text"/u);
  assert.doesNotMatch(rules, /<details/u);
  const readOnly = strip(nextPage(F.bodyProps("instructions", { canEdit: false })));
  assert.doesNotMatch(readOnly, /<textarea/u);
  assert.match(readOnly, /aria-label="Текст правил агента"/u);
  const settings = strip(nextPage(F.bodyProps("settings")));
  for (const title of ["Модель и расход", "Расписание и события", "Синхронизация с Claude"]) assert.match(settings, new RegExp(title, "u"), title);
  assert.equal((settings.match(/>Технические данные</gu) ?? []).length, 1, "одна кнопка «Технические данные»: ID агента правится в её панели, пустой карточки «Агент в Claude» нет");
  assert.doesNotMatch(settings, /<h[23][^>]*>Агент в Claude</u);
  assert.match(settings, /Сохранить настройки/u);
  assert.match(settings, /Лимит на WhatsApp/u, "дневной лимит остаётся на виду");
  assert.doesNotMatch(settings, /0 — без потолка\./u, "пояснение к потолку — за «?»");
  assert.doesNotMatch(settings, /ID агента в Claude/u, "технический ID — за кнопкой «Технические данные»");
  const read = strip(nextPage(F.bodyProps("settings", { canEdit: false })));
  assert.match(read, /data-testid="v3-aia-settings-read"/u);
  assert.match(read, /Параметры агента/u);
  assert.doesNotMatch(read, /Параметры меняет системный администратор\./u, "пояснение — за «?»");
  assert.doesNotMatch(read, /data-testid="v3-aia-settings-save"/u);
});

test("«Своё расписание (cron)»: кнопка открывает поле, а когда расписание уже своё — поле стоит всегда и мёртвой кнопки нет", async () => {
  const { nextPage } = await views();
  const normal = strip(nextPage(F.bodyProps("settings")));
  assert.match(normal, /aria-expanded="false"[^>]*>Своё расписание \(cron\)/u, "обычное расписание: кнопка есть и поле закрыто");
  assert.doesNotMatch(normal, /id="aia-cron"/u);
  const custom = strip(nextPage(F.bodyProps("settings", { detail: F.detail("director", { scheduleCron: "5 4 1 * *" }) })));
  assert.match(custom, /id="aia-cron"/u, "своё расписание: поле на месте");
  assert.doesNotMatch(custom, /Своё расписание \(cron\)/u, "кнопка, которая ничего не сворачивает, не рисуется");
});

test("панель запуска: у поручения нет подписи «Поручение» под заголовком «Поручение»; поручение и итог одного размера", async () => {
  const { runSheet } = await views();
  const props = { agentKey: "director", viewerName: F.ACTOR.displayName, canAct: true, canStopAny: true, canRun: true };
  const command = strip(runSheet({ ...props, run: F.RUNS[0] }));
  assert.doesNotMatch(command, /<h3[^>]*>Поручение<\/h3>/u, "для поручения подпись лишняя: заголовок панели уже «Поручение»");
  assert.match(command, /<p class="[^"]*t-body text-fg">Подготовь недельный отчёт/u, "поручение — тем же кеглем, что итог агента");
  assert.doesNotMatch(command, /t-body-compact text-fg">Подготовь/u);
  const scheduled = strip(runSheet({ ...props, run: F.RUNS[1] }));
  assert.match(scheduled, /<h3[^>]*>Поручение<\/h3>/u, "у запуска не по поручению заголовок панели другой, подпись остаётся");
});

test("карточка черновика в панели: без рамки и повторного заголовка, состояние и ссылка на переписку остаются; прежний вид не изменился", async () => {
  const { draftCard } = await views();
  const CONVERSATION = "11111111-1111-4111-8111-0000000000c2";
  const draft = { ...F.DRAFTS_ALL.drafts[1], conversationId: CONVERSATION };
  const props = { draft, canManage: true, now: F.NOW };
  const legacy = strip(draftCard(props));
  const bare = strip(draftCard({ ...props, bare: true }));
  assert.match(legacy, /<article class="rounded-card border border-border bg-surface p-4"/u, "прежняя карточка — как была");
  assert.match(legacy, /<h3 id="aia-draft-dr-2"[^>]*>WhatsApp · <a[^>]*>Клиент Синтетический 2<\/a><\/h3>/u);
  assert.doesNotMatch(bare, /<article class=|<h3|Клиент Синтетический 2<\/a>/u, "ни рамки, ни заголовка с адресатом: он в заголовке панели");
  assert.match(bare, /Ждёт решения/u, "слово состояния остаётся");
  assert.match(bare, new RegExp(`href="/v3/inbox\\?conversation=${CONVERSATION}"[^>]*>Открыть чат`, "u"), "переписка по-прежнему в один шаг");
  assert.match(bare, /Остаётся в очереди: WhatsApp сейчас не подключён/u, "причина — до того, как одобрять");
  assert.match(bare, /Подключите WhatsApp/u);
  assert.match(strip(draftCard({ ...props, bare: true, draft: F.DRAFTS_ALL.drafts[2] })), /действует до /u, "близкий срок остаётся в панели");
  assert.match(bare, /data-testid="v3-aia-approve"/u, "решение — теми же кнопками");
});

test("рамка страницы агента — `PageShell` набора со слотом `back`; ключевые утилиты переключателя запертого вида в наборе", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("overview")));
  assert.match(page, /<main data-testid="v3-ai-agent-page" class="mx-auto w-full px-4 py-8 sm:px-6 max-w-\[1240px\]"><a[^>]*href="\/v3\/ai-agents"[^>]*>[\s\S]*Все ИИ-агенты<\/a><div data-slot="page-header"/u, "возврат стоит над шапкой в той же рамке, что хаб");
  assert.match(read("src/components/v3/ai-agents-next/NextAgentPage.tsx"), /<PageShell[^>]*back=\{<NextBackLink \/>\}/u);
  assert.match(read("src/components/v3/ai-agents-next/NextAgentUnavailable.tsx"), /<PageShell[^>]*back=\{<NextBackLink \/>\}/u);
  assert.doesNotMatch(read("src/components/v3/ai-agents-next/NextAgentPage.tsx") + read("src/components/v3/ai-agents-next/NextAgentUnavailable.tsx"), /<main\b/u, "своей рамки <main> у страниц нет");
  const sw = read("src/components/ui/switch.tsx");
  for (const cls of ["aria-disabled:cursor-not-allowed", "aria-disabled:border-border", "aria-disabled:bg-surface-2", "aria-disabled:data-checked:bg-fg-3"]) assert.ok(sw.includes(cls), `переключатель с aria-disabled выглядит запертым: ${cls}`);
});

test("«Чат»: прежний `CommandWorkspace` без изменений в рамке набора; шапка в одну строку с «?», переключателями и «На весь экран»", async () => {
  const { nextPage } = await views();
  const chat = strip(nextPage(F.bodyProps("command")));
  assert.match(chat, /data-aia-workspace=""/u);
  assert.match(chat, /data-testid="v3-aia-chat-header"/u);
  assert.match(chat, /aria-label="Все ИИ-агенты"/u);
  assert.match(chat, /data-aia-chat=""/u, "обёртка, на которую опираются правила v3.css");
  assert.equal((chat.match(/<h1/gu) ?? []).length, 1);
  assert.match(chat, /data-testid="v3-aia-conversations"/u);
  assert.match(chat, /data-testid="v3-aia-send"/u);
});

/* ------------------------------------------------------------------ переключатели и права */

test("«Включён» и «Авто»: заперты без правил, ведут к их написанию; не администратору — слова", async () => {
  const { switches } = await views();
  const locked = strip(switches({ agentKey: "curator-eu", enabled: false, autoSend: false, configVersion: 3, hasInstructions: false, canEdit: true }));
  assert.match(locked, /data-testid="v3-aia-switch-needs-instructions"[^>]*>Сначала напишите правила/u);
  assert.match(locked, /href="\/v3\/ai-agents\/curator-eu\?tab=instructions"/u);
  const free = strip(switches({ agentKey: "director", enabled: true, autoSend: true, configVersion: 3, hasInstructions: true, canEdit: true }));
  assert.doesNotMatch(free, /v3-aia-switch-needs-instructions/u);
  assert.match(free, /<button[^>]*id="aia-sw-auto-director"[^>]*>/u);
  assert.match(free.match(/<button[^>]*id="aia-sw-auto-director"[^>]*>/u)[0], /aria-checked="true"/u, "«Авто» включён");
  assert.match(free.match(/<button[^>]*id="aia-sw-enabled-director"[^>]*>/u)[0], /aria-checked="true"/u, "«Включён» включён");
  const readonly = strip(switches({ agentKey: "director", enabled: true, autoSend: true, configVersion: 3, hasInstructions: true, canEdit: false }));
  assert.doesNotMatch(readonly, /role="switch"/u);
  assert.match(readonly, /Включён/u);
  assert.match(readonly, /Авто: вкл/u);
});

/* ------------------------------------------------------------------ исходники */

test("исходники: каждый файл нового вида ≤150 строк, без обходов (сырой HTML, service-клиент), прежний каталог не тронут", () => {
  const dir = "src/components/v3/ai-agents-next";
  const files = readdirSync(root(dir));
  assert.ok(files.length >= 15, "виджеты разбиты по файлам");
  for (const file of files) {
    const text = read(`${dir}/${file}`);
    assert.ok(text.split("\n").length <= 150, `${file}: ${text.split("\n").length} строк`);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML/u, file);
    assert.doesNotMatch(text, /createPlatformSupabaseServiceClient|service_role|amocrm|kommo/iu, file);
    assert.doesNotMatch(text, /from "\.\.\//u, `${file}: прежние компоненты — по @/-адресу`);
    assert.doesNotMatch(text, /\bopacity-\d|\/\d{2}\b(?=[ "`])/u, `${file}: без прозрачности текста и фонов`);
    assert.doesNotMatch(text, /<button\b|<input\b|<select\b|<textarea\b/u, `${file}: формы и кнопки — примитивы набора, не сырые теги`);
  }
  // Прежний каталог содержит только файлы (его читает прежний тест на сырой HTML) — новые виджеты лежат рядом.
  for (const entry of readdirSync(root("src/components/v3/ai-agents"), { withFileTypes: true })) assert.equal(entry.isFile(), true, entry.name);
  const hubPage = read("src/app/(v3)/v3/ai-agents/page.tsx");
  const agentPage = read("src/app/(v3)/v3/ai-agents/[key]/page.tsx");
  for (const page of [hubPage, agentPage]) {
    assert.match(page, /isNextUi\(actor\)/u, "вид выбирает настоящий `isNextUi`");
    assert.match(page, /@\/lib\/ui-next"/u);
  }
  assert.match(agentPage, /<NextAgentPage \{\.\.\.bodyProps\} \/>/u, "новый вид получает те же свойства, что `AgentBody`");
  assert.match(agentPage, /<AgentBody \{\.\.\.bodyProps\} \/>/u);
  assert.match(agentPage, /if \(tab === "command"\) \{\s*return \(\s*<AgentChatShell/u, "прежняя рамка чата на месте");
});
