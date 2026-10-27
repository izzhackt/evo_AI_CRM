// «Отчёты Looker Studio» (план docs/EVO_LOOKER_REPORTS_PLAN_2026-10-27.md, миграция 323): разбор ввода и адреса,
// строгий разбор ответов базы, права («Финансы» — Admin или `finance.read.full`, меню — точная проверка), чтение и правка
// через настоящий `report-links-source` с запрограммированной границей базы, действия сохранения, страницы «Маркетинг →
// Отчёты» и «Финансы», раздел «Настройки → Отчёты», окно отчёта. Данные — синтетические; ни настоящих идентификаторов
// отчётов, ни адресов Google здесь нет (репозиторий публичный): только выдуманные формы и пример из документации Google.
// Сами функции базы, их права и версии проверяет supabase/tests/platform_report_links.sql.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  LOOKER_EMBED_ERROR_TEXT, LOOKER_FRAME_SANDBOX, LOOKER_INPUT_MAX_LENGTH, isLookerPageId, isLookerReportId,
  lookerEmbedUrl, lookerOpenUrl, parseLookerEmbedInput,
} from "../src/lib/looker-report-link.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";
import { isStaffPreview, staffCanAccessRoute } from "../src/lib/platform-access.ts";
import { marketingHref, MARKETING_VIEWS, parseMarketingView } from "../src/lib/marketing-view.ts";
import {
  REPORT_FORM_MESSAGE, REPORT_KEYS, isReportKey, parseReportLink, parseReportLinkSaved,
} from "../src/lib/report-link-contract.ts";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Мини-загрузчик TS/TSX: границы сервера подменяются явно (`overrides` — по тексту импорта). */
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const code = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const compiled = { exports: {} };
    cache.set(path, compiled);
    const resolveFile = (base) => [`${base}.ts`, `${base}.tsx`, base].find((file) => existsSync(new URL(`../${file}`, import.meta.url)) && /\.tsx?$/.test(file));
    new Function("require", "module", "exports", code)((id) => {
      if (id in overrides) return overrides[id];
      if (id === "server-only") return {};
      if (id.endsWith(".json") && id.startsWith("@/")) return JSON.parse(read(join("src", id.slice(2))));
      if (id.endsWith(".json") && id.startsWith(".")) return JSON.parse(read(join(dirname(path), id)));
      if (id.startsWith("@/")) return load(resolveFile(join("src", id.slice(2))) ?? assert.fail(id));
      if (id.startsWith(".")) return load(resolveFile(join(dirname(path), id)) ?? assert.fail(`${path}: ${id}`));
      return require(id);
    }, compiled, compiled.exports);
    return compiled.exports;
  }
  return load;
}

const ORG = "10000000-0000-4000-8000-000000000323";
const REQ = "50000000-0000-4000-8000-000000000323";
const REPORT = "abcdefgh12";
const PAGE = "pg01";
const UUID_REPORT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
/** Публичный пример из документации Google для встраивания (developers.google.com/looker-studio/integrate/embed). */
const GOOGLE_REPORT = "1se-9ZRSukdgQUiRqYTSjT8nFLTV0v8Uq";
const GOOGLE_PAGE = "y5MR";
const EMBED = (id, page) => `https://lookerstudio.google.com/embed/reporting/${id}${page ? `/page/${page}` : ""}`;
const OPEN = (id, page) => `https://lookerstudio.google.com/reporting/${id}${page ? `/page/${page}` : ""}`;

const admin = { organizationId: ORG, systemRole: "admin", presentationRole: null, permissionKeys: [], platformAccessVersion: 1, assignments: [] };
const accountant = { organizationId: ORG, systemRole: "staff", presentationRole: null, permissionKeys: ["finance.read.full"], platformAccessVersion: 1, assignments: [] };
const sellerKeys = ["lead.read", "lead.sales.workflow.manage", "sales.register.read", "finance.read.summary", "finance.manage"];

/* ------------------------------------------------------------------ разбор ввода */

test("the embed code of Google's example is parsed to the identifiers; every other attribute is dropped", () => {
  const code = `<iframe width="600" height="450" src="https://datastudio.google.com/embed/reporting/${GOOGLE_REPORT}/page/${GOOGLE_PAGE}" frameborder="0" style="border:0" allowfullscreen sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>`;
  assert.deepEqual(parseLookerEmbedInput(code), { ok: true, reportId: GOOGLE_REPORT, pageId: GOOGLE_PAGE });
  // Размер и `sandbox` задаёт CRM: ни ширины, ни высоты, ни прав окна из чужого кода не берётся.
  assert.deepEqual(parseLookerEmbedInput(`<iframe  src='${EMBED(REPORT, PAGE)}'  ></iframe>`), { ok: true, reportId: REPORT, pageId: PAGE });
  assert.deepEqual(parseLookerEmbedInput(`<IFRAME SRC="${EMBED(REPORT)}"></IFRAME>`), { ok: true, reportId: REPORT, pageId: null });
  assert.deepEqual(parseLookerEmbedInput(`<iframe src="${EMBED(REPORT)}?params=%7B%7D&amp;x=1#frag"></iframe>`), { ok: true, reportId: REPORT, pageId: null }, "&amp; and the tail are dropped");
});

test("an embed link is accepted with or without a page, a slash, a query, a hash, either Google host and any case of the host", () => {
  for (const [input, expected] of [
    [EMBED(REPORT), [REPORT, null]],
    [`${EMBED(REPORT)}/`, [REPORT, null]],
    [EMBED(REPORT, PAGE), [REPORT, PAGE]],
    [`${EMBED(REPORT, PAGE)}/`, [REPORT, PAGE]],
    [`  ${EMBED(REPORT, PAGE)}\n`, [REPORT, PAGE]],
    [`${EMBED(REPORT, PAGE)}?s=ab&amp;c=d`, [REPORT, PAGE]],
    [`${EMBED(REPORT, PAGE)}#section`, [REPORT, PAGE]],
    [`https://datastudio.google.com/embed/reporting/${GOOGLE_REPORT}/page/${GOOGLE_PAGE}`, [GOOGLE_REPORT, GOOGLE_PAGE]],
    [`https://LookerStudio.Google.com/embed/reporting/${UUID_REPORT}`, [UUID_REPORT, null]],
    [EMBED("p_synthetic1", "p_page_2"), ["p_synthetic1", "p_page_2"]],
    [`https://lookerstudio.google.com:443/embed/reporting/${REPORT}`, [REPORT, null]],
  ]) {
    assert.deepEqual(parseLookerEmbedInput(input), { ok: true, reportId: expected[0], pageId: expected[1] }, input);
  }
});

test("the account chooser /u/{n} is recognized and dropped at the start of the path or right after /embed", () => {
  for (const input of [
    `https://lookerstudio.google.com/embed/u/0/reporting/${REPORT}/page/${PAGE}`,
    `https://lookerstudio.google.com/u/0/embed/reporting/${REPORT}/page/${PAGE}`,
    `https://lookerstudio.google.com/u/12/embed/reporting/${REPORT}/page/${PAGE}`,
    `https://datastudio.google.com/embed/u/1/reporting/${REPORT}/page/${PAGE}`,
  ]) {
    const parsed = parseLookerEmbedInput(input);
    assert.deepEqual(parsed, { ok: true, reportId: REPORT, pageId: PAGE }, input);
    assert.equal(lookerEmbedUrl(parsed.reportId, parsed.pageId), EMBED(REPORT, PAGE), "the built address never carries /u/");
  }
});

test("an ordinary report link is `share_link` (Google requires the code from «Встроить отчёт»), not `invalid`", () => {
  for (const input of [
    OPEN(REPORT, PAGE), OPEN(REPORT), `${OPEN(REPORT, PAGE)}/edit`, `${OPEN(REPORT)}?params=x`,
    `https://lookerstudio.google.com/u/0/reporting/${REPORT}/page/${PAGE}`,
    `https://datastudio.google.com/reporting/${REPORT}`,
    `https://datastudio.google.com/u/0/reporting/${REPORT}`,
  ]) {
    assert.deepEqual(parseLookerEmbedInput(input), { ok: false, error: "share_link" }, input);
  }
});

