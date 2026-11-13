// «Новый вид» (решение владельца 27.10.2026), поток «ИИ-агенты»: хаб и страница агента из набора виджетов.
// Данные синтетические (tests/e2e/ai-agents-next-fixtures.cjs). Проверяется: настоящие страницы `/ai-agents` и
// `/ai-agents/[key]` (границы данных и прав подменены) рисуют новый вид каждой роли — переключателя вида нет (#1327);
// новый вид строится из набора и не теряет предупреждений;
// пояснения ушли за «?»; условия запуска те же, что у прежнего `AgentBody`. Живую вёрстку, фокус и доступность
// меряет tests/e2e/ai-agents-next-static-render.cjs.
//
//   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-next-ui.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { AI_AGENT_CATALOG } from "../src/lib/ai-agents/contract.ts";
import { AI_AGENT_PENDING_TEXT_MAX, aiAgentLastRun, pendingRowsOf } from "../src/lib/v3/ai-agents-view.ts";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const require = createRequire(import.meta.url);
const { makeFixtures, ACTOR } = require("./e2e/ai-agents-next-fixtures.cjs");
const { assertFlightProps } = require("./e2e/flight-props.cjs");
const F = makeFixtures(AI_AGENT_CATALOG);

/* ------------------------------------------------------------------ сборка страниц */

const FIXTURES_PATH = root("tests/e2e/ai-agents-next-fixtures.cjs");
const LINK_SHIM = `const React = require("react");
function Link(props) { const { href, prefetch, scroll, replace, children, ...rest } = props; return React.createElement("a", { ...rest, href: String(href) }, children); }
module.exports = Link; module.exports.default = Link; module.exports.__esModule = true;`;
const ACTION_STUB = `const f = async () => ({ status: "idle", code: null, message: null, requestId: null });
module.exports = { updateAiAgentAction: f, saveAiAgentInstructionsAction: f, syncAiAgentAction: f, startAiAgentRunAction: f, followUpAiAgentRunAction: f,
  pollAiAgentRunAction: async () => ({ ok: false, code: "unavailable" }), interruptAiAgentRunAction: f, loadAiAgentRunTranscriptAction: async () => ({ ok: false, code: "unavailable" }), decideAiAgentDraftAction: f };`;
