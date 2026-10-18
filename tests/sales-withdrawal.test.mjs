import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSalesRegisterRow,
  parseSalesRegisterWorkspace,
} from "../src/lib/platform-sales-register-contract.ts";
import {
  salesMoneySummary,
  salesRowNoRemainder,
  salesRowRemainder,
  salesSummaryBasis,
  salesWithdrawalTone,
} from "../src/lib/sales-register-view.ts";
import { parseSalesWithdrawalNote, parseSalesWithdrawalReceipt } from "../src/lib/sales-withdrawal-contract.ts";
import { salesWithdrawalChoice, salesWithdrawalMessage, salesWithdrawalSaved, salesWithdrawalWord } from "../src/lib/v3/wording.ts";

/**
 * «Убрать» продажу с отметкой отказа (слова владельца 18.10, миграция 307). Чистая логика и
 * разбор ответов проверяются напрямую, разметка — статическим рендером
 * `tests/e2e/numbers-static-render.cjs --json-307` на синтетических данных, контраст — расчётом
 * по токенам `v3.css`. Это не живая проверка прав и данных: их проверяют SQL-набор
 * `supabase/tests/platform_sales_report_withdrawal.sql` и сквозной прогон на локальном Supabase.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const organizationId = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------- разбор строки v3 и ответа v5

const baseRow = (fields = {}) => ({
  id: "33333333-3333-4333-8333-333333333333", version: "2", report_month: "2026-09-01", signing_date: "2026-09-03",
  applicant_name: "Синтетический студент", phone: "", country: "", university: "", program: "", direction: "", intake: "",
  contract_number: "", manager_label: "Менеджер", status_raw: "", owner_membership_id: null, service_cost_raw: "1800",
  service_cost_minor: "180000", service_cost_currency: "USD", paid_raw: "900", paid_minor: "90000", paid_currency: "USD",
  needs_review: false, notes: "", archived: false, source_kind: "manual", lead_id: null, client_id: null, source_key: null,
  source_sha256: null, source_sheet: null, source_row: null, updated_at: "2026-09-28T05:00:00.000Z",
  paid_contract: null, review_reasons: [], import_flags: [], manager_key: "менеджер", withdrawal: null, ...fields,
});
const withdrawal = (fields = {}) => ({ kind: "partial", at: "2026-10-18T05:00:00.000Z", by: "Синтетический менеджер", note: "ушёл после первого платежа", ...fields });
const workspace = (fields = {}) => ({ query: null, manager_key: null, organization_id: organizationId, year: 2026, month: 9,
  total_count: 0, rows: [], selected: null, offset: 0, has_more: false, totals: [],
  unresolved_cost_count: 0, unresolved_paid_count: 0, targets: [], manager_options: [], owner_options: [],
  withdrawn: { count: 0, paid: [] }, ...fields });

test("row v3 decoder: the mark is null or exactly {kind, at, by, note}", () => {
  assert.equal(parseSalesRegisterRow(baseRow()).withdrawal, null);
  const marked = parseSalesRegisterRow(baseRow({ withdrawal: withdrawal() }));
  assert.deepEqual(marked.withdrawal, { kind: "partial", at: "2026-10-18T05:00:00.000Z", by: "Синтетический менеджер", note: "ушёл после первого платежа" });
  assert.equal(parseSalesRegisterRow(baseRow({ withdrawal: withdrawal({ kind: "unpaid", note: null }) })).withdrawal.note, null);
  const without = Object.fromEntries(Object.entries(baseRow()).filter(([key]) => key !== "withdrawal"));
  for (const bad of [without, baseRow({ withdrawal: undefined }), baseRow({ withdrawal: withdrawal({ kind: "other" }) }),
    baseRow({ withdrawal: withdrawal({ kind: undefined }) }), baseRow({ withdrawal: withdrawal({ at: "yesterday" }) }),
    baseRow({ withdrawal: withdrawal({ note: "" }) }), baseRow({ withdrawal: withdrawal({ note: "   " }) }),
    baseRow({ withdrawal: withdrawal({ note: "a\nb" }) }), baseRow({ withdrawal: withdrawal({ note: "x".repeat(501) }) }),
    baseRow({ withdrawal: withdrawal({ extra: 1 }) }), baseRow({ withdrawal: "partial" }), baseRow({ withdrawal: [] })]) {
    assert.throws(() => parseSalesRegisterRow(bad), /unavailable/);
  }
  assert.equal(parseSalesRegisterRow(baseRow({ withdrawal: withdrawal({ note: "я".repeat(500) }) })).withdrawal.note.length, 500);
});

test("read v5 decoder: `withdrawn` is {count, paid per currency} and agrees with the rows", () => {
  const ok = parseSalesRegisterWorkspace(workspace({ total_count: 3, withdrawn: { count: 2, paid: [{ currency: "KGS", paid_minor: "5000000" }, { currency: "USD", paid_minor: "0" }] } }), organizationId);
  assert.deepEqual(ok.withdrawn, { count: 2, paid: [{ currency: "KGS", paidMinor: 5000000 }, { currency: "USD", paidMinor: 0 }] });
  const rows = [baseRow({ withdrawal: withdrawal() }), baseRow({ id: "44444444-4444-4444-8444-444444444444" })];
  assert.equal(parseSalesRegisterWorkspace(workspace({ total_count: 2, rows, withdrawn: { count: 1, paid: [] } }), organizationId).rows[0].withdrawal.kind, "partial");
  const without = Object.fromEntries(Object.entries(workspace()).filter(([key]) => key !== "withdrawn"));
  const bad = [without, workspace({ withdrawn: null }), workspace({ withdrawn: { count: 0 } }), workspace({ withdrawn: { count: -1, paid: [] } }),
    workspace({ withdrawn: { count: 0, paid: [{ currency: "GBP", paid_minor: "1" }] } }),
    workspace({ withdrawn: { count: 0, paid: [{ currency: "USD", paid_minor: "1" }, { currency: "USD", paid_minor: "2" }] } }),
    workspace({ withdrawn: { count: 0, paid: [], extra: 1 } }),
    // Больше отказных записей, чем записей выборки, и отказных записей на странице больше, чем в сумме.
    workspace({ total_count: 1, withdrawn: { count: 2, paid: [] } }),
    workspace({ total_count: 2, rows, withdrawn: { count: 0, paid: [] } })];
  for (const value of bad) assert.throws(() => parseSalesRegisterWorkspace(value, organizationId), /unavailable/);
  // «Архив»: итогов нет (0), а архивная запись может нести прежнюю отметку.
  const archived = baseRow({ archived: true, withdrawal: withdrawal() });
  assert.equal(parseSalesRegisterWorkspace(workspace({ total_count: 1, rows: [archived], withdrawn: { count: 0, paid: [] } }), organizationId).rows[0].withdrawal.kind, "partial");
});

// ------------------------------------------------------------------ суммы и остаток без отказов

const row = (fields = {}) => parseSalesRegisterRow(baseRow(fields));

test("a refusal is no remainder and no part of the sums; its money stays in its own line", () => {
  const alive = row();
  const refused = row({ id: "55555555-5555-4555-8555-555555555555", withdrawal: withdrawal() });
  assert.equal(salesRowNoRemainder(alive), null);
  assert.equal(salesRowRemainder(alive), 90000);
  assert.equal(salesRowNoRemainder(refused), "withdrawn");
  assert.equal(salesRowRemainder(refused), null, "no debt is expected from a person who left");
  const summary = salesMoneySummary([alive, refused]);
  assert.deepEqual(summary.lines.map((line) => [line.currency, line.costMinor, line.paidMinor, line.remainderMinor, line.count]), [["USD", 180000, 90000, 90000, 1]],
    "cost, paid and remainder stay one arithmetic over the live records");
  assert.deepEqual([summary.noCost, summary.paidUnclear, summary.paidMissing, summary.cross.length], [0, 0, 0, 0],
    "a refusal is not counted among the unresolved either");
  // Архив сильнее отказа: архивная запись в рабочих итогах и так не стоит.
  assert.equal(salesRowNoRemainder(row({ archived: true, withdrawal: withdrawal() })), "archived");
  // Основа сумм считает только записи без отказа.
  const basis = salesSummaryBasis([alive, refused, row({ id: "66666666-6666-4666-8666-666666666666", signing_date: null })], { year: 2026, month: 9 });
  assert.deepEqual(basis, { total: 2, undated: 1, otherSaleDate: 0 });
});

test("kinds: partial is the amber tone, unpaid the red one; the words come only from wording.ts", () => {
  assert.equal(salesWithdrawalTone("partial"), "warn");
  assert.equal(salesWithdrawalTone("unpaid"), "danger");
  assert.equal(salesWithdrawalWord("partial"), "Отказ, оплачено частично");
  assert.equal(salesWithdrawalWord("unpaid"), "Отказ, без оплаты");
  assert.equal(salesWithdrawalChoice("partial"), "Оплатил частично");
  assert.equal(salesWithdrawalChoice("unpaid"), "Не оплатил");
  // Неизвестный ключ и служебные имена — не слова: null, сырой ключ не показывается.
  for (const value of ["withdrawn", "refused", "constructor", "__proto__", "", null, undefined]) {
    assert.equal(salesWithdrawalWord(value), null);
    assert.equal(salesWithdrawalChoice(value), null);
  }
  for (const status of ["invalid", "forbidden", "stale", "request_conflict", "archived", "unavailable"]) {
    assert.ok(salesWithdrawalMessage(status), status);
    assert.doesNotMatch(salesWithdrawalMessage(status), /_|PT409|42501/u, "no keys and codes on the screen");
  }
  assert.equal(salesWithdrawalMessage("saved"), null);
  assert.equal(salesWithdrawalMessage("idle"), null);
  // Итог читалке: что сохранено, словами; ключа операции на экране нет.
  assert.equal(salesWithdrawalSaved("withdraw"), "Запись убрана из продаж.");
  assert.equal(salesWithdrawalSaved("withdraw_undo"), "Запись возвращена в продажи.");
  for (const value of ["", "saved", "constructor", null, undefined]) assert.equal(salesWithdrawalSaved(value), null);
});

test("the command receipt and the note are read strictly", () => {
  const expected = { organizationId, recordId: "33333333-3333-4333-8333-333333333333", requestId: "77777777-7777-4777-8777-777777777777", expectedVersion: 2, operation: "withdraw" };
  const receipt = { organization_id: organizationId, record_id: expected.recordId, version: "3", operation: "withdraw", request_id: expected.requestId };
  assert.equal(parseSalesWithdrawalReceipt(receipt, expected), 3);
  assert.equal(parseSalesWithdrawalReceipt({ ...receipt, operation: "withdraw_undo" }, { ...expected, operation: "withdraw_undo" }), 3);
  for (const bad of [{ ...receipt, version: "2" }, { ...receipt, version: "4" }, { ...receipt, operation: "withdraw_undo" }, { ...receipt, request_id: organizationId },
    { ...receipt, record_id: organizationId }, { ...receipt, organization_id: expected.recordId }, { ...receipt, extra: 1 }, null, [], "x"]) {
    assert.equal(parseSalesWithdrawalReceipt(bad, expected), null);
  }
  assert.equal(parseSalesWithdrawalNote("  ушёл  "), "ушёл");
  assert.equal(parseSalesWithdrawalNote(""), "");
  for (const bad of ["a\nb", "a\u0000b", "x".repeat(501), 1, null, undefined]) assert.equal(parseSalesWithdrawalNote(bad), null);
});

// ------------------------------------------------------------------- границы источника и действия

test("the read, the command and the actions use cookie authority and the migration 307 objects only", () => {
  const source = read("src/lib/v3/sales-register-source.ts");
  const actions = read("src/lib/platform-sales-register-actions.ts");
  assert.match(source, /rpc\("read_sales_register_v5"/u);
  assert.doesNotMatch(source, /rpc\("read_sales_register_v[1234]"/u);
  assert.match(actions, /rpc\("set_sales_register_withdrawal_v1"/u);
  const action = actions.slice(actions.indexOf("export async function setSalesRegisterWithdrawalAction"), actions.indexOf("export async function saveSalesTargetAction"));
  assert.match(action, /requirePlatformStaffActor\(\)/u);
  assert.match(action, /staffHasPermission\(actor, "sales\.register\.manage"\) \|\| isStaffPreview\(actor\)/u);
  assert.match(action, /exactActionStringFields\(form, \["request_id", "record_id", "expected_version", "kind", "note"\]\)/u);
  assert.match(action, /p_expected_version: version/u);
  assert.match(action, /parseSalesWithdrawalReceipt\(data/u);
  assert.match(action, /error\.code === "PT409"\) return outcome\("stale"\)/u);
  assert.match(action, /revalidatePath\("\/v3\/main"\)/u);
  assert.doesNotMatch(source + action, /createSupabaseAdmin|SERVICE_ROLE|SECRET_KEY|\.from\(/u);
  // Service-only functions are not reachable from the application at all.
  for (const name of ["mark_sales_report_row_withdrawn_v1", "archive_sales_report_row_v1", "create_sales_report_student_case_v1"]) {
    assert.doesNotMatch(source + actions, new RegExp(name, "u"), `${name} is for the owner's data fixes, not for the interface`);
  }
});

test("the control is a form with a real action: radios, a note up to 500, the return is one press", () => {
  const control = read("src/components/v3/SalesWithdrawal.tsx");
  assert.match(control, /useActionState<SalesWithdrawalActionState, FormData>\(setSalesRegisterWithdrawalAction/u);
  assert.match(control, /name="expected_version" value=\{record\.version\}/u);
  assert.match(control, /name="request_id" value=\{state\.requestId\}/u);
  assert.match(control, /type="radio" name="kind" value=\{kind\} required/u);
  assert.match(control, /name="note" maxLength=\{500\}/u);
  assert.match(control, /popover="auto"/u, "a small popover, not a modal dialog");
  assert.doesNotMatch(control, /<dialog|showModal/u);
  assert.match(control, /router\.refresh\(\)/u);
  // Второй успех той же строки тоже закрывает окно и обновляет страницу: эффект стоит на объекте итога, не на слове статуса.
  assert.match(control, /\}, \[state, menu\.popoverId, router\]\);/u);
  // Кнопка меняется на другую и фокус теряется: итог — живой областью, которая остаётся на месте; окно выровнено влево.
  assert.match(control, /<span role="status" className="sr-only">\{saved\}<\/span>/u);
  assert.match(control, /bg-surface p-3 text-left text-fg/u);
  assert.match(control, /Вернуть/u);
  // Слова — из wording.ts, не по месту: ни слов видов, ни текстов ошибок в коде компонента (комментарии не в счёт).
  assert.doesNotMatch(control.replace(/\/\*[\s\S]*?\*\//gu, ""), /Оплатил частично|Не оплатил|Нет доступа|Запись изменил/u);
  assert.doesNotMatch(control, /#[0-9a-f]{3,8}\b/iu, "tokens, not hex colours");
});

// -------------------------------------------------------------------------- токены: контраст

const css = read("src/app/(v3)/v3.css");
const token = (name) => {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "u").exec(css);
  assert.ok(match, `${name} is defined`);
  return match[1];
};
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((index) => channel(Number.parseInt(hex.slice(index, index + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test("contrast of the two refusal tones is calculated from the tokens, not assumed", () => {
  const surface = token("--surface");
  const desk = /\[data-surface="staff"\]\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]{6})/u.exec(css)?.[1];
  assert.ok(desk, "the staff desk colour");
  const surface2 = token("--surface-2");
  for (const [tone, text, ground] of [["warn", token("--warn"), token("--warn-weak")], ["danger", token("--danger"), token("--danger-weak")]]) {
    // Текст чипа на своей подложке — не меньше 4,5:1 (WCAG 1.4.3); чип стоит на листе и на выбранной строке.
    assert.ok(contrast(text, ground) >= 4.5, `${tone}: chip text on its own ground ${contrast(text, ground).toFixed(2)}`);
    for (const [name, row] of [["sheet", surface], ["desk", desk], ["hover and selected row", surface2]]) {
      // Ребро строки - графический объект: не меньше 3:1 к строке под ним (WCAG 1.4.11).
      assert.ok(contrast(text, row) >= 3, `${tone}: edge on ${name} ${contrast(text, row).toFixed(2)}`);
    }
  }
  // Два тона различимы не только по цвету: у каждого свой текст чипа (слова проверены выше).
  assert.notEqual(token("--warn"), token("--danger"));
});

// -------------------------------------------------------------------- разметка: статический рендер

const pages = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/numbers-static-render.cjs", import.meta.url)), "--json-307"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((page) => [page.name, page.html]));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
const rowOf = (html, name) => {
  const start = html.lastIndexOf("<tr", html.indexOf(`>${name}<`));
  return html.slice(start, html.indexOf("</tr>", start));
};

test("rendered report: a refused row keeps its place with a word chip, an edge in its tone and «Вернуть»", () => {
  const html = pages.get("report");
  assert.equal(html.match(/<h1\b/gu)?.length, 1);
  const partial = rowOf(html, "Данияр Макетов");
  const unpaid = rowOf(html, "Эльвира Шаблонова");
  assert.match(partial, /data-withdrawn="partial"/u);
  assert.match(unpaid, /data-withdrawn="unpaid"/u);
  assert.match(partial, /<span class="v3-chip t-caption" data-tone="warn" data-size="sm" data-wrap="">Отказ, оплачено частично<\/span>/u);
  assert.match(unpaid, /<span class="v3-chip t-caption" data-tone="danger" data-size="sm" data-wrap="">Отказ, без оплаты<\/span>/u);
  // Ребро — левая граница в цвете токена тона, заливки у строки и у её ячеек нет.
  assert.match(partial, /\[--sale-edge:var\(--warn\)\]/u);
  assert.match(unpaid, /\[--sale-edge:var\(--danger\)\]/u);
  assert.match(partial, /shadow-\[inset_3px_0_0_0_var\(--sale-edge\)\]/u);
  for (const refused of [partial, unpaid]) {
    assert.doesNotMatch(refused, /(?<![\w:-])bg-(?:warn|danger)(?:-weak)?(?![\w-])/u, "no tinted row");
    assert.match(refused, /bg-surface/u);
    assert.match(refused, /data-no-remainder="withdrawn"/u, "no remainder is expected from a refusal");
  }
  assert.match(partial, /aria-label="Вернуть в продажи: Данияр Макетов"[^>]*>Вернуть</u);
  assert.match(unpaid, /aria-label="Вернуть в продажи: Эльвира Шаблонова"[^>]*>Вернуть</u);
  // Живая запись — «Убрать» с маленьким окном; чипа и ребра у неё нет.
  const alive = rowOf(html, "Алина Переданная");
  assert.doesNotMatch(alive, /data-withdrawn|--sale-edge|v3-chip/u);
  assert.match(alive, /aria-label="Убрать из продаж: Алина Переданная"[^>]*>Убрать</u);
  assert.match(alive, /popover="auto"/u);
  assert.match(alive, /<input type="radio"[^>]*name="kind" value="partial"/u);
  assert.match(alive, /<input type="radio"[^>]*name="kind" value="unpaid"/u);
  assert.equal(alive.match(/<input type="radio"[^>]* required=""/gu)?.length, 2, "a kind must be chosen");
  assert.match(alive, /<input type="text"[^>]*maxLength="500"[^>]*name="note"|<input type="text"[^>]*name="note"[^>]*maxLength="500"/u);
  // Столбец действия — один, с читаемым заголовком; сплошного красного по-прежнему один.
  assert.match(html, /<th role="columnheader" scope="col" class="[^"]*"><span class="sr-only">Действие<\/span><\/th>/u);
});

test("rendered report: «Продажи» and the sums stand on records without a refusal, the refusal has its own line", () => {
  const html = pages.get("report");
  // 7 записей месяца в суммах (9 в таблице, 2 отказные): «Продажи» без отказов считает сервер, сумма — здесь.
  assert.match(html, /data-money-basis="7">Суммы по 7 записям месяца отчёта, из них 1 без даты продажи</u);
  const line = html.slice(html.indexOf('data-testid="sales-withdrawn-summary"'), html.indexOf("</p>", html.indexOf('data-testid="sales-withdrawn-summary"')));
  assert.match(line, /data-withdrawn-count="2"/u);
  assert.match(text(line), /Отказ — 2 записи; по ним оплачено 50 000 KGS\. В продажи и суммы ниже они не входят\./u);
  assert.ok(html.indexOf('data-testid="sales-withdrawn-summary"') < html.indexOf('data-testid="sales-money-table"'), "named above the table of sums");
  // Суммы по валютам — без денег отказных записей: USD 8 500 / 5 800 / 2 700, KGS в сумме нет (она у отказа).
  const table = text(html.slice(html.indexOf('data-testid="sales-money-table"'), html.indexOf("</table>", html.indexOf('data-testid="sales-money-table"'))));
  assert.match(table, /USD 8 500 5 800 2 700/u);
  assert.doesNotMatch(table, /KGS 120 000|KGS 50 000|120 000 KGS/u);
  assert.match(table, /USD → KGS : стоимость в USD, оплата в KGS, 1 запись 1 800 USD 45 000 KGS/u, "a live cross-currency record is untouched");
});

test("rendered panel: the refusal is told once with the word, the date, who removed it and the note; «Вернуть» next to «Исправить запись»", () => {
  const partial = pages.get("report-panel-partial");
  const panel = partial.slice(partial.indexOf("<dialog"), partial.indexOf("</dialog>"));
  assert.match(panel, /data-testid="sales-record-withdrawal" data-withdrawal-tone="warn"/u);
  assert.match(text(panel), /Отказ, оплачено частично Убрано из продаж 26\.09 · Санжар Эскизов\. Передумал после первого платежа Исправить запись Вернуть/u);
  assert.match(text(panel), /Остаток — Остатка нет: отказ\./u);
  assert.equal(panel.match(/>Вернуть</gu)?.length, 1, "one place for the action while the record is open");
  const unpaid = pages.get("report-panel-unpaid");
  const unpaidPanel = unpaid.slice(unpaid.indexOf("<dialog"), unpaid.indexOf("</dialog>"));
  assert.match(unpaidPanel, /data-withdrawal-tone="danger"/u);
  assert.match(text(unpaidPanel), /Отказ, без оплаты Убрано из продаж 27\.09 · Айдана Макетова\. Исправить запись Вернуть/u);
  const alive = pages.get("report-panel-active");
  const alivePanel = alive.slice(alive.indexOf("<dialog"), alive.indexOf("</dialog>"));
  assert.doesNotMatch(alivePanel, /data-testid="sales-record-withdrawal"/u);
  assert.match(text(alivePanel), /Исправить запись Убрать Убрать из продаж Оплатил частично Не оплатил Заметка Убрать Отмена/u);
  // Рядом с открытой записью (таблица от 32rem) кнопки действия в строках нет (она в панели); в стопке (телефон) она остаётся
  // третьей клеткой первой строки: имя, остаток и действие на одной линии, как до 307 были имя и остаток.
  const compactRow = rowOf(partial, "Данияр Макетов");
  assert.match(compactRow, /<td role="cell" class="self-center @min-\[32rem\]\/sales-records:hidden">/u);
  assert.match(compactRow, /grid-cols-\[minmax\(0,1fr\)_auto_auto\]/u);
  assert.match(compactRow, /class="col-span-full min-w-0 pb-1 /u);
});

test("rendered report without the right to write: the chip and the edge are shown, no action and no action column", () => {
  const html = pages.get("report-readonly");
  assert.equal(html.match(/data-withdrawn="/gu)?.length, 2);
  assert.match(html, /Отказ, оплачено частично/u);
  assert.doesNotMatch(html, /sales-withdrawal-remove|sales-withdrawal-return|>Убрать<|>Вернуть<|Действие/u);
  assert.equal(html.slice(html.indexOf("<colgroup"), html.indexOf("</colgroup>")).match(/<col\b/gu)?.length, 8, "the table is the one of the roles without the action");
});

test("rendered report: the year view and the archive stay as they were — no action column in the archive, no refusal line", () => {
  const archive = pages.get("report-archive");
  assert.doesNotMatch(archive, /sales-withdrawal-remove|sales-withdrawal-return|Действие/u);
  assert.doesNotMatch(archive, /sales-withdrawn-summary/u);
  const year = pages.get("report-year");
  assert.equal(year.slice(year.indexOf("<colgroup"), year.indexOf("</colgroup>")).match(/<col\b/gu)?.length, 10);
});