test("a foreign host, scheme, login, port, path, identifier or code is refused with the right word and never reaches the address", () => {
  const cases = [
    ["", "empty"], ["   \n\t ", "empty"],
    ["x".repeat(LOOKER_INPUT_MAX_LENGTH + 1), "too_long"],
    [`${"y".repeat(LOOKER_INPUT_MAX_LENGTH)}`, "invalid"],
    [EMBED(REPORT).replace("https:", "http:"), "not_looker"],
    [`https://lookerstudio.google.com.example.com/embed/reporting/${REPORT}`, "not_looker"],
    [`https://evil.example/embed/reporting/${REPORT}`, "not_looker"],
    [`https://notlookerstudio.google.com/embed/reporting/${REPORT}`, "not_looker"],
    [`https://google.com/embed/reporting/${REPORT}`, "not_looker"],
    [`https://evil.example\\@lookerstudio.google.com/embed/reporting/${REPORT}`, "not_looker"],
    [`https://lookerstudio.google.com./embed/reporting/${REPORT}`, "not_looker"],
    ["javascript:alert(1)", "not_looker"], ["data:text/html,x", "not_looker"],
    [`ftp://lookerstudio.google.com/embed/reporting/${REPORT}`, "not_looker"],
    [`https://user@lookerstudio.google.com/embed/reporting/${REPORT}`, "invalid"],
    [`https://user:secret@lookerstudio.google.com/embed/reporting/${REPORT}`, "invalid"],
    [`https://lookerstudio.google.com:8443/embed/reporting/${REPORT}`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/short`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/${REPORT}/page/`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/${REPORT}/page/${PAGE}/extra`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/${REPORT}/other/${PAGE}`, "invalid"],
    [`https://lookerstudio.google.com/embed/other/${REPORT}`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/abcdefgh%2F12`, "invalid"],
    [`https://lookerstudio.google.com/embed/reporting/${REPORT}/../../../evil`, "invalid"],
    [`https://lookerstudio.google.com//embed/reporting/${REPORT}`, "invalid"],
    [`https://lookerstudio.google.com/`, "invalid"], [`https://lookerstudio.google.com`, "invalid"],
    [`https://lookerstudio.google.com/reporting`, "invalid"],
    [`see ${EMBED(REPORT)}`, "invalid"], ["не ссылка", "invalid"],
    [`<iframe src="https://evil.example/x"></iframe>`, "not_looker"],
    [`<iframe src="javascript:alert(1)"></iframe>`, "not_looker"],
    [`<iframe src="https://evil.example/x" data-src="${EMBED(REPORT)}"></iframe>`, "not_looker"],
    [`<iframe data-src="${EMBED(REPORT)}"></iframe>`, "invalid"],
    [`<iframe width="600"></iframe>`, "invalid"], [`<iframe src=""></iframe>`, "invalid"],
    [`<iframe src=${EMBED(REPORT)}></iframe>`, "invalid"],
    [null, "invalid"], [undefined, "invalid"], [5, "invalid"], [{}, "invalid"],
  ];
  for (const [input, error] of cases) assert.deepEqual(parseLookerEmbedInput(input), { ok: false, error }, String(input).slice(0, 90));
  for (const error of ["empty", "too_long", "not_looker", "share_link", "invalid"]) assert.ok(LOOKER_EMBED_ERROR_TEXT[error], error);
  assert.match(LOOKER_EMBED_ERROR_TEXT.not_looker, /lookerstudio\.google\.com/u);
  assert.match(LOOKER_EMBED_ERROR_TEXT.share_link, /Файл → Встроить отчёт/u);
});

test("whatever is parsed, the address is rebuilt from the identifiers by the template: always https://lookerstudio.google.com/embed/reporting", () => {
  const inputs = [
    EMBED(REPORT), EMBED(REPORT, PAGE), `<iframe src="${EMBED(UUID_REPORT, PAGE)}?x=1"></iframe>`,
    `https://datastudio.google.com/embed/u/0/reporting/${GOOGLE_REPORT}/page/${GOOGLE_PAGE}`,
  ];
  for (const input of inputs) {
    const parsed = parseLookerEmbedInput(input);
    assert.equal(parsed.ok, true);
    const built = lookerEmbedUrl(parsed.reportId, parsed.pageId);
    assert.match(built, /^https:\/\/lookerstudio\.google\.com\/embed\/reporting\/[A-Za-z0-9_-]{8,100}(?:\/page\/[A-Za-z0-9_-]{1,100})?$/u);
    assert.doesNotMatch(built, /datastudio|\/u\/|[?#@:]\d|&/u);
    assert.deepEqual(parseLookerEmbedInput(built), parsed, "the built address parses back to the same identifiers");
  }
});

test("the builders refuse an identifier that is not of the stored form; the open address is the ordinary report view", () => {
  assert.equal(lookerEmbedUrl(REPORT, null), EMBED(REPORT));
  assert.equal(lookerEmbedUrl(REPORT, PAGE), EMBED(REPORT, PAGE));
  assert.equal(lookerEmbedUrl(REPORT, undefined), EMBED(REPORT));
  assert.equal(lookerOpenUrl(REPORT, null), OPEN(REPORT));
  assert.equal(lookerOpenUrl(REPORT, PAGE), OPEN(REPORT, PAGE));
  for (const bad of ["a/b/c/d/e/f/g/h", 'abcdefgh"onload=x', "abcdefgh ijkl", "abcdefg", "abcdefgh?x=1", "abcdefgh#a", "..", "абвгдежзий", "", null, undefined, 5, `${"a".repeat(101)}`]) {
    assert.equal(lookerEmbedUrl(bad, null), null, String(bad));
    assert.equal(lookerOpenUrl(bad, null), null, String(bad));
    assert.equal(isLookerReportId(bad), false, String(bad));
  }
  for (const bad of ["a/b", 'p"', "p q", "p?", "", 5, "x".repeat(101)]) {
    assert.equal(lookerEmbedUrl(REPORT, bad), null, String(bad));
    assert.equal(lookerOpenUrl(REPORT, bad), null, String(bad));
    assert.equal(isLookerPageId(bad), false, String(bad));
  }
  assert.equal(isLookerPageId("y"), true);
  assert.equal(isLookerReportId("abcdefgh"), true);
});

test("the window rights are the strict set: no top navigation, no escaping popups, no forms, no downloads", () => {
  const tokens = LOOKER_FRAME_SANDBOX.split(" ");
  assert.deepEqual(tokens, ["allow-scripts", "allow-same-origin", "allow-popups", "allow-storage-access-by-user-activation"]);
  for (const forbidden of ["allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-popups-to-escape-sandbox", "allow-forms", "allow-modals", "allow-downloads"]) {
    assert.equal(tokens.includes(forbidden), false, forbidden);
  }
});

/* ------------------------------------------------------------------ ответы базы */

const readJson = (over = {}) => ({
  schemaVersion: 1, organizationId: ORG, reportKey: "finance", configured: true, reportId: REPORT, pageId: PAGE, version: 3,
  updatedAt: "2026-10-27T09:32:00.123456+00:00", ...over,
});
const savedJson = (over = {}) => ({ ...readJson(), status: "saved", replayed: false, ...over });
const EXPECT = { organizationId: ORG, reportKey: "finance" };
const omit = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

test("the read answer is parsed strictly: the exact keys, the organization, the key, the pairing of the fields and the version", () => {
  assert.deepEqual(parseReportLink(readJson(), EXPECT), { reportKey: "finance", configured: true, reportId: REPORT, pageId: PAGE, version: 3, updatedAt: "2026-10-27T09:32:00.123456+00:00" });
  assert.deepEqual(parseReportLink(readJson({ pageId: null }), EXPECT)?.pageId, null);
  // «Строки ещё нет»: версия 0, ни отчёта, ни времени. Убранный отчёт: строка есть, отчёта нет.
  assert.deepEqual(parseReportLink(readJson({ configured: false, reportId: null, pageId: null, version: 0, updatedAt: null }), EXPECT),
    { reportKey: "finance", configured: false, reportId: null, pageId: null, version: 0, updatedAt: null });
  assert.equal(parseReportLink(readJson({ configured: false, reportId: null, pageId: null, version: 4 }), EXPECT)?.configured, false);
  const bad = [
    null, [], "x", {}, readJson({ extra: 1 }), omit(readJson(), "version"),
    readJson({ schemaVersion: 2 }), readJson({ organizationId: "other" }), readJson({ reportKey: "marketing" }), readJson({ reportKey: "reports" }),
    readJson({ configured: "true" }), readJson({ configured: false }), readJson({ reportId: null }),
    readJson({ configured: false, reportId: null, pageId: PAGE, version: 4 }),
    readJson({ reportId: "a/b/c/d/e/f/g/h" }), readJson({ reportId: "https://lookerstudio.google.com/embed/reporting/abcdefgh12" }), readJson({ pageId: "p/q" }), readJson({ pageId: "" }),
    readJson({ version: "3" }), readJson({ version: -1 }), readJson({ version: 1.5 }), readJson({ version: 0 }),
    readJson({ updatedAt: null }), readJson({ updatedAt: "not a time" }),
    readJson({ configured: true, version: 0, updatedAt: null }),
    readJson({ configured: false, reportId: null, pageId: null, version: 0, updatedAt: "2026-10-27T09:32:00+00:00" }),
  ];
  for (const one of bad) assert.equal(parseReportLink(one, EXPECT), null, JSON.stringify(one)?.slice(0, 80));
});

test("the save receipt carries the status and the replay flag on top of the read shape; anything else is refused", () => {
  assert.deepEqual(parseReportLinkSaved(savedJson(), EXPECT)?.status, "saved");
  assert.equal(parseReportLinkSaved(savedJson({ status: "unchanged" }), EXPECT)?.status, "unchanged");
  assert.equal(parseReportLinkSaved(savedJson({ replayed: true }), EXPECT)?.replayed, true);
  for (const one of [
    savedJson({ status: "removed" }), savedJson({ replayed: "no" }), savedJson({ fingerprint: "a".repeat(64) }),
    omit(savedJson(), "status"), omit(savedJson(), "replayed"), readJson(), savedJson({ organizationId: "other" }),
    savedJson({ reportId: "bad/id/bad/id" }),
  ]) assert.equal(parseReportLinkSaved(one, EXPECT), null, JSON.stringify(one).slice(0, 80));
  assert.deepEqual([...REPORT_KEYS], ["marketing", "finance"]);
  assert.equal(isReportKey("finance") && isReportKey("marketing"), true);
  for (const key of ["reports", "Finance", "", null, undefined, 5]) assert.equal(isReportKey(key), false, String(key));
});

/* ------------------------------------------------------------------ права и меню */

test("`/v3/finance` opens for the real Admin and a holder of finance.read.full; role preview and everyone else are refused; «Маркетинг» is unchanged", () => {
  assert.equal(staffCanAccessRoute(admin, "/v3/finance"), true);
  assert.equal(staffCanAccessRoute(accountant, "/v3/finance"), true, "«systemRole: staff» is the only real non-admin value");
  assert.equal(staffCanAccessRoute({ ...accountant, permissionKeys: [] }, "/v3/finance"), false);
  assert.equal(staffCanAccessRoute({ ...accountant, permissionKeys: sellerKeys }, "/v3/finance"), false, "finance.read.summary / finance.manage are not enough");
  assert.equal(staffCanAccessRoute({ ...accountant, permissionKeys: ["finance.read.summary"] }, "/v3/finance"), false);
  for (const presentationRole of ["admin", "sales", "admissions"]) {
    const preview = { ...admin, presentationRole };
    assert.equal(isStaffPreview(preview), true);
    assert.equal(staffCanAccessRoute(preview, "/v3/finance"), false, `preview ${presentationRole}`);
    assert.equal(staffCanAccessRoute({ ...preview, permissionKeys: ["finance.read.full"] }, "/v3/finance"), false, `preview ${presentationRole} with the right`);
    assert.equal(staffCanAccessRoute(preview, "/v3/marketing"), false);
  }
  // «Маркетинг» — по-прежнему только настоящий Admin, и право на финансы его не открывает.
  assert.equal(staffCanAccessRoute(admin, "/v3/marketing"), true);
  assert.equal(staffCanAccessRoute(accountant, "/v3/marketing"), false);
  assert.equal(staffCanAccessRoute(accountant, "/v3/knowledge"), false);
});

function menuIds(actor, options) {
  const url = new URL("/v3/main", "https://menu.test");
  const model = options === undefined ? buildV3Navigation(actor, url.pathname, url.searchParams) : buildV3Navigation(actor, url.pathname, url.searchParams, options);
  const links = [model.home, ...model.groups.flatMap((group) => group.links), ...model.sections, ...model.common, model.settings].filter(Boolean);
  return { ids: links.map((link) => link.id), model };
}

test("the «Финансы» menu item is the exact check: it follows `financeSection`, closed by default, never in role preview", () => {
  // Без аргумента — как было: только настоящий Admin.
  assert.equal(menuIds(admin).ids.includes("finance"), true);
  assert.equal(menuIds(accountant).ids.includes("finance"), false, "a snapshot holder does not get the item without the exact check");
  assert.equal(menuIds(accountant, {}).ids.includes("finance"), false);
  // Точная проверка: держатель права на всю организацию — есть, только на «свои» и т.п. (layout дал false) — нет.
  assert.equal(menuIds(accountant, { financeSection: true }).ids.includes("finance"), true);
  assert.equal(menuIds(accountant, { financeSection: false }).ids.includes("finance"), false);
  assert.deepEqual(menuIds(accountant, { financeSection: true }).model.sections.map((link) => link.id), ["finance"], "no «Маркетинг» for the accountant");
  // Палитра команд берёт тот же объект `navigation`: пункт исчезает и там.
  const sections = (actor, options) => menuIds(actor, options).model.sections.map((link) => link.href);
  assert.deepEqual(sections(admin), ["/v3/marketing", "/v3/finance"]);
  assert.deepEqual(sections(accountant, { financeSection: false }), []);
  // Admin с явным false и сотрудник без права, но с true — права маршрута всё равно решают.
  assert.equal(menuIds(admin, { financeSection: false }).ids.includes("finance"), false);
  assert.equal(menuIds({ ...accountant, permissionKeys: [] }, { financeSection: true }).ids.includes("finance"), false);
  assert.equal(menuIds({ ...accountant, permissionKeys: sellerKeys }, { financeSection: true }).ids.includes("finance"), false);
  for (const presentationRole of ["admin", "sales", "admissions"]) {
    for (const options of [undefined, { financeSection: true }]) {
      assert.equal(menuIds({ ...admin, presentationRole }, options).ids.includes("finance"), false, `preview ${presentationRole}`);
    }
  }
  // Страница по прямому адресу подсвечивает пункт, только если он есть.
  const model = buildV3Navigation(accountant, "/v3/finance", new URLSearchParams(), { financeSection: true });
  assert.equal(model.activeId, "finance");
  assert.equal(buildV3Navigation(accountant, "/v3/finance", new URLSearchParams(), { financeSection: false }).activeId, null);
});

/* ------------------------------------------------------------------ граница базы */

function sourceWith(handler) {
  const rpcs = [];
  const client = { schema: (name) => ({ rpc: async (fn, args) => { rpcs.push([name, fn, args]); return handler(fn, args); } }) };
  const source = loader({ "../supabase/server.ts": { createSupabaseServerClient: async () => client } })("src/lib/v3/report-links-source.ts");
  return { ...source, rpcs };
}
const answer = (data) => () => ({ data, error: null });

test("reading asks the database with exact arguments; a role that cannot ask never reaches it; failures are `denied` / `unavailable`, never an empty report", async () => {
  const { readReportLink, rpcs } = sourceWith(answer(readJson()));
  const result = await readReportLink(admin, "finance");
  assert.deepEqual(result, { status: "available", link: { reportKey: "finance", configured: true, reportId: REPORT, pageId: PAGE, version: 3, updatedAt: "2026-10-27T09:32:00.123456+00:00" } });
  assert.deepEqual(rpcs, [["platform", "organization_report_link_v1", { p_organization_id: ORG, p_report_key: "finance" }]]);
  // «Маркетинг» и «Финансы» не путаются: ответ другого отчёта — не тот ответ.
  assert.deepEqual(await readReportLink(admin, "marketing"), { status: "unavailable" });
  assert.deepEqual(rpcs.at(-1), ["platform", "organization_report_link_v1", { p_organization_id: ORG, p_report_key: "marketing" }]);

  const none = sourceWith(() => assert.fail("no RPC for a role that cannot ask"));
  for (const [actor, key] of [[accountant, "marketing"], [{ ...accountant, permissionKeys: sellerKeys }, "finance"], [{ ...accountant, permissionKeys: [] }, "finance"], [{ ...accountant, systemRole: null, permissionKeys: [] }, "finance"]]) {
    assert.deepEqual(await none.readReportLink(actor, key), { status: "denied" }, key);
  }
  assert.equal(none.rpcs.length, 0);

  for (const [response, status] of [
    [{ data: null, error: { code: "42501", message: "report_link_forbidden" } }, "denied"],
    [{ data: null, error: { code: "XX000", message: "boom" } }, "unavailable"],
    [{ data: null, error: { code: "PGRST202" } }, "unavailable"],
    [{ data: null, error: null }, "unavailable"],
    [{ data: {}, error: null }, "unavailable"],
    [{ data: readJson({ organizationId: "other" }), error: null }, "unavailable"],
    [{ data: readJson({ reportId: "bad/bad/bad/bad" }), error: null }, "unavailable"],
  ]) assert.deepEqual(await sourceWith(() => response).readReportLink(admin, "finance"), { status }, JSON.stringify(response).slice(0, 70));
  assert.deepEqual(await sourceWith(() => { throw new Error("network"); }).readReportLink(admin, "finance"), { status: "unavailable" });
});

test("the menu check: preview and a missing right never read; the Admin never reads; the holder of the right reads once; any error hides the item", async () => {
  const none = sourceWith(() => assert.fail("no RPC"));
  assert.equal(await none.readFinanceSectionAccess({ ...admin, presentationRole: "sales" }), false);
  assert.equal(await none.readFinanceSectionAccess({ ...admin, presentationRole: "admin" }), false);
  assert.equal(await none.readFinanceSectionAccess({ ...accountant, permissionKeys: [] }), false);
  assert.equal(await none.readFinanceSectionAccess({ ...accountant, permissionKeys: sellerKeys }), false);
  assert.equal(await none.readFinanceSectionAccess(admin), true);
  assert.equal(none.rpcs.length, 0, "zero RPC calls for preview, no right and the Admin");

  const holder = sourceWith(answer(readJson()));
  assert.equal(await holder.readFinanceSectionAccess(accountant), true);
  assert.deepEqual(holder.rpcs, [["platform", "organization_report_link_v1", { p_organization_id: ORG, p_report_key: "finance" }]], "exactly one light read of the function that also decides the page");
  // Область права «свои» / отдел / направление / запись: база отвечает 42501 — пункта нет.
  assert.equal(await sourceWith(() => ({ data: null, error: { code: "42501" } })).readFinanceSectionAccess(accountant), false);
  assert.equal(await sourceWith(() => ({ data: null, error: { code: "XX000" } })).readFinanceSectionAccess(accountant), false);
  assert.equal(await sourceWith(() => { throw new Error("network"); }).readFinanceSectionAccess(accountant), false);
  assert.equal(await sourceWith(answer({})).readFinanceSectionAccess(accountant), false);
});

test("saving sends identifiers only, never an address; preview and non-Admin never reach the database; errors map to words", async () => {
  const { saveReportLink, rpcs } = sourceWith(answer(savedJson()));
  const input = { reportKey: "finance", expectedVersion: 2, reportId: REPORT, pageId: PAGE, requestId: REQ };
  const saved = await saveReportLink(admin, input);
  assert.equal(saved.status, "saved");
  assert.equal(saved.link.version, 3);
  assert.deepEqual(rpcs, [["platform", "organization_report_link_save_v1", { p_organization_id: ORG, p_report_key: "finance", p_expected_version: 2, p_report_id: REPORT, p_page_id: PAGE, p_request_id: REQ }]]);
  assert.doesNotMatch(JSON.stringify(rpcs), /https?:|google\.com/u);
  assert.equal((await sourceWith(answer(savedJson({ status: "unchanged" }))).saveReportLink(admin, input)).status, "unchanged");

  const none = sourceWith(() => assert.fail("no RPC"));
  for (const actor of [{ ...admin, presentationRole: "admin" }, { ...admin, presentationRole: "sales" }, accountant, { ...accountant, permissionKeys: [] }]) {
    assert.deepEqual(await none.saveReportLink(actor, input), { status: "forbidden" });
  }
  assert.deepEqual(await none.saveReportLink(admin, { ...input, requestId: "nope" }), { status: "invalid" });
  assert.deepEqual(await none.saveReportLink(admin, { ...input, expectedVersion: -1 }), { status: "invalid" });
  assert.deepEqual(await none.saveReportLink(admin, { ...input, expectedVersion: 1.5 }), { status: "invalid" });
  assert.equal(none.rpcs.length, 0);

  for (const [error, status] of [
    [{ code: "42501" }, "forbidden"], [{ code: "22023" }, "invalid"], [{ code: "PT409" }, "version_conflict"],
    [{ code: "23505" }, "request_conflict"], [{ code: "XX000" }, "unavailable"], [{}, "unavailable"],
  ]) assert.deepEqual(await sourceWith(() => ({ data: null, error })).saveReportLink(admin, input), { status }, JSON.stringify(error));
  assert.deepEqual(await sourceWith(answer({ ...savedJson(), extra: true })).saveReportLink(admin, input), { status: "unavailable" }, "a receipt of the wrong shape is not a success");
  assert.deepEqual(await sourceWith(() => { throw new Error("network"); }).saveReportLink(admin, input), { status: "unavailable" });
  // «Убрать»: отчёт и страница — NULL.
  const removal = sourceWith(answer(savedJson({ configured: false, reportId: null, pageId: null, version: 4 })));
  assert.equal((await removal.saveReportLink(admin, { ...input, reportId: null, pageId: null })).link.configured, false);
  assert.deepEqual(removal.rpcs[0][2].p_report_id, null);
});

/* ------------------------------------------------------------------ действия сохранения */

function actions(handler, actor = admin) {
  const rpcs = [], revalidated = [];
  const client = { schema: () => ({ rpc: async (fn, args) => { rpcs.push([fn, args]); return handler(fn, args); } }) };
  const guarded = [];
  const load = loader({
    "../supabase/server.ts": { createSupabaseServerClient: async () => client },
    "./platform-guards": { requirePlatformStaffActor: async () => { guarded.push(1); return actor; } },
    "next/cache": { revalidatePath: (path) => revalidated.push(path) },
  });
  return { ...load("src/lib/platform-report-link-actions.ts"), rpcs, revalidated, guarded };
}
const form = (entries) => { const data = new FormData(); for (const [key, value] of Object.entries(entries)) data.set(key, value); return data; };
const base = { request_id: REQ, report_key: "finance", expected_version: "2", embed: `<iframe src="${EMBED(REPORT, PAGE)}?x=1&amp;y=2" width="600"></iframe>` };
const idle = { status: "idle", requestId: REQ };

test("saving: the pasted code becomes identifiers, one RPC with the version the person saw, the three pages are revalidated", async () => {
  const a = actions(answer(savedJson()));
  assert.deepEqual(await a.saveReportLinkAction(idle, form(base)), { status: "saved", requestId: REQ });
  assert.deepEqual(a.rpcs, [["organization_report_link_save_v1", { p_organization_id: ORG, p_report_key: "finance", p_expected_version: 2, p_report_id: REPORT, p_page_id: PAGE, p_request_id: REQ }]]);
  assert.deepEqual(a.revalidated, ["/v3/settings", "/v3/marketing", "/v3/finance"]);
  assert.equal(a.guarded.length, 1);
  const unchanged = actions(answer(savedJson({ status: "unchanged" })));
  assert.deepEqual(await unchanged.saveReportLinkAction(idle, form(base)), { status: "unchanged", requestId: REQ });
  // Пустая страница — NULL; идентификаторы Google ровно в той форме, что хранит база.
  const noPage = actions(answer(savedJson({ pageId: null })));
  await noPage.saveReportLinkAction(idle, form({ ...base, embed: EMBED(UUID_REPORT) }));
  assert.deepEqual([noPage.rpcs[0][1].p_report_id, noPage.rpcs[0][1].p_page_id], [UUID_REPORT, null]);
});

test("saving: role preview refuses before anything is read or written; so does anyone but the real Admin", async () => {
  for (const actor of [{ ...admin, presentationRole: "admin" }, { ...admin, presentationRole: "sales" }, { ...admin, presentationRole: "admissions" }, accountant, { ...accountant, permissionKeys: [] }]) {
    const a = actions(() => assert.fail("the database is not reached"), actor);
    assert.deepEqual(await a.saveReportLinkAction(idle, form(base)), { status: "forbidden", requestId: REQ });
    assert.deepEqual(await a.removeReportLinkAction(idle, form({ request_id: REQ, report_key: "finance", expected_version: "2" })), { status: "forbidden", requestId: REQ });
    assert.equal(a.rpcs.length, 0);
    assert.deepEqual(a.revalidated, []);
  }
});

test("saving: a bad input never reaches the database and answers with the word for it; the field stays in the form", async () => {
  const refuse = async (over, status, previous = idle) => {
    const a = actions(() => assert.fail("the database is not reached"));
    const result = await a.saveReportLinkAction(previous, form({ ...base, ...over }));
    assert.equal(result.status, status, JSON.stringify(over).slice(0, 80));
    assert.equal(a.rpcs.length, 0);
    assert.deepEqual(a.revalidated, []);
    return result;
  };
  await refuse({ embed: OPEN(REPORT) }, "share_link");
  await refuse({ embed: "https://evil.example/embed/reporting/abcdefgh12" }, "not_looker");
  await refuse({ embed: `<iframe src="https://evil.example/x"></iframe>` }, "not_looker");
  await refuse({ embed: "" }, "invalid");
  await refuse({ embed: "x".repeat(LOOKER_INPUT_MAX_LENGTH + 1) }, "invalid");
  await refuse({ embed: "https://user@lookerstudio.google.com/embed/reporting/abcdefgh12" }, "invalid");
  await refuse({ report_key: "reports" }, "invalid");
  await refuse({ expected_version: "-1" }, "invalid");
  await refuse({ expected_version: "1.5" }, "invalid");
  await refuse({ expected_version: "" }, "invalid");
  await refuse({ expected_version: "9".repeat(16) }, "invalid");
  const noRequest = await refuse({ request_id: "not-a-uuid" }, "invalid");
  assert.equal(noRequest.requestId, REQ, "the previous request id is kept when this one is unusable");
  const missing = actions(() => assert.fail("no"));
  assert.equal((await missing.saveReportLinkAction(idle, form({ request_id: REQ, report_key: "finance" }))).status, "invalid", "a missing field");
  const extra = actions(() => assert.fail("no"));
  assert.equal((await extra.saveReportLinkAction(idle, form({ ...base, admin: "1" }))).status, "invalid", "an unknown field");
});

test("saving: the database words become form states; an unknown result is `unavailable` and keeps the request id for a safe retry", async () => {
  for (const [error, status] of [[{ code: "PT409" }, "version_conflict"], [{ code: "23505" }, "request_conflict"], [{ code: "42501" }, "forbidden"], [{ code: "22023" }, "invalid"], [{ code: "XX000" }, "unavailable"]]) {
    const a = actions(() => ({ data: null, error }));
    assert.deepEqual(await a.saveReportLinkAction(idle, form(base)), { status, requestId: REQ });
    assert.deepEqual(a.revalidated, [], "nothing is revalidated after a failure");
  }
  for (const status of Object.keys(REPORT_FORM_MESSAGE)) assert.equal(typeof REPORT_FORM_MESSAGE[status], "string", status);
  assert.equal(REPORT_FORM_MESSAGE.version_conflict, "Ссылку только что изменил другой администратор. Обновите страницу.");
  assert.equal(REPORT_FORM_MESSAGE.request_conflict, "Этот запрос уже отправлен с другими данными. Обновите страницу.");
  assert.equal(REPORT_FORM_MESSAGE.unchanged, "Ссылка та же, ничего не изменилось.");
});

test("removing: no code is read, report and page go as NULL, the state is «removed» (or «unchanged» when nothing was connected)", async () => {
  const a = actions(answer(savedJson({ configured: false, reportId: null, pageId: null, version: 4 })));
  assert.deepEqual(await a.removeReportLinkAction(idle, form({ request_id: REQ, report_key: "finance", expected_version: "3" })), { status: "removed", requestId: REQ });
  assert.deepEqual(a.rpcs, [["organization_report_link_save_v1", { p_organization_id: ORG, p_report_key: "finance", p_expected_version: 3, p_report_id: null, p_page_id: null, p_request_id: REQ }]]);
  assert.deepEqual(a.revalidated, ["/v3/settings", "/v3/marketing", "/v3/finance"]);
  const gone = actions(answer(savedJson({ status: "unchanged", reportKey: "marketing", configured: false, reportId: null, pageId: null, version: 0, updatedAt: null })));
  assert.equal((await gone.removeReportLinkAction(idle, form({ request_id: REQ, report_key: "marketing", expected_version: "0" }))).status, "unchanged");
  // Поле `embed` у «Убрать» лишнее: форма точная.
  const extra = actions(() => assert.fail("no"));
  assert.equal((await extra.removeReportLinkAction(idle, form({ request_id: REQ, report_key: "finance", expected_version: "3", embed: "x" }))).status, "invalid");
});

/* ------------------------------------------------------------------ страницы */

const guardsFor = (actor, calls = []) => ({ requireV3PageActor: async (route) => { calls.push(route); return actor; } });
const configured = { status: "available", link: { reportKey: "finance", configured: true, reportId: REPORT, pageId: PAGE, version: 3, updatedAt: "2026-10-27T09:32:00.000000+00:00" } };
const notConnected = { status: "available", link: { reportKey: "finance", configured: false, reportId: null, pageId: null, version: 0, updatedAt: null } };
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

async function financePage(actor, readResult) {
  const reads = [];
  const load = loader({
    "@/lib/platform-guards": guardsFor(actor),
    "@/lib/v3/report-links-source": { readReportLink: async (a, key) => { reads.push([a === actor, key]); return readResult; } },
  });
  const html = renderToStaticMarkup(await load("src/app/(v3)/v3/finance/page.tsx").default());
  return { html, reads };
}

test("«Финансы», not connected: an honest empty state, different words for the Admin (a link to the settings) and the accountant; nothing invented", async () => {
  const adminPage = await financePage(admin, notConnected);
  assert.deepEqual(adminPage.reads, [[true, "finance"]]);
  assert.match(adminPage.html, /<h1 class="t-page-title[^>]*>Финансы<\/h1>/u);
  assert.match(adminPage.html, /Отчёт ещё не подключён\./u);
  assert.match(adminPage.html, /<a [^>]*href="\/v3\/settings\?section=reports"[^>]*>Добавить ссылку<\/a>/u);
  assert.match(adminPage.html, /Цифры — из Google Таблицы финансиста, а не из CRM\./u, "the source is named");
  const accountantPage = await financePage(accountant, notConnected);
  assert.match(accountantPage.html, /Отчёт ещё не подключён\./u);
  assert.match(accountantPage.html, /Ссылку добавляет администратор\./u);
  assert.doesNotMatch(accountantPage.html, /Добавить ссылку|\/v3\/settings/u);
  for (const { html } of [adminPage, accountantPage]) {
    assert.doesNotMatch(text(html), /\d/u, "no numbers: CRM invents no figures");
    assert.doesNotMatch(html, /<(?:iframe|form|input|select|table|canvas)\b/u);
    assert.doesNotMatch(html, /Открыть в новой вкладке/u);
  }
});

test("«Финансы», connected: the window block with the exact address, the new-tab link with rel noopener noreferrer and the access hint; the reminder only for the Admin", async () => {
  const adminPage = await financePage(admin, configured);
  assert.match(adminPage.html, /<h2[^>]*>Отчёт Looker Studio<\/h2>/u);
  const link = /<a [^>]*href="([^"]+)"[^>]*>/u.exec(adminPage.html.slice(adminPage.html.indexOf("Отчёт Looker Studio")));
  assert.equal(link?.[1], OPEN(REPORT, PAGE));
  assert.match(adminPage.html, /<a [^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>|<a [^>]*rel="noopener noreferrer"[^>]*target="_blank"[^>]*>/u);
  assert.match(adminPage.html, /aria-label="Открыть в новой вкладке: отчёт Looker Studio"/u, "the accessible name starts with the visible words");
  assert.match(adminPage.html, /Отчёт виден только тем Google-аккаунтам, которым его открыли\./u);
  assert.match(adminPage.html, /В Safari и на iPhone отчёт обычно открывается только так\./u);
  assert.match(adminPage.html, /data-testid="v3-looker-phone"/u);
  assert.match(adminPage.html, /Отчёт удобнее открыть отдельно/u);
  assert.doesNotMatch(adminPage.html, /<iframe/u, "the server never draws the window: it is mounted on the client from 768 px");
  assert.match(adminPage.html, /Снятие роли в CRM не закрывает отчёт: когда человек уходит, уберите его в «Поделиться» отчёта и таблицы\./u);
  const accountantPage = await financePage(accountant, configured);
  assert.match(accountantPage.html, /Отчёт Looker Studio/u);
  assert.doesNotMatch(accountantPage.html, /Снятие роли в CRM|Поделиться/u, "the accountant does not hand out access: no reminder");
  assert.doesNotMatch(accountantPage.html, /\/v3\/settings/u);
});

test("«Финансы»: a refusal of the database shows «Нет доступа» with no window and no address; a failed read says so and offers «Обновить»", async () => {
  const denied = await financePage(accountant, { status: "denied" });
  assert.match(denied.html, /Нет доступа к отчёту «Финансы»: нужно право «Полный просмотр финансов» на всю организацию\./u);
  assert.doesNotMatch(denied.html, /lookerstudio|google\.com|<iframe|Открыть в новой вкладке|Отчёт Looker Studio/u);
  const failed = await financePage(admin, { status: "unavailable" });
  assert.match(failed.html, /Не удалось прочитать настройку отчёта\./u);
  assert.match(failed.html, /<a [^>]*href="\/v3\/finance"[^>]*>(?:(?!<\/a>).)*Обновить<\/a>/u);
  assert.doesNotMatch(failed.html, /lookerstudio|<iframe|Открыть в новой вкладке|Добавить ссылку/u);
  // Идентификатор, который не годится для адреса, окна не даёт (даже если бы строка базы такое хранила).
  const bad = await financePage(admin, { status: "available", link: { ...configured.link, reportId: 'abcdefgh"><script>' } });
  assert.doesNotMatch(bad.html, /lookerstudio|<script|<iframe|Открыть в новой вкладке/u);
  assert.match(bad.html, /Не удалось прочитать настройку отчёта\./u);
  assert.match(read("src/app/(v3)/v3/finance/page.tsx"), /await requireV3PageActor\("\/v3\/finance"\);/u);
});

const PERIOD = { key: "month", from: "2026-10-01", to: "2026-10-31", today: "2026-10-27", title: "Октябрь" };
async function marketingPage(readResult, query = {}) {
  const calls = [], spies = [];
  const spy = (name) => async () => { spies.push(name); return { status: "unavailable" }; };
  const load = loader({
    "@/lib/platform-guards": guardsFor(admin, calls),
    "@/lib/v3/marketing-source": {
      readMarketingOverview: spy("overview"), readMarketingLeads: spy("leads"), readMarketingRecent: async () => { spies.push("recent"); return null; },
      requireMarketingAdmin: () => undefined,
    },
    "@/lib/v3/report-links-source": { readReportLink: async (_actor, key) => { spies.push(`report:${key}`); return readResult; } },
    "@/lib/v3/funnel-source": { PERIODS: [{ key: "month", title: "Месяц" }, { key: "custom", title: "Свой" }], resolvePeriod: () => PERIOD, periodLabel: () => "Октябрь 2026" },
    "@/components/v3/marketing/MarketingOverviewView": { MarketingOverviewView: () => createElement("div", { "data-stub": "overview" }) },
    "@/components/v3/marketing/MarketingLeadsView": { MarketingLeadsView: () => createElement("div", { "data-stub": "leads" }) },
    "@/components/v3/MainHeader": { MainHeader: () => createElement("div", { "data-stub": "period" }) },
  });
  const html = renderToStaticMarkup(await load("src/app/(v3)/v3/marketing/page.tsx").default({ searchParams: Promise.resolve(query) }));
  return { html, spies, calls };
}
const tabs = (html) => [...html.matchAll(/<a [^>]*href="(\/v3\/marketing[^"]*)"[^>]*>([^<]*)/gu)].map((match) => [match[1], match[2].trim()]);

test("«Маркетинг → Отчёты»: the tab is drawn only when a link is connected; an unconnected or unreadable link draws no tab", async () => {
  const marketingConnected = { status: "available", link: { ...configured.link, reportKey: "marketing" } };
  const withTab = await marketingPage(marketingConnected);
  assert.deepEqual(tabs(withTab.html).map((tab) => tab[1]).filter((label) => ["Обзор", "Заявки", "Отчёты"].includes(label)), ["Обзор", "Заявки", "Отчёты"]);
  assert.ok(tabs(withTab.html).some(([href, label]) => label === "Отчёты" && href === "/v3/marketing?view=reports"));
  for (const read of [{ status: "available", link: { ...notConnected.link, reportKey: "marketing" } }, { status: "unavailable" }, { status: "denied" }]) {
    const without = await marketingPage(read);
    assert.equal(tabs(without.html).some(([, label]) => label === "Отчёты"), false, JSON.stringify(read).slice(0, 50));
    assert.deepEqual(without.spies.filter((name) => name === "report:marketing"), ["report:marketing"], "the link is read on every view");
  }
  // Обычный вид читает обзор, период стоит в шапке.
  assert.deepEqual(withTab.spies.sort(), ["overview", "recent", "report:marketing"]);
  assert.match(withTab.html, /data-stub="period"/u);
  assert.match(withTab.html, /Октябрь 2026/u);
});

test("«Маркетинг → Отчёты» (`?view=reports`): no overview and no lead reads, no period, the address is just the view, the window block with the source line", async () => {
  const marketingConnected = { status: "available", link: { ...configured.link, reportKey: "marketing" } };
  const page = await marketingPage(marketingConnected, { view: "reports", period: "week", channel: "instagram" });
  assert.deepEqual(page.spies, ["report:marketing"], "neither readMarketingOverview, Recent nor Leads is called");
  assert.deepEqual(page.calls, ["/v3/marketing"]);
  assert.doesNotMatch(page.html, /data-stub="period"|data-stub="overview"|data-stub="leads"|Октябрь 2026/u, "no period and no period label");
  assert.match(page.html, /Данные Meta Ads и Instagram приходят из Windsor\.ai\. Цена заявки и договора — во вкладке «Обзор»\./u);
  assert.match(page.html, /<h2[^>]*>Отчёт Looker Studio<\/h2>/u);
  assert.match(page.html, new RegExp(`href="${OPEN(REPORT, PAGE).replaceAll(".", "\\.")}"`, "u"));
  assert.doesNotMatch(page.html, /Снятие роли в CRM/u, "the reminder lives in the settings and on «Финансы», not here");
  const direct = await marketingPage({ status: "available", link: { ...notConnected.link, reportKey: "marketing" } }, { view: "reports" });
  assert.match(direct.html, /Отчёт ещё не подключён\./u);
  assert.match(direct.html, /<a [^>]*href="\/v3\/settings\?section=reports"[^>]*>Добавить ссылку<\/a>/u);
  assert.equal(tabs(direct.html).some(([, label]) => label === "Отчёты"), false);
  assert.deepEqual(direct.spies, ["report:marketing"]);
  const broken = await marketingPage({ status: "unavailable" }, { view: "reports" });
  assert.match(broken.html, /Не удалось прочитать настройку отчёта\./u);
  assert.match(broken.html, /href="\/v3\/marketing\?view=reports"/u);
  assert.match(read("src/app/(v3)/v3/marketing/page.tsx"), /requireV3PageActor\("\/v3\/marketing"\);\s*requireMarketingAdmin\(actor\);/u, "the access rule did not move");
});

test("the marketing address and tabs: the new view is `reports`, it writes neither period nor filters, the others are as before", () => {
  assert.equal(parseMarketingView("reports"), "reports");
  assert.equal(parseMarketingView("leads"), "leads");
  assert.equal(parseMarketingView("unknown"), "overview");
  assert.equal(parseMarketingView(undefined), "overview");
  assert.deepEqual(MARKETING_VIEWS.map((tab) => [tab.key, tab.title]), [["overview", "Обзор"], ["leads", "Заявки"], ["reports", "Отчёты"]]);
  assert.equal(marketingHref({ view: "reports", period: { key: "week" }, filters: undefined }), "/v3/marketing?view=reports");
  assert.equal(marketingHref({ view: "reports", period: { key: "custom", from: "2026-10-01", to: "2026-10-05" } }), "/v3/marketing?view=reports");
  assert.equal(marketingHref({ view: "overview", period: { key: "month" } }), "/v3/marketing");
  assert.equal(marketingHref({ view: "leads", period: { key: "week" }, filters: undefined }), "/v3/marketing?view=leads&period=week");
});

/* ------------------------------------------------------------------ «Настройки → Отчёты» */

function settingsSection(reads, readOnly) {
  const load = loader({ "@/lib/platform-report-link-actions": { saveReportLinkAction: async () => idle, removeReportLinkAction: async () => idle } });
  return renderToStaticMarkup(createElement(load("src/components/v3/settings/ReportLinksSection.tsx").ReportLinksSection, { reads, readOnly }));
}
const settingsReads = {
  marketing: { status: "available", link: { ...configured.link, reportKey: "marketing", version: 2 } },
  finance: { status: "available", link: { ...notConnected.link } },
};

test("«Настройки → Отчёты»: two cards with the state word; the connected one shows its time and «Открыть раздел»; no identifier is printed", () => {
  const html = settingsSection(settingsReads, false);
  assert.match(html, /data-testid="v3-report-card-marketing"/u);
  assert.match(html, /data-testid="v3-report-card-finance"/u);
  assert.match(html, /Подключён · изменён 27\.10, 15:32/u, "Asia/Bishkek time of the change");
  assert.match(html, /Не подключён/u);
  assert.match(html, /<a [^>]*href="\/v3\/marketing\?view=reports"[^>]*>Открыть раздел<\/a>/u);
  assert.doesNotMatch(html, /href="\/v3\/finance"/u, "an unconnected report has no «Открыть раздел»");
  assert.equal([...html.matchAll(/<textarea/gu)].length, 2);
  assert.equal([...html.matchAll(/Код или ссылка для встраивания из Looker Studio/gu)].length, 2);
  assert.equal([...html.matchAll(/Looker Studio → Файл → Встроить отчёт → Включить встраивание → скопировать код\./gu)].length, 2);
  assert.equal([...html.matchAll(/>Сохранить<\/button>/gu)].length, 2);
  assert.equal([...html.matchAll(/>Убрать отчёт<\/button>/gu)].length, 1, "«Убрать отчёт» only where a report is connected");
  assert.doesNotMatch(html, new RegExp(`${REPORT}|${PAGE}|lookerstudio|google\\.com`, "u"), "no identifier and no address in the settings");
  assert.match(html, /<input type="hidden" name="expected_version" value="2"\/>/u, "the version the person saw (marketing)");
  assert.match(html, /<input type="hidden" name="expected_version" value="0"\/>/u, "version 0 = no row yet (finance)");
  assert.match(html, /CRM не видит настройки доступа в Google\. Отчёт должен быть открыт только нужным людям: проверьте ссылку в окне инкогнито — она должна просить вход\. Снятие роли в CRM не закрывает отчёт в Google: когда человек уходит, сначала уберите его в «Поделиться» отчёта и таблицы\./u);
  assert.doesNotMatch(html, /Нужна ссылка Looker Studio/u, "no error is shown before an attempt");
});

test("«Настройки → Отчёты» in role preview: only the state lines — no field, no button, no hidden form, no identifier, no link to the sections", () => {
  const html = settingsSection(settingsReads, true);
  assert.match(html, /Подключён · изменён 27\.10, 15:32/u);
  assert.match(html, /Не подключён/u);
  assert.match(html, /В режиме просмотра роли ссылки не меняются\./u);
  assert.doesNotMatch(html, /<(?:textarea|form|input|button)\b/u);
  assert.doesNotMatch(html, new RegExp(`${REPORT}|${PAGE}|lookerstudio|Открыть раздел|Сохранить|Убрать отчёт|Снятие роли`, "u"));
});

test("«Настройки → Отчёты»: a failed read says so and offers «Обновить» instead of a form that could save over an unknown version", () => {
  const html = settingsSection({ marketing: { status: "unavailable" }, finance: { status: "denied" } }, false);
  assert.equal([...html.matchAll(/Не удалось прочитать настройку отчёта\./gu)].length, 2);
  assert.equal([...html.matchAll(/>Обновить<\/a>/gu)].length, 2);
  assert.doesNotMatch(html, /<(?:textarea|form|button)\b/u);
});

test("settings wiring: the section is listed after «Телефония», the page reads both links only in its own section and passes the preview flag; the actions never trust the form", () => {
  const types = read("src/components/v3/settings/types.ts");
  const keys = [...types.matchAll(/\{ key: "([a-z]+)", view: (?:"[a-z]+"|null), title: "([^"]+)" \}/gu)].map((match) => `${match[1]}:${match[2]}`);
  assert.ok(keys.indexOf("reports:Отчёты") === keys.indexOf("telephony:Телефония") + 1);
  const page = read("src/app/(v3)/v3/settings/page.tsx");
  assert.match(page, /section === "reports"\s*\?\s*Promise\.all\(\[readReportLink\(actor, "marketing"\), readReportLink\(actor, "finance"\)\]\)/u);
  assert.match(page, /reportsReadOnly=\{isStaffPreview\(actor\)\}/u);
  assert.match(read("src/components/v3/settings/Settings.tsx"), /current\.key === "reports" && reports \? <ReportLinksSection reads=\{reports\} readOnly=\{reportsReadOnly \?\? false\} \/>/u);
  const action = read("src/lib/platform-report-link-actions.ts");
  assert.match(action, /^"use server";/u);
  assert.ok(action.indexOf("isStaffPreview(actor)") < action.indexOf("parseLookerEmbedInput("), "preview is refused before the code is even parsed");
  assert.match(action, /actor\.systemRole !== "admin"/u);
  assert.match(action, /export async function saveReportLinkAction/u);
  assert.match(action, /export async function removeReportLinkAction/u);
  const form = read("src/components/v3/settings/ReportLinkForm.tsx");
  assert.match(form, /startTransition\(\(\) => action\(form\)\)/u, "the field stays in the form: React 19 would reset a plain <form action>");
  assert.match(form, /name="embed"/u);
  assert.doesNotMatch(form, /innerHTML|dangerouslySetInnerHTML|<iframe/u);
});

/* ------------------------------------------------------------------ окно отчёта */

test("the window: the server never draws the iframe; on a wide screen the client draws exactly the template address with the strict rights and referrer", () => {
  const stub = { ...require("react"), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
  const frameWith = (matches) => {
    globalThis.window = { matchMedia: () => ({ matches, addEventListener() {}, removeEventListener() {} }) };
    try {
      const { LookerFrame } = loader({ react: stub })("src/components/v3/reports/LookerFrame.tsx");
      return renderToStaticMarkup(createElement(LookerFrame, { src: EMBED(REPORT, PAGE), title: "Отчёт Looker Studio: Финансы", openUrl: OPEN(REPORT, PAGE) }));
    } finally { delete globalThis.window; }
  };
  const wide = frameWith(true);
  const iframe = /<iframe\b[^>]*>/u.exec(wide)?.[0] ?? assert.fail("a wide screen draws the window");
  assert.match(iframe, new RegExp(`src="${EMBED(REPORT, PAGE).replaceAll(".", "\\.")}"`, "u"));
  assert.match(iframe, /title="Отчёт Looker Studio: Финансы"/u);
  assert.match(iframe, /loading="lazy"/u);
  assert.match(iframe, /referrerPolicy="strict-origin-when-cross-origin"|referrerpolicy="strict-origin-when-cross-origin"/iu);
  assert.match(iframe, new RegExp(`sandbox="${LOOKER_FRAME_SANDBOX}"`, "u"));
  assert.doesNotMatch(iframe, /allow-popups-to-escape-sandbox|allow-top-navigation/u);
  assert.match(iframe, /allowFullScreen=""|allowfullscreen=""/iu);
  assert.equal([...wide.matchAll(/<iframe/gu)].length, 1);
  assert.match(wide, /data-testid="v3-looker-phone"/u, "the phone card is in the markup and hidden by CSS from 768 px");
  const narrow = frameWith(false);
  assert.doesNotMatch(narrow, /<iframe/u, "a phone loads no Google page");
  assert.match(narrow, /Отчёт удобнее открыть отдельно/u);
  assert.match(narrow, /target="_blank"/u);
  assert.match(narrow, /rel="noopener noreferrer"/u);
  assert.match(read("src/components/v3/reports/LookerFrame.tsx"), /sandbox=\{LOOKER_FRAME_SANDBOX\}/u);
});

test("the window: «Отчёт загружается…» shows under a transparent frame and goes away on the frame's load", () => {
  const jsxRuntime = require("react/jsx-runtime");
  const frames = [];
  const runtime = {
    ...jsxRuntime,
    jsx: (type, props, key) => { if (type === "iframe") frames.push(props); return jsxRuntime.jsx(type, props, key); },
    jsxs: (type, props, key) => { if (type === "iframe") frames.push(props); return jsxRuntime.jsxs(type, props, key); },
  };
  const render = (loaded, setLoaded = () => {}) => {
    frames.length = 0;
    const stub = { ...require("react"), useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(), useState: () => [loaded, setLoaded] };
    globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
    try {
      const { LookerFrame } = loader({ react: stub, "react/jsx-runtime": runtime })("src/components/v3/reports/LookerFrame.tsx");
      return renderToStaticMarkup(createElement(LookerFrame, { src: EMBED(REPORT, PAGE), title: "Отчёт Looker Studio: Финансы", openUrl: OPEN(REPORT, PAGE) }));
    } finally { delete globalThis.window; }
  };
  const loading = render(false);
  assert.match(loading, /Отчёт загружается…/u, "before the frame's load the caption is in the window");
  const iframe = /<iframe\b[^>]*>/u.exec(loading)?.[0] ?? assert.fail("a wide screen draws the window");
  assert.ok(loading.indexOf("Отчёт загружается…") < loading.indexOf("<iframe"), "the caption stands first and the frame is drawn over it");
  assert.doesNotMatch(iframe, /\bbg-/u, "an opaque frame background would paint over the caption, drawn earlier in the same layer");
  const settings = [];
  render(false, (value) => settings.push(value));
  assert.equal(frames.length, 1);
  assert.equal(typeof frames[0].onLoad, "function", "the frame reports its load");
  frames[0].onLoad();
  assert.deepEqual(settings, [true], "the load marks the window as loaded");
  const loaded = render(true);
  assert.doesNotMatch(loaded, /Отчёт загружается…/u, "after the load the caption is gone: it does not linger behind a transparent report");
  assert.match(loaded, /<iframe\b/u, "the frame itself stays");
});

/* ------------------------------------------------------------------ меню в layout */

test("the layout computes `financeSection` next to the existing reads and hands it to the shell; a failed read hides the item", async () => {
  const shellProps = [];
  const reads = [];
  const make = (actor, finance) => loader({
    "./v3.css": {}, "./ai-agent.css": {},
    "@/components/ServerReleaseMark": { ServerReleaseMark: () => null },
    "@/components/v3/AppShell": { AppShell: (props) => { shellProps.push(props); return null; } },
    "@/lib/platform-guards": { requirePlatformStaffActor: async () => actor },
    "@/lib/release-metadata": { readReleaseMetadata: () => ({ status: "unavailable" }) },
    // «Новый вид» (27.10.2026): cookie читает `isNextUi`; здесь он выключен — переключатель только у настоящего администратора.
    "@/lib/ui-next": { isNextUi: async () => false },
    "@/lib/v3/account-deletion-source": { readOpenAccountDeletionCount: async () => null },
    "@/lib/v3/staff-notification-source": { readStaffNotificationsForActor: async () => null },
    "@/lib/v3/report-links-source": { readFinanceSectionAccess: async (a) => { reads.push(a === actor); return finance(); } },
  })("src/app/(v3)/layout.tsx").default;
  for (const [actor, result, expected] of [[admin, () => true, true], [accountant, () => true, true], [accountant, () => false, false]]) {
    shellProps.length = 0;
    const tree = await make(actor, result)({ children: null });
    const shell = tree.props.children[0];
    assert.equal(shell.props.financeSection, expected);
    assert.equal(shell.props.actor, actor);
    assert.deepEqual(shell.props.nextUi, actor === admin ? { enabled: false } : null, "переключатель «Нового вида» есть только у настоящего администратора");
    void shellProps;
  }
  // Ошибка чтения не роняет страницу: пункт скрыт.
  const failing = await make(accountant, () => { throw new Error("rpc down"); })({ children: null });
  assert.equal(failing.props.children[0].props.financeSection, false);
  assert.ok(reads.length >= 4);
  const layout = read("src/app/(v3)/layout.tsx");
  assert.match(layout, /const \[notifications, deletionRequests, financeSection\] = await Promise\.all\(\[/u, "one parallel batch with the existing reads");
  assert.match(layout, /financeSection=\{financeSection\}/u);
  const shell = read("src/components/v3/AppShell.tsx");
  assert.match(shell, /buildV3Navigation\(actor, pathname, query, \{ financeSection \}\)/u);
  assert.match(shell, /financeSection\?: boolean;/u);
});

/* ------------------------------------------------------------------ документы и общая гигиена */

test("the runbooks carry the frame-src line for the future CSP and the leaving-employee steps; the live edge file is not part of this slice", () => {
  const map = read("docs/runbooks/infrastructure-map.md");
  assert.match(map, /frame-src[^\n]*'self' blob: https:\/\/lookerstudio\.google\.com https:\/\/docs\.evoadmissions\.com/u);
  assert.match(map, /Report-Only/u);
  const team = read("docs/runbooks/team-workspace-activation.md");
  assert.match(team, /Уход сотрудника: внешние доступы/u);
  assert.match(team, /\*\*сначала Google,\s+потом CRM\*\*/u, "Google first, then the CRM");
  assert.match(team, /Убрать человека из «Поделиться» обоих отчётов и таблицы-источника/u);
  const edge = read("agent-lead2-inbox/deploy/Caddyfile.evo-edge");
  assert.doesNotMatch(edge, /lookerstudio|frame-src/u, "the edge file is untouched: no live edge change in this slice");
});

test("the repository is public: no real-looking report identifier or Google address is committed in the files of this slice", () => {
  const allowed = new Set([GOOGLE_REPORT, GOOGLE_PAGE, REPORT, PAGE, UUID_REPORT, "p_synthetic1", "p_page_2", "short", "abcdefgh", "REPORT", "{id}", "{reportId}", "{отчёт}", "{страница}", "{page}"]);
  const files = [
    "src/lib/looker-report-link.ts", "src/lib/report-link-contract.ts", "src/lib/v3/report-links-source.ts", "src/lib/platform-report-link-actions.ts",
    "src/components/v3/reports/LookerReport.tsx", "src/components/v3/reports/LookerFrame.tsx",
    "src/components/v3/settings/ReportLinkForm.tsx", "src/components/v3/settings/ReportLinksSection.tsx",
    "supabase/migrations/323_platform_report_links.sql", "supabase/tests/platform_report_links.sql", "tests/looker-reports.test.mjs",
    "docs/runbooks/infrastructure-map.md", "docs/runbooks/team-workspace-activation.md",
  ];
  const address = /(?:looker|data)studio\.google\.com\/(?:u\/\d+\/)?(?:embed\/)?(?:u\/\d+\/)?reporting\/([^\s"'`)<>?#/]+)/gu;
  for (const file of files) {
    const source = read(file);
    for (const match of source.matchAll(address)) {
      const id = match[1];
      assert.ok(allowed.has(id) || id.startsWith("abcdefgh") || /^[{$]/u.test(id) || id.includes("${"), `${file}: a report address with the identifier "${id}"`);
    }
    assert.doesNotMatch(source, /[A-Za-z0-9._%+-]+@gmail\.com/u, `${file}: no Google address of a person`);
  }
});