/** Границы данных и прав страниц: чтения возвращают синтетические данные, сверка и базы нет.  */
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
export const readAiAgents = async () => globalThis.__world.list ?? F.available(F.LIST);
export const readAiAgent = async (_actor, key) => F.available(F.detail(key));
export const readAiAgentDigests = async () => F.available({ digests: F.DIGESTS });
export const readAiAgentRuns = async () => F.available({ runs: F.RUNS, hasMore: false });
export const readAiAgentRun = async () => F.available(F.RUN_DETAIL);
export const readAiAgentDrafts = async () => F.available(F.DRAFTS);
// Чтение «Ждут решения» записывает свои вызовы (globalThis.__pendingCalls) и отдаёт то, что отдаёт сервер: строки без лишних полей.
export const readAiAgentsPending = async (...args) => { (globalThis.__pendingCalls ??= []).push(args); return globalThis.__world.pending ?? F.PENDING; };`,
  "next/navigation": `export function notFound() { throw new Error("NEXT_NOT_FOUND"); }`,
};

const ENTRY = `
import { renderToStaticMarkup } from "react-dom/server";
import HubPage from "@/app/(staff)/ai-agents/page";
import AgentPage from "@/app/(staff)/ai-agents/[key]/page";
import { AgentBody } from "@/components/staff/ai-agents/AgentBody";
import { NextAgentPage } from "@/components/staff/ai-agents-next/NextAgentPage";
import { NextAgentsView } from "@/components/staff/ai-agents-next/NextAgentsView";
import { NextAgentSwitches } from "@/components/staff/ai-agents-next/NextAgentSwitches";
import { NextOverview } from "@/components/staff/ai-agents-next/NextOverview";
import { NextSettings } from "@/components/staff/ai-agents-next/NextSettings";
import { NextRunSheetBody } from "@/components/staff/ai-agents-next/NextRunSheet";
import { DraftCard } from "@/components/staff/ai-agents/DraftCard";
import { agentGate as realAgentGate } from "@/components/staff/ai-agents-next/agent-gate";
import { nextAgentDefaults, nextAgentsHasDefault } from "@/lib/server/ai-agents/next-defaults";
// Новый вид страницы подгружают лениво (\`NextAgentsViewLazy\`, \`NextAgentPageLazy\`): модуль приходит асинхронно, поэтому рисуем, пока
// разметка не устоится (две отдачи подряд совпали); у прежнего вида это те же две отдачи.
const settle = async (render) => {
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let markup = null;
    try { markup = render(); } catch (error) { if (!/suspended while responding to synchronous input/u.test(String(error?.message))) throw error; }
    if (markup !== null && markup === previous) return markup;
    previous = markup;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("разметка не устоялась");
};
export const html = {
  hubPage: async (world) => { globalThis.__world = world; const element = await HubPage(); return settle(() => renderToStaticMarkup(element)); },
  hubElement: async (world) => { globalThis.__world = world; return HubPage(); },
  agentPage: async (world, key, search = {}) => { globalThis.__world = world; const element = await AgentPage({ params: Promise.resolve({ key }), searchParams: Promise.resolve(search) }); return settle(() => renderToStaticMarkup(element)); },
  agentElement: async (world, key, search = {}) => { globalThis.__world = world; return AgentPage({ params: Promise.resolve({ key }), searchParams: Promise.resolve(search) }); },
  legacyBody: (props) => renderToStaticMarkup(<AgentBody {...props} />),
  // Каталог текстов читает сервер (страница): новому виду он приходит готовым, как в страницах ai-agents.
  nextPage: (props) => renderToStaticMarkup(<NextAgentPage {...props} defaults={nextAgentDefaults(props.detail.key, props.tab)} />),
  nextHub: (read, runtimeConfigured, preview, pending = null) => renderToStaticMarkup(<NextAgentsView read={read} pending={pending} runtimeConfigured={runtimeConfigured} preview={preview} hasDefault={nextAgentsHasDefault()} />),
  switches: (props) => renderToStaticMarkup(<NextAgentSwitches {...props} />),
  overview: (props) => renderToStaticMarkup(<NextOverview {...props} />),
  settings: (props) => renderToStaticMarkup(<NextSettings {...props} />),
  runSheet: (props) => renderToStaticMarkup(<NextRunSheetBody {...props} />),
  draftCard: (props) => renderToStaticMarkup(<DraftCard {...props} />),
  agentGate: (input) => realAgentGate({ defaultHasInstructions: nextAgentsHasDefault()[input.detail.key], ...input }),
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
          // Вне сборки Next `next/dynamic` — версия для pages router (рисует пустоту); сборка берёт версию для App Router, её берём и мы.
          b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: root("node_modules/next/dist/shared/lib/app-dynamic.js") }));
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "link" }));
          b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ contents: LINK_SHIM, resolveDir: base, loader: "js" }));
          b.onResolve({ filter: /^@\/lib\/platform-ai-agents-actions$/ }, () => ({ path: "actions-stub", namespace: "actions" }));
          b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: ACTION_STUB, loader: "js" }));
          b.onResolve({ filter: /^(@\/lib\/platform-guards|@\/lib\/supabase\/server|@\/lib\/server\/ai-agents\/config-hash|@\/lib\/server\/ai-agents\/runtime|@\/lib\/v3\/ai-agents-source|next\/headers|next\/navigation)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], resolveDir: base, loader: "ts" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
          // Маскоты агентов — статический импорт картинок, как в сборке Next: путь, ширина, высота.
          b.onLoad({ filter: /\.webp$/ }, (args) => ({ contents: `export default { src: ${JSON.stringify(`/_next/static/media/${args.path.split("/").pop()}`)}, width: 160, height: 160 };`, loader: "js" }));
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

/* ------------------------------------------------------------------ новый вид — единственный */

test("хаб: новый вид у каждой роли — администратор с cookie и без, сотрудник, просмотр роли (#1327)", async () => {
  const { hubPage, hubElement } = await views();
  const on = strip(await hubPage(world(ADMIN, "next")));
  // Свойства, которые страница отдаёт ленивому входу, проходят границу сервер → клиент: данные, не функции и не объекты классов.
  assertFlightProps((await hubElement(world(ADMIN, "next"))).props, "NextAgentsViewLazy");
  assert.match(on, /data-testid="v3-aia-now"/u, "11.11.2026, образец Molar AI: первая карточка — «Сейчас»");
  assert.match(on, /data-testid="v3-aia-hub"/u);
  for (const [index, markup] of [
    strip(await hubPage(world(ADMIN, undefined))),
    strip(await hubPage(world(STAFF, "next"))),
    strip(await hubPage(world(STAFF, undefined))),
    strip(await hubPage(world(PREVIEW, "next"))),
  ].entries()) {
    assert.match(markup, /data-testid="v3-aia-summary"/u, `итоги за 7 дней у каждой роли (${index})`);
    assert.match(markup, /data-testid="v3-aia-hub"/u);
  }
});

test("страница агента: на каждой вкладке новый вид у каждой роли (#1327); менять может только администратор, остальные — только просмотр", async () => {
  const { agentPage, agentElement } = await views();
  for (const [search, marker] of [
    [{ tab: "overview" }, "v3-aia-overview"], [{ tab: "runs" }, "v3-aia-runs"], [{ tab: "drafts" }, "v3-aia-drafts"],
    [{ tab: "instructions" }, "v3-aia-instructions"], [{ tab: "settings" }, "v3-aia-settings"], [{}, "v3-aia-workspace"],
  ]) {
    const on = strip(await agentPage(world(ADMIN, "next"), "director", search));
    assertFlightProps((await agentElement(world(ADMIN, "next"), "director", search)).props, `NextAgentPageLazy ${JSON.stringify(search)}`);
    assert.match(on, new RegExp(`data-testid="${marker}`, "u"), `${JSON.stringify(search)}: вкладка на месте`);
    assert.match(on, /data-slot="(?:card|switch|button)"/u, `${JSON.stringify(search)}: виджеты набора`);
    assert.match(on, /data-testid="v3-aia-switch-enabled"/u, `${JSON.stringify(search)}: администратор — настоящий переключатель`);
    for (const [label, world_] of [["сотрудник", world(STAFF, "next")], ["сотрудник без cookie", world(STAFF, undefined)], ["просмотр роли", world(PREVIEW, "next")]]) {
      const other = strip(await agentPage(world_, "director", search));
      assert.match(other, new RegExp(`data-testid="${marker}`, "u"), `${JSON.stringify(search)}: ${label}: вкладка на месте`);
      assert.match(other, /data-slot="(?:card|switch|button)"/u, `${JSON.stringify(search)}: ${label}: новый вид`);
      // Переключатели «Включён» и «Авто» меняет только настоящий администратор: остальные видят их только для чтения.
      assert.match(other, /data-testid="v3-aia-switch-enabled-readonly"/u, `${JSON.stringify(search)}: ${label}: «Включён» — только просмотр`);
      assert.doesNotMatch(other, /data-testid="v3-aia-switch-enabled"/u, `${JSON.stringify(search)}: ${label}: переключателя нет`);
    }
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

test("хаб по образцу Molar AI: «Сейчас» с итогами, без ленты и «Спросить агента», список агентов по трём группам со ссылками и «?», «Правила» у агентов без правил, Gemini; пояснения за «?»", async () => {
  const { nextHub } = await views();
  const next = strip(nextHub(F.available(F.LIST), true, false));
  assert.doesNotMatch(next, /data-slot="stat-tile"/u, "11.11.2026: крупных плиток нет, итоги — в карточке «Сейчас»");
  assert.match(next, /data-testid="v3-aia-now"/u);
  for (const label of ["Запусков за 7 дней", "Без ошибок", "Расход за 7 дней"]) assert.match(next, new RegExp(label, "u"));
  for (const gone of ["Включено агентов", "Действий", "инструментов за 7 дней"]) assert.doesNotMatch(next, new RegExp(gone, "u"), `11.11.2026: «${gone}» — второй ряд чисел убран, экран был перегружен`);
  // Отзыв владельца к #1449 (12.11.2026): ленты «Что сделали агенты» и отдельного «Спросить агента» на главной нет.
  for (const gone of ["Что сделали агенты", "Спросить агента", "data-testid=\"v3-aia-askbox\""]) assert.doesNotMatch(next, new RegExp(gone, "u"), `12.11.2026: «${gone}» убрано`);
  assert.doesNotMatch(next, /data-testid="v3-aia-pending-partial"/u);
  const asks = [...next.matchAll(/<a[^>]*data-testid="v3-aia-ask-[^"]+"[^>]*>/gu)].map((match) => match[0]);
  assert.ok(asks.length > 0, "у готового агента в строке есть «Поручить»");
  for (const ask of asks) assert.match(ask, /href="\/ai-agents\/[a-z-]+"/u, "«Поручить» сразу ведёт в чат агента (вкладка по умолчанию)");
  for (const group of ["sales", "analytics", "curators"]) assert.match(next, new RegExp(`data-testid="v3-aia-group-${group}"`, "u"));
  for (const key of ["director", "sales", "curator-cn", "curator-my", "curator-eu", "curator-ae", "curator-tr"]) assert.match(next, new RegExp(`data-testid="v3-aia-card-${key}"`, "u"), key);
  assert.match(next, /href="\/ai-agents\/director\?tab=drafts"/u, "очередь черновиков — ссылкой с карточки");
  assert.match(next, /href="\/ai-agents\/sales"/u);
  assert.match(next, /data-testid="v3-aia-rules-curator-eu"[^>]*>Правила</u, "агент без правил — в своей группе со ссылкой «Правила» вместо ряда «Не настроены»");
  assert.match(next, /aria-label="Пояснение: Директор \/ Аналитик"/u, "роль агента — за «?»");
  // Режем: пояснения и украшения не на экране.
  for (const gone of ["Считает продажи, воронку и поступление", "Подсказывает ответ, сам ничего не отправляет.", "Запуски, 14 дней", "data-testid=\"v3-aia-sparkline\""]) {
    assert.doesNotMatch(next, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `новый вид: «${gone}» убрано с экрана`);
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

/* ------------------------------------------------------------------ хаб: исправления по независимому ревью #1449–#1451 (14.11.2026) */

const textOf = (markup) => markup.replace(/<[^>]*>/gu, " ").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
const cardOf = (markup, key) => markup.match(new RegExp(`<li data-testid="v3-aia-card-${key}"[\\s\\S]*?</li>`, "u"))?.[0] ?? "";
const anchorOf = (markup, testid) => markup.match(new RegExp(`<a\\b[^>]*data-testid="${testid}"[^>]*>`, "u"))?.[0] ?? "";
const moreOf = (markup) => markup.match(/<div[^>]*data-testid="v3-aia-pending-more"[^>]*>([\s\S]*?)<\/div>/u)?.[1] ?? null;
/** Остаток черновиков называть по агентам нечем: у каждого агента показаны все его ждущие черновики. */
const NO_QUEUE_LEFT = F.listVariant({ sales: { stats: { draftsPending: 2 } }, director: { stats: { draftsPending: 1 } }, "curator-my": { stats: { draftsPending: 1 } } });

/** Картинки разметки и скрыты ли они от читалки: сами (`aria-hidden`) или предком. Разметка React вложена правильно, хватает стека тегов. */
function imagesOf(markup) {
  const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "wbr"]);
  const open = [];
  const found = [];
  for (const match of markup.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gu)) {
    const [, closing, name, attrs] = match;
    const tag = name.toLowerCase();
    if (closing) { const at = open.map((entry) => entry.tag).lastIndexOf(tag); if (at >= 0) open.length = at; continue; }
    const hidden = /\saria-hidden="true"/u.test(attrs);
    if (tag === "img") found.push({ alt: /\salt="([^"]*)"/u.exec(attrs)?.[1] ?? null, hidden: hidden || open.some((entry) => entry.hidden) });
    else if (!VOID.has(tag) && !attrs.endsWith("/")) open.push({ tag, hidden });
  }
  return found;
}

test("хаб, «Ждут решения»: строки с адресатом, «Ещё N» со ссылкой в очередь каждого агента, у кого остались черновики; без числа или без черновиков — без «Ещё»; сбой чтения — слово о неполном списке", async () => {
  const { nextHub } = await views();
  const hub = (pending, list = F.LIST) => strip(nextHub(F.available(list), true, false, pending));
  const on = hub(F.PENDING);
  const rows = on.match(/<ul[^>]*data-testid="v3-aia-pending">([\s\S]*?)<\/ul>/u)[1];
  assert.equal((rows.match(/<li>/gu) ?? []).length, 4, "четыре строки");
  assert.match(textOf(rows), /^Продажи \(Closer\) → Клиент Синтетический 1 Здравствуйте! Подтверждаю.*Директор \/ Аналитик → Клиент Синтетический 2 Отчёт за неделю.*Куратор Малайзия → Клиент Синтетический 3 Добрый день.*Продажи \(Closer\) → Клиент Синтетический 4 Спасибо за ответ/u, "адресат и текст на строку");
  assert.deepEqual([...rows.matchAll(/<a[^>]*href="([^"]+)"/gu)].map((link) => link[1]), ["/ai-agents/sales?tab=drafts", "/ai-agents/director?tab=drafts", "/ai-agents/curator-my?tab=drafts", "/ai-agents/sales?tab=drafts"], "строка ведёт в «На одобрение» своего агента");
  // 13 ждут, 4 показаны: «Продаж» осталось 7 − 2, у «Директора» и «Куратора Малайзии» по 3 − 1; больше всего — первым, ссылки ведут в очереди.
  const more = moreOf(on);
  assert.equal(textOf(more), "Ещё 9 черновиков: Продажи (Closer) · 5 Директор / Аналитик · 2 Куратор Малайзия · 2");
  assert.deepEqual([...more.matchAll(/<a[^>]*href="([^"]+)"/gu)].map((link) => link[1]), ["/ai-agents/sales?tab=drafts", "/ai-agents/director?tab=drafts", "/ai-agents/curator-my?tab=drafts"]);
  assert.match(more, /<a[^>]*class="[^"]*\bmin-h-11\b/u, "ссылка «Ещё» — цель не меньше 44 px");
  assert.match(textOf(moreOf(hub({ ...F.PENDING, total: 5 }))), /^Ещё 1 черновик:/u, "слово по числу: 1");
  assert.match(textOf(moreOf(hub({ ...F.PENDING, total: 6 }))), /^Ещё 2 черновика:/u, "слово по числу: 2");
  // Остаток есть, а назвать его по агентам нечем: одно слово без двоеточия и ссылок.
  const unnamed = moreOf(hub(F.PENDING, NO_QUEUE_LEFT));
  assert.equal(textOf(unnamed), "Ещё 9 черновиков");
  assert.doesNotMatch(unnamed, /<a /u);
  // Числа нет или показано всё: строки «Ещё» нет.
  assert.equal(moreOf(hub({ ...F.PENDING, total: null })), null, "числа нет — «Ещё» не придумываем");
  assert.equal(moreOf(hub({ ...F.PENDING, total: 4 })), null, "всё показано");
  // Черновиков нет или чтение не удалось.
  for (const pending of [null, { drafts: [], total: 0, partial: false }]) {
    const none = hub(pending);
    assert.doesNotMatch(none, /data-testid="v3-aia-pending"|Ждут решения/u, "блока нет");
    assert.doesNotMatch(none, /v3-aia-pending-partial/u);
  }
  const partial = hub({ drafts: [], total: null, partial: true });
  assert.match(partial, /data-testid="v3-aia-pending-partial"[^>]*>Черновики не загрузились — список «Ждут решения» может быть неполным\./u);
  assert.doesNotMatch(partial, /data-testid="v3-aia-pending">/u);
});

test("главная зовёт `readAiAgentsPending` с вошедшим сотрудником и `{ limit: 4 }`; список агентов недоступен — этого чтения нет; браузеру уходят только id, агент, текст и адресат", async () => {
  const { hubPage, hubElement } = await views();
  globalThis.__pendingCalls = [];
  await hubPage(world(ADMIN, "next"));
  assert.equal(globalThis.__pendingCalls.length, 1, "одно чтение на страницу");
  const [actor, options] = globalThis.__pendingCalls[0];
  assert.deepEqual(actor, ADMIN, "от имени вошедшего сотрудника");
  assert.deepEqual(options, { limit: 4 }, "четыре строки");
  for (const status of ["denied", "unavailable", "not_ready", "missing"]) {
    globalThis.__pendingCalls = [];
    await hubPage(world(ADMIN, "next", { list: { status } }));
    assert.deepEqual(globalThis.__pendingCalls, [], `список агентов «${status}»: черновики не читаются`);
  }
  const props = (await hubElement(world(ADMIN, "next"))).props;
  assert.deepEqual(props.pending, F.PENDING);
  assert.equal(props.pending.total, 13);
  for (const row of props.pending.drafts) assert.deepEqual(Object.keys(row).sort(), ["agentKey", "id", "targetLabel", "text"], "в строке нет ни входящего сообщения клиента, ни причины агента");
  const flight = JSON.stringify(props.pending);
  for (const secret of ["sourceMessage", "reason", "failureCode", "conversationId", "studentCaseId", "leadId"]) assert.equal(flight.includes(secret), false, secret);
});

test("`pendingRowsOf`: от черновика остаются id, агент, текст (правка сотрудника — вместо исходного, до 320 знаков) и адресат; «всего ждёт» — из счётчика, не из длины списка", () => {
  const rich = { ...F.DRAFTS_ALL.drafts[0], editedText: "Правка сотрудника", sourceMessage: { text: "Секретное сообщение клиента", at: F.NOW }, reason: "Причина агента", failureCode: "whatsapp_unavailable" };
  const plain = { ...F.DRAFTS_ALL.drafts[1], editedText: null };
  // Срез на границе пары суррогатов: 318 букв, смайлик (две единицы UTF-16) и хвост. По кодовым точкам смайлик остаётся целым.
  const long = { ...F.DRAFTS_ALL.drafts[2], editedText: null, text: `${"я".repeat(318)}😀${"x".repeat(5)}` };
  const { drafts, total } = pendingRowsOf({ drafts: [rich, plain, long], counts: { ...F.DRAFTS_ALL.counts, pending: 13 } });
  assert.deepEqual(drafts[0], { id: rich.id, agentKey: "sales", text: "Правка сотрудника", targetLabel: rich.targetLabel });
  assert.deepEqual(drafts[1], { id: plain.id, agentKey: "sales", text: plain.text, targetLabel: plain.targetLabel }, "короткий текст — как есть");
  assert.equal(drafts[2].text, `${"я".repeat(318)}😀…`);
  assert.equal(Array.from(drafts[2].text).length, AI_AGENT_PENDING_TEXT_MAX);
  assert.equal(/[\ud800-\udfff]/u.test(drafts[2].text), false, "обрезка не оставляет половину пары суррогатов");
  assert.equal(total, 13, "всего ждёт — счётчик чтения, строк в списке три");
  assert.equal(pendingRowsOf({ drafts: [rich, plain, long], counts: { ...F.DRAFTS_ALL.counts, pending: 1 } }).total, 3, "счётчик не бывает меньше показанных");
  assert.deepEqual(pendingRowsOf({ drafts: [], counts: { ...F.DRAFTS_ALL.counts, pending: 0 } }), { drafts: [], total: 0 });
});

test("хаб: «Правила» — только настоящему администратору (не сотруднику и не просмотру роли); Директору «Поручить» — только администратору; без ключа Claude «Поручить» нет ни у кого", async () => {
  const { nextHub } = await views();
  const hub = (list, configured = true, preview = false) => strip(nextHub(F.available(list), configured, preview));
  const staffList = { ...F.LIST, isAdmin: false, canManage: false };
  const admin = hub(F.LIST);
  for (const key of ["curator-eu", "curator-ae", "curator-tr"]) assert.match(admin, new RegExp(`data-testid="v3-aia-rules-${key}"`, "u"), `администратору — «Правила» у ${key}`);
  assert.match(admin, /data-testid="v3-aia-ask-director"/u, "Директору поручает администратор");
  const staff = hub(staffList);
  assert.doesNotMatch(staff, /data-testid="v3-aia-rules-/u, "сотруднику «Правила» не предлагаются");
  assert.doesNotMatch(staff, /data-testid="v3-aia-ask-director"/u, "Директору сотрудник не поручает");
  assert.match(staff, /data-testid="v3-aia-ask-sales"/u, "остальным агентам — поручает");
  assert.match(staff, /data-testid="v3-aia-card-director"/u, "карточка Директора на месте");
  const preview = hub(F.LIST, true, true);
  assert.doesNotMatch(preview, /data-testid="v3-aia-rules-|data-testid="v3-aia-ask-/u, "в просмотре роли ни «Правил», ни «Поручить»");
  for (const [label, list, previewing] of [["администратор", F.LIST, false], ["сотрудник", staffList, false], ["просмотр роли", F.LIST, true]]) {
    assert.doesNotMatch(hub(list, false, previewing), /data-testid="v3-aia-ask-/u, `ключ Claude не задан (${label}): «Поручить» нет ни у кого`);
  }
});

test("карточка агента в хабе: «Авто: вкл» словом у того, кто пишет сам, и слово итога последнего запуска («3 ч назад · Готово», ошибка — красным); у агента без правил времени и итога нет", async () => {
  const { nextHub } = await views();
  const hub = strip(nextHub(F.available(F.LIST), true, false));
  assert.match(cardOf(hub, "sales"), /<span class="v3-chip t-caption" data-tone="warn" data-size="sm" title="Агент сам пишет клиентам и студентам без одобрения">Авто: вкл<\/span>/u, "чип со словом и подсказкой, тон только подкрепляет");
  assert.equal((hub.match(/Авто: вкл/gu) ?? []).length, 1, "«Авто: вкл» — только у «Продаж» (autoSend); у остальных его нет, «Авто: выкл» не рисуется");
  assert.match(textOf(cardOf(hub, "director")), /Последний запуск: 3 ч назад · Готово/u, "время и итог словами; «Последний запуск» — для читалки");
  assert.match(cardOf(hub, "director"), /<span class="sr-only">Последний запуск: <\/span>3 ч назад/u);
  assert.match(cardOf(hub, "curator-cn"), /3 ч назад · <span class="font-medium text-danger">Ошибка<\/span>/u, "ошибка — словом, красным");
  for (const key of ["curator-eu", "curator-ae", "curator-tr"]) assert.doesNotMatch(cardOf(hub, key), /v3-aia-last-|назад|не запускался/u, `${key}: правил нет — нет и «когда работал»`);
  // Ссылки карточки — цели 44 px. «N черновиков ждут решения» берёт их в зазоре над собой и в поле под собой (отрицательные поля равны `gap-2` и `p-3`
  // тела карточки), поэтому карточка выше на 8 px, а не на 28.
  for (const testid of ["v3-aia-drafts-sales", "v3-aia-ask-sales", "v3-aia-rules-curator-eu"]) assert.match(anchorOf(hub, testid), /\bmin-h-11\b/u, `${testid}: цель не ниже 44 px`);
  assert.match(anchorOf(hub, "v3-aia-drafts-sales"), /-mb-3 -mt-2 inline-flex min-h-11/u);
  assert.match(cardOf(hub, "sales"), /<span class="grid flex-1 content-start gap-2 p-3">/u, "поля ссылки равны зазору и полю тела карточки");
  const never = strip(nextHub(F.available(F.listVariant({ "curator-my": { stats: { lastRunAt: null, lastRunStatus: null } } })), true, false));
  assert.match(textOf(cardOf(never, "curator-my")), /ещё не запускался/u);
  assert.doesNotMatch(cardOf(never, "curator-my"), /text-danger|text-warn/u);
});

test("`aiAgentLastRun`: время и слово итога из тех же подписей, что у «Истории работы»; красное слово — только ошибка, жёлтое — «нужно внимание» и лимит", () => {
  const NOW = F.NOW;
  const at = (status) => aiAgentLastRun({ lastRunAt: new Date(Date.parse(NOW) - 200 * 60_000).toISOString(), lastRunStatus: status }, NOW);
  assert.deepEqual(at("completed"), { when: "3 ч назад", result: "Готово", tone: "ok" });
  assert.deepEqual(at("failed"), { when: "3 ч назад", result: "Ошибка", tone: "danger" });
  assert.deepEqual(at("running"), { when: "3 ч назад", result: "Работает", tone: "info" });
  assert.deepEqual(at("budget_reached"), { when: "3 ч назад", result: "Остановлен по лимиту", tone: "warn" });
  assert.deepEqual(at("needs_attention"), { when: "3 ч назад", result: "Нужно внимание", tone: "warn" });
  assert.deepEqual(at("interrupted"), { when: "3 ч назад", result: "Прерван", tone: "neutral" });
  assert.deepEqual(at(null), { when: "3 ч назад", result: null, tone: "neutral" }, "итога нет — только время");
  assert.deepEqual(aiAgentLastRun({ lastRunAt: null, lastRunStatus: null }, NOW), { when: "ещё не запускался", result: null, tone: "neutral" });
});

test("полоса «Сейчас» говорит правду: «на связи» и «в работе» — при ключе Claude и включённом агенте; иначе «не подключены» или «выключены»; Директор без ссылки не администратору", async () => {
  const { nextHub, hubPage } = await views();
  const hub = (list, configured = true) => strip(nextHub(F.available(list), configured, false));
  const strip_ = (markup) => textOf(markup.match(/<section[^>]*data-testid="v3-aia-now"[\s\S]*?<\/section>/u)[0]);
  const idle = hub(F.LIST);
  assert.match(idle, /data-testid="v3-aia-now" data-mode="idle"/u);
  assert.match(strip_(idle), /^ИИ-агенты · на связи Сегодня 24 запуска, сейчас никто не занят Запусков за 7 дней 64 Без ошибок 78% Расход за 7 дней 17,90 \$$/u, "«Без ошибок» — общая `successShare`: (64 − 14) / 64");
  assert.doesNotMatch(idle, /aria-label="Кто работает"/u, "никто не работает — списка нет");
  const working = hub(F.LIST_RUNNING);
  assert.match(working, /data-mode="working"/u);
  assert.match(strip_(working), /^ИИ-агенты · в работе Выполняют 2 поручения прямо сейчас Директор \/ Аналитик Продажи \(Closer\) /u);
  assert.deepEqual([...working.match(/<ul[^>]*aria-label="Кто работает">([\s\S]*?)<\/ul>/u)[1].matchAll(/<a[^>]*href="([^"]+)"/gu)].map((link) => link[1]), ["/ai-agents/director?tab=runs", "/ai-agents/sales?tab=runs"], "администратор открывает «Историю работы» обоих");
  for (const link of working.match(/<ul[^>]*aria-label="Кто работает">([\s\S]*?)<\/ul>/u)[1].match(/<a [^>]*>/gu)) assert.match(link, /\bmin-h-11\b/u, "ссылка в полосе — цель 44 px");
  assert.match(working, /<ul class="-mb-3 -mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 t-meta" aria-label="Кто работает">/u, "ряд занимает зазор над собой и поле полосы под собой; имена без ссылок встают по центру ряда");
  // Не администратор: «История работы» Директора ему закрыта — имя без ссылки; остальные ссылки остаются.
  const staffWorking = strip(await hubPage(world(STAFF, "next", { list: F.available({ ...F.LIST_RUNNING, isAdmin: false, canManage: false }) })));
  const who = staffWorking.match(/<ul[^>]*aria-label="Кто работает">([\s\S]*?)<\/ul>/u)[1];
  assert.deepEqual([...who.matchAll(/<a[^>]*href="([^"]+)"/gu)].map((link) => link[1]), ["/ai-agents/sales?tab=runs"], "ссылка только у «Продаж»");
  assert.match(textOf(who), /^Директор \/ Аналитик Продажи \(Closer\)$/u, "Директор назван, но не ссылкой");
  assert.doesNotMatch(who, /director/u);
  // Нет ключа Claude: ни «на связи», ни «в работе», ни списка «Кто работает», даже если запуски числятся идущими.
  const noKey = hub(F.LIST_RUNNING, false);
  assert.match(noKey, /data-mode="key"/u);
  assert.match(strip_(noKey), /^ИИ-агенты · не подключены Запуски недоступны: не задан ключ Claude /u);
  assert.doesNotMatch(strip_(noKey), /на связи|в работе|прямо сейчас/u);
  assert.doesNotMatch(noKey, /aria-label="Кто работает"/u);
  assert.match(noKey, /data-testid="v3-aia-key-missing"/u, "плашка про ключ остаётся");
  // Ни один агент не включён.
  const off = hub(F.LIST_OFF);
  assert.match(off, /data-mode="off"/u);
  assert.match(strip_(off), /^ИИ-агенты · выключены Ни один агент не включён /u);
  assert.doesNotMatch(strip_(off), /на связи|в работе/u);
  // Доля без ошибок — общая `successShare`, а не своя копия: пока запусков нет, число — «—».
  assert.match(strip_(hub({ ...F.LIST, summary: { ...F.LIST.summary, runs7d: 0 } })), /Без ошибок — /u);
});

test("хаб: заголовки групп на виду (не `sr-only`), группа из одного агента — одна колонка рядом с такой же, длинная — на всю ширину; сетка 2 / 3 / 5 колонок, та же в заготовке загрузки", async () => {
  const { nextHub } = await views();
  const hub = strip(nextHub(F.available(F.LIST), true, false));
  for (const [group, label] of [["sales", "Продажи"], ["analytics", "Аналитика"], ["curators", "Кураторы"]]) {
    const heading = hub.match(new RegExp(`<h3 id="aia-group-${group}" class="([^"]*)">${label}</h3>`, "u"));
    assert.ok(heading, `заголовок «${label}» на месте`);
    assert.doesNotMatch(heading[1], /sr-only/u, `заголовок «${label}» виден глазами, а не только читалке`);
  }
  assert.match(hub, /<section aria-labelledby="aia-group-sales" data-testid="v3-aia-group-sales" class="grid content-start gap-2">/u, "«Продажи» — одна колонка");
  assert.match(hub, /<section aria-labelledby="aia-group-analytics" data-testid="v3-aia-group-analytics" class="grid content-start gap-2">/u, "«Аналитика» — одна колонка рядом с «Продажами»");
  assert.match(hub, /<section aria-labelledby="aia-group-curators" data-testid="v3-aia-group-curators" class="col-span-full grid gap-2">/u, "«Кураторы» — на всю ширину");
  const COLUMNS = "grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5";
  assert.equal(hub.split(COLUMNS).length - 1, 2, "внешняя сетка и сетка кураторов — одни колонки: карточки везде одной ширины");
  assert.doesNotMatch(hub, /@3xl:grid-cols-3 @5xl:grid-cols-4/u, "четыре колонки оставляли на ноутбуке последнюю карточку одну в ряду");
  const loading = read("src/app/(staff)/ai-agents/loading.tsx");
  for (const column of COLUMNS.split(" ")) assert.ok(loading.includes(column), `заготовка загрузки — та же сетка (${column})`);
  assert.doesNotMatch(loading, /@4xl:grid-cols-4/u, "четырёх плиток в заготовке больше нет");
});

test("кольцо фокуса в тёмной полосе «Сейчас» белое: общее графитовое было 1,09:1 на её фоне, нужно не меньше 3:1", () => {
  const css = read("src/app/(staff)/ai-agents.css");
  const staff = read("src/app/(staff)/staff.css");
  const channel = (hex) => { const value = parseInt(hex.slice(1), 16); return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((part) => { const c = part / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); };
  const luminance = (hex) => { const [r, g, b] = channel(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
  const ink = css.match(/--aia-hero-ink: (#[0-9a-f]{6});/u)[1];
  const hero = css.match(/\.v3-world \.v3-aia-hero \{[\s\S]*?\n\}/u)[0];
  const base = [...hero.matchAll(/#[0-9a-f]{6}\b/gu)].map((match) => match[0]).at(-1);
  const generalRing = staff.match(/\.v3-world\[data-surface="staff"\] \{\n {2}--bg: #f3f1ec;[\s\S]*?--focus-ring: (#[0-9a-f]{6});/u)[1];
  assert.equal(base, "#17181c", "основа полосы — графит");
  assert.equal(generalRing, "#202020", "общее кольцо staff CRM — графитовое");
  assert.ok(contrast(generalRing, base) < 1.2, `общее кольцо ${generalRing} на графите полосы невидимо (${contrast(generalRing, base).toFixed(2)}:1)`);
  assert.match(css, /\.v3-world \.v3-aia-hero :focus-visible \{\n {2}outline-color: var\(--aia-hero-ink\);\n\}/u, "внутри полосы кольцо — цвет её текста");
  assert.ok(contrast(ink, base) >= 3, `белое кольцо на графите: ${contrast(ink, base).toFixed(1)}:1`);
});

test("«Обзор» и «История работы» после #1451: «нет», а не «0»; «идёт»; «Итог будет, когда агент закончит» и «Без итога»; пустой «Расход по дням» не рисуется", async () => {
  const { nextPage } = await views();
  // «Ждут решения»: нет черновиков — слово «нет» и не ссылка; есть — число и ссылка в очередь.
  const none = strip(nextPage(F.bodyProps("overview", { detail: F.detail("director", { stats: F.stats({ draftsPending: 0 }) }) })));
  assert.match(none, /Ждут решения<\/p><p class="t-figure px-4 text-fg">нет<\/p>/u, "«нет», а не «0»");
  assert.doesNotMatch(none, /Ждут решения<\/p><p class="t-figure px-4 text-fg">0</u);
  assert.doesNotMatch(none, /data-slot="stat-tile"[^>]*href="\/ai-agents\/director\?tab=drafts"/u, "без черновиков плитка — не ссылка");
  assert.match(strip(nextPage(F.bodyProps("overview"))), /<a[^>]*data-slot="stat-tile"[^>]*href="\/ai-agents\/director\?tab=drafts"[^>]*>[\s\S]*?Ждут решения<\/p><p class="t-figure px-4 text-fg">3<\/p>/u, "с черновиками — число и ссылка");
  // Расход по дням: не было расхода за 30 дней — карточки нет, график запусков на всю ширину; был — два графика рядом.
  const base = F.detail("director");
  const noSpend = strip(nextPage(F.bodyProps("overview", { detail: { ...base, charts: { ...base.charts, spendPerDay: base.charts.spendPerDay.map((point) => ({ ...point, costCents: 0 })) } } })));
  assert.doesNotMatch(noSpend, /Расход по дням/u, "пустая карточка не рисуется");
  assert.match(noSpend, /Запуски по дням/u);
  const parentOfRuns = (markup) => { const before = markup.slice(0, markup.indexOf("Запуски по дням")); return before.slice(before.lastIndexOf('<div class="grid gap-4')).match(/^<div class="[^"]*"/u)[0]; };
  assert.equal(parentOfRuns(noSpend), '<div class="grid gap-4"', "один график — на всю ширину");
  assert.equal(parentOfRuns(strip(nextPage(F.bodyProps("overview")))), '<div class="grid gap-4 @4xl:grid-cols-2"', "с расходом — два графика рядом");
  assert.match(strip(nextPage(F.bodyProps("overview"))), /Расход по дням/u);
  // «История работы»: идущий запуск — «идёт» и «Итог будет…»; законченный без слов — «Без итога».
  const running = { ...F.RUNS[7], promptPreview: null, summary: null };
  const finished = { ...F.RUNS[0], id: "11111111-1111-4111-8111-0000000000f1", promptPreview: null, summary: null, durationSeconds: null };
  const page = strip(nextPage(F.bodyProps("runs", { runs: F.available({ runs: [running, finished], hasMore: false }) })));
  const rows = page.match(/<tbody[\s\S]*?<\/tbody>/u)[0].match(/<tr[\s\S]*?<\/tr>/gu);
  assert.equal(rows.length, 2);
  assert.match(textOf(rows[0]), /Итог будет, когда агент закончит/u, "идущий запуск без слов — обещание итога, а не прочерк");
  assert.match(textOf(rows[0]), / идёт /u, "время и расход идущего запуска — «идёт» (`\\b` в JS не знает кириллицы)");
  assert.doesNotMatch(textOf(rows[0]), /— · 0,00/u);
  assert.match(textOf(rows[1]), /Без итога/u, "законченный без слов — «Без итога»");
  assert.doesNotMatch(textOf(rows[1]), /Итог будет/u);
  assert.match(textOf(rows[1]), /0,11 \$/u, "у законченного время неизвестно, а расход назван");
  assert.doesNotMatch(textOf(rows[1]), /—/u, "неизвестное время не рисуется прочерком");
});

test("маскоты — декоративные картинки: пустое `alt` и `aria-hidden` (сами или предком) на хабе, в шапке страницы агента, в пустом и закрытом чате", async () => {
  const { nextHub, nextPage } = await views();
  const hub = imagesOf(strip(nextHub(F.available(F.LIST), true, false)));
  assert.equal(hub.length, 7, "по маскоту на каждого из семи агентов");
  const overview = imagesOf(strip(nextPage(F.bodyProps("overview"))));
  const chat = imagesOf(strip(nextPage(F.bodyProps("command"))));
  const emptyChat = imagesOf(strip(nextPage(F.bodyProps("command", { resume: { runId: null, sendAuthority: false, run: null }, conversations: [] }))));
  const locked = imagesOf(strip(nextPage(F.bodyProps("command", { detail: F.detail("curator-eu", { hasInstructionsOverride: false, enabled: false }), resume: { runId: null, sendAuthority: false, run: null } }))));
  assert.ok(overview.length >= 1 && chat.length >= 1, "маскот в шапке каждой вкладки");
  assert.ok(emptyChat.length >= 2 && locked.length >= 2, "в пустом и закрытом чате ещё и крупный");
  for (const [name, images] of [["хаб", hub], ["обзор", overview], ["чат", chat], ["пустой чат", emptyChat], ["закрытый чат", locked]]) {
    for (const image of images) assert.deepEqual(image, { alt: "", hidden: true }, `${name}: маскот декоративен`);
  }
  // Шапка с маскотом не уходит «?» на отдельную строку: ряд не переносится, название сужается само; на телефоне маскот 32 px.
  const header = strip(nextPage(F.bodyProps("overview")));
  assert.match(header, /<div class="flex min-w-0 items-center gap-x-2 gap-y-1 flex-nowrap"><img [^>]*class="v3-aia-mascot shrink-0 object-contain size-8 sm:size-10"[^>]*\/><h1 class="t-page-title text-fg min-w-0">/u);
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
    const href = tab ? `/ai-agents/director?tab=${tab}` : "/ai-agents/director";
    assert.match(page, new RegExp(`<a[^>]*href="${href.replace(/[?]/gu, "\\?")}"[^>]*>${label}`, "u"), label);
  }
  assert.match(page, /aria-current="page"[^>]*>Обзор/u);
  assert.match(page, /На одобрение<span[^>]*>3<\/span>/u);
  assert.match(page, /href="\/ai-agents"[^>]*>[\s\S]*Все ИИ-агенты/u, "возврат к списку");
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
  assert.match(page, /href="\/ai-agents\/director\?tab=drafts"/u, "плитка «Ждут решения» ведёт в очередь");
  const never = strip(nextPage(F.bodyProps("overview", { detail: F.detail("director", { stats: F.stats({ lastRunAt: null, lastRunStatus: null, runs7d: 0 }), lastDigest: null }) })));
  assert.match(never, /Запусков ещё не было/u);
  assert.match(never, /Поручить первую задачу/u);
  assert.equal((never.match(/data-slot="stat-tile"/gu) ?? []).length, 0, "у не работавшего агента нет четырёх нулевых плиток");
  assert.doesNotMatch(page, /Что делает агент\s*<span/u, "на кнопке нет числа без единицы: вызовы за 30 дней названы в панели");
  assert.match(read("src/components/staff/ai-agents-next/NextOverviewSheets.tsx"), /Вызовы инструментов за 30 дней: \$\{total\}/u, "единица и период — в описании панели, а не на кнопке");
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
  assert.match(page, /href="\/ai-agents\/director\?tab=runs&amp;limit=60"/u, "тот же шаг чтения, что раньше");
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
  assert.match(empty, /href="\/ai-agents\/director"[^>]*>Поручить/u);
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
  assert.match(bare, new RegExp(`href="/inbox\\?conversation=${CONVERSATION}"[^>]*>Открыть чат`, "u"), "переписка по-прежнему в один шаг");
  assert.match(bare, /Остаётся в очереди: WhatsApp сейчас не подключён/u, "причина — до того, как одобрять");
  assert.match(bare, /Подключите WhatsApp/u);
  assert.match(strip(draftCard({ ...props, bare: true, draft: F.DRAFTS_ALL.drafts[2] })), /действует до /u, "близкий срок остаётся в панели");
  assert.match(bare, /data-testid="v3-aia-approve"/u, "решение — теми же кнопками");
});

test("Wazzup (только чтение): черновик с `receive_only` в «Новом виде» говорит то же, что прежняя карточка, и копируется; строка очереди - ту же фразу", async () => {
  const { draftCard, nextPage } = await views();
  const [whatsapp, , portal] = F.DRAFTS_RECEIVE_ONLY.drafts;
  const props = { draft: whatsapp, canManage: true, now: F.NOW };
  const legacy = strip(draftCard(props));
  const bare = strip(draftCard({ ...props, bare: true }));
  const READ_ONLY = /data-testid="v3-aia-draft-readonly"[^>]*>Только чтение: отвечайте в amoCRM или Wazzup\.</u;
  const COPY = /<button[^>]*data-testid="v3-aia-copy-text"[^>]*>Скопировать текст</u;
  for (const [name, html] of [["прежняя карточка", legacy], ["карточка в панели", bare]]) {
    assert.match(html, READ_ONLY, `${name}: отказ словами`);
    assert.match(html, COPY, `${name}: кнопка копирования`);
    assert.doesNotMatch(html, /Остаётся в очереди|Подключите WhatsApp/u, `${name}: это не сбой подключения`);
    assert.match(html, /data-testid="v3-aia-approve"[\s\S]*data-testid="v3-aia-discard"/u, `${name}: решение теми же кнопками`);
  }
  // Всё, что ниже заголовка, у обоих видов одно и то же: панель «Нового вида» не придумывает своего отказа.
  const tail = (html) => html.slice(html.indexOf('data-testid="v3-aia-draft-readonly"'));
  assert.equal(tail(bare), tail(legacy));
  // Главное действие - копирование (как у обычного «Одобрить»), «Одобрить» остаётся вторичной кнопкой.
  const cls = (html, id) => html.match(new RegExp(`<button[^>]*class="([^"]*)"[^>]*data-testid="${id}"`, "u"))?.[1];
  const ordinary = strip(draftCard({ ...props, bare: true, draft: F.DRAFTS_ALL.drafts[0] }));
  assert.equal(cls(bare, "v3-aia-copy-text"), cls(ordinary, "v3-aia-approve"));
  assert.notEqual(cls(bare, "v3-aia-approve"), cls(ordinary, "v3-aia-approve"));
  assert.doesNotMatch(ordinary, /v3-aia-copy-text|v3-aia-draft-readonly/u, "обычный черновик копирования не получает");
  // Без права решать: слова и копирование остаются (продавцу надо отправить текст), решающих кнопок и поля нет.
  const viewer = strip(draftCard({ ...props, bare: true, canManage: false }));
  assert.match(viewer, READ_ONLY);
  assert.match(viewer, COPY);
  assert.doesNotMatch(viewer, /v3-aia-approve|v3-aia-discard|<textarea/u);
  // Решённый черновик и черновик кабинета студента копирования не получают.
  for (const draft of [{ ...whatsapp, status: "sent", sentAt: F.NOW, decidedAt: F.NOW }, { ...whatsapp, status: "discarded", decidedAt: F.NOW }, portal]) {
    assert.doesNotMatch(strip(draftCard({ ...props, bare: true, draft })), /v3-aia-copy-text|v3-aia-draft-readonly/u, `${draft.status}/${draft.channel}`);
  }
  // Строка очереди: две строки WhatsApp говорят ту же фразу спокойным цветом; кабинет студента - прежние слова.
  const page = strip(nextPage(F.bodyProps("drafts", { drafts: F.available(F.DRAFTS_RECEIVE_ONLY) })));
  const rows = page.match(/<tbody[\s\S]*?<\/tbody>/u)[0].match(/<tr[\s\S]*?<\/tr>/gu);
  assert.equal(rows.length, 3);
  for (const row of rows.slice(0, 2)) {
    assert.match(row, /class="t-meta text-fg-2" data-testid="v3-aia-draft-note">Только чтение: отвечайте в amoCRM или Wazzup\.</u);
    assert.doesNotMatch(row, /Остаётся в очереди/u);
  }
  assert.doesNotMatch(rows[2], /Только чтение: отвечайте/u);
  assert.match(rows[2], /data-testid="v3-aia-draft-note"/u, "у чужого канала слова прежние");
});

test("рамка страницы агента — `PageShell` набора со слотом `back`; ключевые утилиты переключателя запертого вида в наборе", async () => {
  const { nextPage } = await views();
  const page = strip(nextPage(F.bodyProps("overview")));
  assert.match(page, /<main data-testid="v3-ai-agent-page" class="mx-auto w-full px-4 py-8 sm:px-6 max-w-\[1240px\]"><a[^>]*href="\/ai-agents"[^>]*>[\s\S]*Все ИИ-агенты<\/a><div data-slot="page-header"/u, "возврат стоит над шапкой в той же рамке, что хаб");
  assert.match(read("src/components/staff/ai-agents-next/NextAgentPage.tsx"), /<PageShell[^>]*back=\{<NextBackLink \/>\}/u);
  assert.match(read("src/components/staff/ai-agents-next/NextAgentUnavailable.tsx"), /<PageShell[^>]*back=\{<NextBackLink \/>\}/u);
  assert.doesNotMatch(read("src/components/staff/ai-agents-next/NextAgentPage.tsx") + read("src/components/staff/ai-agents-next/NextAgentUnavailable.tsx"), /<main\b/u, "своей рамки <main> у страниц нет");
  const sw = read("src/components/ui/switch.tsx");
  for (const cls of ["aria-disabled:cursor-not-allowed", "aria-disabled:border-border", "aria-disabled:bg-surface-2", "aria-disabled:data-checked:bg-fg-3"]) assert.ok(sw.includes(cls), `переключатель с aria-disabled выглядит запертым: ${cls}`);
});

test("«Чат»: прежний `CommandWorkspace` без изменений в рамке набора; шапка в одну строку с «?», переключателями и «На весь экран»", async () => {
  const { nextPage } = await views();
  const chat = strip(nextPage(F.bodyProps("command")));
  assert.match(chat, /data-aia-workspace=""/u);
  assert.match(chat, /data-testid="v3-aia-chat-header"/u);
  assert.match(chat, /aria-label="Все ИИ-агенты"/u);
  assert.match(chat, /data-aia-chat=""/u, "обёртка, на которую опираются правила staff.css");
  assert.equal((chat.match(/<h1/gu) ?? []).length, 1);
  assert.match(chat, /data-testid="v3-aia-conversations"/u);
  assert.match(chat, /data-testid="v3-aia-send"/u);
});

/* ------------------------------------------------------------------ переключатели и права */

test("«Включён» и «Авто»: заперты без правил, ведут к их написанию; не администратору — слова", async () => {
  const { switches } = await views();
  const locked = strip(switches({ agentKey: "curator-eu", enabled: false, autoSend: false, configVersion: 3, hasInstructions: false, canEdit: true }));
  assert.match(locked, /data-testid="v3-aia-switch-needs-instructions"[^>]*>Сначала напишите правила/u);
  assert.match(locked, /href="\/ai-agents\/curator-eu\?tab=instructions"/u);
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

/* ------------------------------------------------------------------ каталог текстов остаётся на сервере */

/** Файлы, которые войдут в клиентский файл от `entry`: значения и ленивые `import()`; `import type` и серверные действия граф не продолжают. */
function clientGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`].find((file) => /\.tsx?$/u.test(file) && existsSync(root(file)));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/u.test(source)) continue; // клиент получает ссылку на действие, не код
    const ids = [
      ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gu)].map((match) => match[1]),
      ...[...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/gu)].map((match) => match[1]),
      ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]),
    ];
    for (const id of ids) {
      const base = id.startsWith("@/") ? `src/${id.slice(2)}` : id.startsWith(".") ? join(file, "..", id) : null;
      const next = base && resolveFile(base);
      if (next) queue.push(next);
    }
  }
  return seen;
}

test("клиентский граф нового вида «ИИ-агентов» не содержит каталог текстов агентов (он остаётся на сервере)", () => {
  const graph = clientGraph("src/components/staff/ai-agents-next/NextAgentsLazy.tsx");
  for (const file of ["NextAgentsHub.tsx", "NextAgentTab.tsx", "NextRules.tsx", "NextSettings.tsx", "agent-gate.ts"]) assert.ok(graph.has(`src/components/staff/ai-agents-next/${file}`), `обход графа дошёл до ${file}`);
  assert.ok(graph.size > 40, `граф разобран (${graph.size} файлов)`);
  const leaked = [...graph].filter((file) => file.startsWith("src/content/ai-agents/") || file.includes("next-defaults"));
  assert.deepEqual(leaked, [], "каталог текстов (30 КБ gzip) уходил бы в публичный /_next/static: страница отдаёт новому виду только нужное вкладке");
  // Серверный помощник нельзя подключить из клиентского модуля: `server-only` остановит сборку.
  assert.match(read("src/lib/server/ai-agents/next-defaults.ts"), /^import "server-only";/u);
});

test("страница отдаёт новому виду из каталога только нужное: хаб — булевы, вкладка — свои тексты", async () => {
  const { AI_AGENT_DEFAULTS, AI_AGENT_PREAMBLE } = await import("../src/content/ai-agents/index.ts");
  const { hubElement, agentElement } = await views();
  const hub = (await hubElement(world(ADMIN, "next"))).props;
  assert.deepEqual(hub.hasDefault, Object.fromEntries(Object.entries(AI_AGENT_DEFAULTS).map(([key, value]) => [key, value.hasInstructions])));
  assert.ok(Object.values(hub.hasDefault).includes(false) && Object.values(hub.hasDefault).includes(true), "и «есть», и «нет» (curator-eu)");
  const snippets = [AI_AGENT_PREAMBLE, ...Object.values(AI_AGENT_DEFAULTS).flatMap((value) => [value.instructions, value.schedulePrompt ?? ""])].filter(Boolean).map((text) => text.slice(0, 80));
  assert.ok(snippets.length >= 5);
  const hasText = (value) => snippets.some((snippet) => JSON.stringify(value).includes(JSON.stringify(snippet).slice(1, -1)));
  assert.equal(hasText(hub), false, "хаб: в свойствах нет ни одного текста агента");
  for (const [search, expected] of [
    [{ tab: "overview" }, { hasInstructions: true }], [{ tab: "runs" }, { hasInstructions: true }], [{ tab: "drafts" }, { hasInstructions: true }], [{}, { hasInstructions: true }],
    [{ tab: "instructions" }, { hasInstructions: true, instructions: AI_AGENT_DEFAULTS.director.instructions, preamble: AI_AGENT_PREAMBLE }],
    [{ tab: "settings" }, { hasInstructions: true, schedulePrompt: AI_AGENT_DEFAULTS.director.schedulePrompt }],
  ]) {
    const props = (await agentElement(world(ADMIN, "next"), "director", search)).props;
    assert.deepEqual(props.defaults, expected, `director ${JSON.stringify(search)}: defaults`);
    assert.equal(hasText({ ...props, defaults: undefined }), false, `director ${JSON.stringify(search)}: тексты каталога только в defaults`);
    assert.equal(hasText(props.defaults), "instructions" in expected || "schedulePrompt" in expected, `director ${JSON.stringify(search)}: текст только там, где он нужен`);
  }
  const empty = (await agentElement(world(ADMIN, "next"), "curator-eu", { tab: "instructions" })).props.defaults;
  assert.equal(empty.hasInstructions, false);
  assert.equal(empty.instructions, "", "у curator-eu инструкции ещё нет");
});

test("проверка сборки: файл для браузера с текстом агента — ошибка, чистая статика и несуществующий каталог — нет", async () => {
  const { AI_AGENT_PREAMBLE } = await import("../src/content/ai-agents/index.ts");
  const { findPromptLeaks, promptMarkers } = await import("../scripts/checks/check-client-bundle-prompts.mjs");
  const markers = promptMarkers();
  const dir = mkdtempSync(join(tmpdir(), "aia-static-"));
  try {
    mkdirSync(join(dir, "chunks"), { recursive: true });
    writeFileSync(join(dir, "chunks", "clean.js"), 'export const label="ИИ-агенты",rules="Общие правила EVO",hint="Подсказывает ответ, сам ничего не отправляет.";');
    const script = root("scripts/checks/check-client-bundle-prompts.mjs");
    const run = (path) => spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, path], { encoding: "utf8" });
    assert.equal(run(dir).status, 0, "чистая статика");
    assert.deepEqual(findPromptLeaks(dir), []);
    for (const [name, text] of [
      ["preamble", AI_AGENT_PREAMBLE.split("\n")[0]],
      ["director", [...markers].find(([, owner]) => owner === "инструкция director")[0]],
      ["schedule", [...markers].find(([, owner]) => owner === "поручение по расписанию director")[0]],
    ]) {
      writeFileSync(join(dir, "chunks", `${name}.js`), `module.exports={text:${JSON.stringify(text)}};`);
      const result = run(dir);
      assert.equal(result.status, 1, `${name}: текст агента в файле для браузера`);
      assert.match(result.stderr, new RegExp(`chunks[\\/]${name}\\.js`, "u"));
      rmSync(join(dir, "chunks", `${name}.js`));
    }
    assert.equal(run(join(dir, "нет-такого")).status, 2, "нет каталога — сначала сборка");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Проверка идёт сразу за `next build`, не в конце цепочки (два теста закрепляют её конец: сборки обслуживающих задач).
  const build = JSON.parse(read("package.json")).scripts;
  assert.match(build.build, /^next build && npm run check:client-bundle && /u);
  assert.equal(build["check:client-bundle"], "node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/checks/check-client-bundle-prompts.mjs");
});

/* ------------------------------------------------------------------ исходники */

test("исходники: каждый файл нового вида ≤150 строк, без обходов (сырой HTML, service-клиент), прежний каталог не тронут", () => {
  const dir = "src/components/staff/ai-agents-next";
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
  for (const entry of readdirSync(root("src/components/staff/ai-agents"), { withFileTypes: true })) assert.equal(entry.isFile(), true, entry.name);
  const hubPage = read("src/app/(staff)/ai-agents/page.tsx");
  const agentPage = read("src/app/(staff)/ai-agents/[key]/page.tsx");
  for (const page of [hubPage, agentPage]) assert.doesNotMatch(page, /isNextUi|@\/lib\/ui-next"/u, "выбора вида нет: новый вид единственный");
  assert.match(agentPage, /<NextAgentPageLazy \{\.\.\.bodyProps\} defaults=\{nextAgentDefaults\(key, tab\)\} \/>/u, "новый вид получает те же свойства, что `AgentBody`, и тексты вкладки");
  // Новый вид — ленивый вход: в первую загрузку страниц у остальных сотрудников его таблицы, панели и Radix не входят.
  assert.match(hubPage, /import \{ NextAgentsViewLazy \} from "@\/components\/staff\/ai-agents-next\/NextAgentsLazy";/u);
  assert.match(agentPage, /import \{ NextAgentPageLazy, NextAgentUnavailableLazy \} from "@\/components\/staff\/ai-agents-next\/NextAgentsLazy";/u);
  for (const page of [hubPage, agentPage]) assert.doesNotMatch(page, /from "@\/components\/staff\/ai-agents-next\/Next(AgentsView|AgentPage|AgentUnavailable)"/u, "новый вид не импортируется статически");
  const lazy = read(`${dir}/NextAgentsLazy.tsx`);
  assert.match(lazy, /^"use client";/u);
  for (const name of ["NextAgentsView", "NextAgentPage", "NextAgentUnavailable"]) assert.match(lazy, new RegExp(`import\\("\\./${name}"\\)\\.then\\(\\(module\\) => module\\.${name}\\)`, "u"));
  assert.doesNotMatch(agentPage, /<AgentBody|<AgentChatShell|<AgentSwitches/u, "прежней разметки в странице нет");
  assert.match(agentPage, /const canEdit = actor\.systemRole === "admin" && !preview;/u, "менять может только настоящий администратор вне просмотра роли");
});
