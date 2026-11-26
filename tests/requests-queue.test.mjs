import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseRequestSelection, parseRequestCursor, encodeRequestCursor, decodeRequestCursor,
  requestsHref, parseRequestsReturnTo, parseRequestsQueue, parseRequestOpen, requestTabCount,
} from "../src/lib/requests-queue-contract.ts";

// Contract of platform.staff_requests_queue_v3 (телефония T9; v2 — миграция 250, Э3 «Заявки»).
const org = "22000000-0000-4000-8000-000000000001";
const ME = "22000000-0000-4000-8000-000000000900";
const selection = parseRequestSelection({ source: "website", status: "all" });
const row = (number, occurredAt = "2026-09-20T12:00:00.123456Z", fields = {}) => ({
  kind: "lead", id: `22000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  source: "website", occurredAt, personName: "Unit boundary record", email: null, phone: null,
  leadId: `22000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  owner: null, handedOff: false, take: null, ...fields,
});
const cursor = (entry, direction = "next", filters = selection) => ({
  v: 3, direction, source: filters.source, status: filters.status, limit: filters.limit,
  timestamp: entry.occurredAt, kind: entry.kind, id: entry.id,
});
const page = (rows = [], filters = selection) => ({
  version: 4, offset: 0, organizationId: org, source: filters.source, status: filters.status, limit: filters.limit,
  states: { lead: "ready", application: "ready", consultation: "forbidden" },
  phoneCalls: false,
  counts: { website: rows.length, whatsapp: 0, phone_call: null, application: 0, consultation: null },
  latestAt: "2026-09-21T00:00:00.000000Z",
  rows, nextCursor: null, previousCursor: null,
});
const unexpectedKind = () => { throw Error("Unexpected row kind in this lead-only unit test"); };
const parse = (value, filters = selection) => parseRequestsQueue(value, org, filters, unexpectedKind, unexpectedKind);
const TAKE = { workflowVersion: "3", stageKey: "new", nextActionText: null, nextActionDueDate: null };

test("request selection defaults to «Ждут разбора» and rejects ambiguous parameters", () => {
  assert.deepEqual(parseRequestSelection({}), { source: "all", status: "waiting", limit: 50, cursor: null });
  for (const params of [{ source: ["website"] }, { source: "unknown" }, { status: "pending" }, { status: ["all"] }, { limit: "0" }, { limit: "51" }, { limit: "01" }, { limit: ["1"] }, { cursor: "" }, { cursor: ["x"] }]) {
    assert.throws(() => parseRequestSelection(params));
  }
  const filters = parseRequestSelection({ source: "platform_application", status: "all", limit: "1" });
  assert.equal(requestsHref(filters), "/requests?source=platform_application&status=all&limit=1");
  assert.equal(requestsHref(parseRequestSelection({})), "/requests");
  // Прежние параметры v1 не ломают страницу: они просто не читаются.
  assert.deepEqual(parseRequestSelection({ applications: "all", consultations: "handled" }), parseRequestSelection({}));
});

test("the open record lives in the address and is a strict kind:uuid", () => {
  const id = row(4).id;
  assert.equal(requestsHref(selection, `lead:${id}`), `/requests?source=website&status=all&open=lead%3A${id}`);
  assert.deepEqual(parseRequestOpen(`application:${id}`), { kind: "application", id });
  for (const value of [undefined, ["lead:" + id], `task:${id}`, `lead:${id}:x`, "lead:not-a-uuid", "lead:ABCDEF00-0000-4000-8000-000000000004"]) {
    assert.equal(parseRequestOpen(value), null);
  }
});

test("cursor preserves PostgreSQL microseconds and binds every filter", () => {
  const valid = cursor(row(2));
  assert.deepEqual(decodeRequestCursor(encodeRequestCursor(valid), selection), valid);
  for (const change of [{ v: 1 }, { v: 2 }, { timestamp: "2026-02-30T12:00:00.123456Z" }, { timestamp: "2026-09-20T12:00:00.123Z" }, { timestamp: "2026-09-20T12:00:00.123456+00:00" }, { id: null }, { kind: "application" }, { direction: "all" }, { source: "whatsapp" }, { status: "waiting" }, { limit: 1 }, { secret: "unexpected" }]) {
    assert.throws(() => parseRequestCursor({ ...valid, ...change }, selection));
  }
  for (const token of ["x".repeat(1001), "%%%", `${encodeRequestCursor(valid)}=`, "bnVsbA"]) assert.throws(() => decodeRequestCursor(token, selection));
});

test("retry and card return preserve the complete cursor, external or ambiguous returns are rejected", () => {
  const filters = { ...selection, cursor: cursor(row(2)) };
  const href = requestsHref(filters);
  assert.deepEqual(parseRequestSelection(Object.fromEntries(new URL(href, "https://internal.invalid").searchParams)), filters);
  assert.equal(parseRequestsReturnTo(href), href);
  for (const value of ["https://evil.test/requests", "//evil.test/v3/requests", "/requests/other", "/requests#x", "/requests?source=website&source=whatsapp", "/requests?unexpected=x", "/requests?cursor=broken", "/requests?open=lead%3Ax", "javascript:alert(1)"]) assert.equal(parseRequestsReturnTo(value), null);
});

test("an unreadable kind has no count, never a fabricated zero; «Все» sums only what the role reads", () => {
  const raw = page();
  assert.equal(parse(raw).counts.consultation, null);
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, consultation: 0 } }));
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, website: null } }));
  assert.throws(() => parse({ ...raw, states: { ...raw.states, lead: "not-requested" } }));
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, phone_call: null, application: null, consultation: 4 }, "all"), 7);
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, phone_call: 3, application: null, consultation: 4 }, "all"), 10);
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, phone_call: 3, application: null, consultation: 4 }, "phone_call"), 3);
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, phone_call: null, application: null, consultation: 4 }, "platform_application"), null);
  assert.equal(requestTabCount({ website: null, whatsapp: null, phone_call: null, application: null, consultation: null }, "all"), null);
});

test("response organization, filter echo, unexpected fields and row scope fail closed", () => {
  const raw = page([row(1)]);
  assert.equal(parse(raw).rows.length, 1);
  for (const change of [{ organizationId: "another" }, { source: "all" }, { status: "waiting" }, { limit: 10 }, { version: 1 }, { version: 2 }, { internal: "unexpected" }, { latestAt: "2026-09-21" }, { phoneCalls: "no" }]) assert.throws(() => parse({ ...raw, ...change }));
  for (const change of [{ leadId: row(9).id }, { source: "whatsapp" }, { personName: " " }, { phone: 1 }, { workflow: 2 }, { handedOff: "no" }, { owner: { membershipId: "x", name: null } }]) assert.throws(() => parse(page([{ ...row(1), ...change }])));
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, website: 0 } }));
  assert.throws(() => parse({ ...page(), counts: { ...raw.counts, website: 1 } }));
  // Строка новее последней заявки источника или заявки без последней — ложь чтения.
  assert.throws(() => parse({ ...raw, latestAt: "2026-09-19T00:00:00.000000Z" }));
  assert.throws(() => parse({ ...raw, latestAt: null }));
  assert.equal(parse({ ...page(), counts: { ...page().counts, website: 0 }, latestAt: null }).latestAt, null);
});

test("«take» only on a lead with no owner that was not handed off; «Ждут разбора» holds only those", () => {
  const owner = { membershipId: ME, name: "Unit owner" };
  assert.deepEqual(parse(page([row(1, undefined, { take: TAKE })])).rows[0].take, TAKE);
  assert.deepEqual(parse(page([row(1, undefined, { owner })])).rows[0].owner, owner);
  assert.equal(parse(page([row(1, undefined, { owner: { membershipId: ME, name: null } })])).rows[0].owner.name, null);
  assert.throws(() => parse(page([row(1, undefined, { owner, take: TAKE })])));
  assert.throws(() => parse(page([row(1, undefined, { handedOff: true, take: TAKE })])));
  for (const change of [{ workflowVersion: "0" }, { workflowVersion: 3 }, { stageKey: "handed_off" }, { nextActionText: "Позвонить" }, { nextActionDueDate: "2026-09-31", nextActionText: "x" }, { extra: 1 }]) {
    assert.throws(() => parse(page([row(1, undefined, { take: { ...TAKE, ...change } })])));
  }
  const waiting = parseRequestSelection({ source: "website" });
  assert.equal(parse(page([row(1, undefined, { take: TAKE })], waiting), waiting).rows.length, 1);
  assert.throws(() => parse(page([row(1, undefined, { owner })], waiting), waiting));
  assert.throws(() => parse(page([row(1, undefined, { handedOff: true })], waiting), waiting));
});

test("equal timestamps use descending UUIDs and microsecond differences are not rounded away", () => {
  assert.equal(parse(page([row(3), row(2), row(1)])).rows.length, 3);
  assert.throws(() => parse(page([row(1), row(2)])));
  assert.throws(() => parse(page([row(1), row(1)])));
  assert.equal(parse(page([row(1, "2026-09-20T12:00:00.123457Z"), row(2)])).rows.length, 2);
});

test("forward and backward pages validate their direction and emitted boundary", () => {
  const forward = { ...selection, cursor: cursor(row(3)) };
  const raw = { ...page([row(2)]), nextCursor: cursor(row(2)), previousCursor: cursor(row(2), "previous") };
  assert.equal(parse(raw, forward).rows[0].id, row(2).id);
  assert.throws(() => parse(raw, { ...selection, cursor: cursor(row(1)) }));
  assert.throws(() => parse({ ...raw, nextCursor: cursor(row(1)) }, forward));
  const backward = { ...selection, cursor: cursor(row(1), "previous") };
  assert.equal(parse(raw, backward).rows.length, 1);
  assert.throws(() => parse(raw, { ...selection, cursor: cursor(row(3), "previous") }));
});

test("a page emptied by a changed queue can return across its original cursor", () => {
  const original = cursor(row(3));
  const empty = { ...page(), previousCursor: { ...original, direction: "previous" } };
  assert.equal(parse(empty, { ...selection, cursor: original }).previousCursor.direction, "previous");
  assert.throws(() => parse({ ...empty, previousCursor: original }, { ...selection, cursor: original }));
});

// Телефония T9: вкладка «Звонки» — лиды `phone_call`, которые есть в чтении, только пока телефония включена.
const callPage = (rows = [], filters = selection, counts = {}, phoneCalls = true) => ({
  ...page([], filters), phoneCalls,
  counts: { website: 0, whatsapp: 0, phone_call: phoneCalls ? rows.length : null, application: 0, consultation: null, ...counts },
  rows,
});
const callsSelection = parseRequestSelection({ source: "phone_call", status: "all" });
const callRow = (number, fields = {}) => row(number, undefined, { source: "phone_call", ...fields });

test("«Звонки» is a lead source: the filter, the tab and the row source are the same word", () => {
  assert.equal(parseRequestSelection({ source: "phone_call" }).source, "phone_call");
  assert.equal(requestsHref(callsSelection), "/requests?source=phone_call&status=all");
  const parsed = parse(callPage([callRow(1)], callsSelection), callsSelection);
  assert.equal(parsed.rows[0].source, "phone_call");
  assert.equal(parsed.rows[0].kind, "lead");
  assert.equal(parsed.counts.phone_call, 1);
  assert.equal(parsed.phoneCalls, true);
  // Курсор «Звонков» привязан к своему источнику и к лидам, а не к анкетам.
  const bound = cursor(callRow(2), "next", callsSelection);
  assert.deepEqual(decodeRequestCursor(encodeRequestCursor(bound), callsSelection), bound);
  assert.throws(() => parseRequestCursor({ ...bound, source: "website" }, callsSelection));
  assert.throws(() => parseRequestCursor({ ...bound, kind: "application" }, callsSelection));
  // Другой источник строки на вкладке «Звонки» — ложь чтения.
  assert.throws(() => parse(callPage([row(1)], callsSelection), callsSelection));
});

test("«Все» counts the calls only when they are in the read", () => {
  const all = parseRequestSelection({ status: "all" });
  const at = (n) => `2026-09-20T12:00:0${n}.000000Z`;
  const rows = [callRow(5, { occurredAt: at(5) }), callRow(4, { occurredAt: at(4) }), callRow(3, { occurredAt: at(3) }), callRow(2, { occurredAt: at(2) }), row(1, at(1))];
  const withCalls = parse(callPage(rows, all, { website: 1, phone_call: 4 }, true), all);
  assert.equal(requestTabCount(withCalls.counts, "all"), 1 + 0 + 4 + 0);
  assert.equal(requestTabCount(withCalls.counts, "phone_call"), 4);
  assert.equal(withCalls.rows.length, 5);
  // Звонки выключены: в «Все» только остальное, строки `phone_call` в чтении быть не может.
  const without = parse(callPage([row(1, at(1))], all, { website: 1 }, false), all);
  assert.equal(without.counts.phone_call, null);
  assert.equal(without.phoneCalls, false);
  assert.equal(requestTabCount(without.counts, "all"), 1);
  assert.equal(requestTabCount(without.counts, "phone_call"), null);
  assert.throws(() => parse(callPage([callRow(2, { occurredAt: at(2) }), row(1, at(1))], all, { website: 1 }, false), all));
});

test("calls off: no number, no rows, and a number or a row with calls off fails closed", () => {
  const off = callPage([], callsSelection, {}, false);
  const parsed = parse({ ...off, latestAt: null }, callsSelection);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.counts.phone_call, null);
  // Число при выключенных звонках и отсутствие числа при включённых — не из этого сервера.
  assert.throws(() => parse({ ...off, counts: { ...off.counts, phone_call: 0 } }, callsSelection));
  const on = callPage([], callsSelection, {}, true);
  assert.throws(() => parse({ ...on, counts: { ...on.counts, phone_call: null } }, callsSelection));
  // Звонки без права читать лиды невозможны; строка `phone_call` при выключенных звонках — тоже.
  assert.throws(() => parse({ ...on, states: { ...on.states, lead: "forbidden" }, counts: { ...on.counts, website: null, whatsapp: null, phone_call: null } }, callsSelection));
  assert.throws(() => parse({ ...page([callRow(1)], selection), counts: { ...page().counts, website: 1 } }, selection));
});

test("a phone-call lead keeps the take/owner/handed-off rules of every other lead", () => {
  const owner = { membershipId: ME, name: "Unit owner" };
  assert.deepEqual(parse(callPage([callRow(1, { take: TAKE })], callsSelection), callsSelection).rows[0].take, TAKE);
  assert.throws(() => parse(callPage([callRow(1, { owner, take: TAKE })], callsSelection), callsSelection));
  const waiting = parseRequestSelection({ source: "phone_call" });
  assert.equal(parse(callPage([callRow(1, { take: TAKE })], waiting), waiting).rows.length, 1);
  assert.throws(() => parse(callPage([callRow(1, { owner })], waiting), waiting));
  assert.throws(() => parse(callPage([callRow(1, { handedOff: true })], waiting), waiting));
});

test("377: page numbers — `page` in the address is an offset, never together with a cursor; the read echoes the offset of its first row", async () => {
  const { requestsHref: href, REQUESTS_MAX_PAGE } = await import("../src/lib/requests-queue-contract.ts");
  const third = parseRequestSelection({ page: "3" });
  assert.equal(third.page, 3);
  assert.equal(href(third), "/requests?page=3");
  assert.equal(href({ ...third, page: undefined }), "/requests", "tabs and «К началу» drop the number");
  assert.equal(href(parseRequestSelection({})), "/requests");
  assert.equal("page" in parseRequestSelection({ page: "1" }), false, "the first page has no number in the address");
  for (const bad of ["0", "01", "x", String(REQUESTS_MAX_PAGE + 1)]) assert.throws(() => parseRequestSelection({ page: bad }), undefined, bad);
  const rows = Array.from({ length: 3 }, (_, index) => row(index + 1, `2026-09-2${3 - index}T00:00:00.000000Z`));
  const selection3 = parseRequestSelection({ source: "website", status: "all", limit: "1", page: "3" });
  const third3 = { ...page([rows[2]], selection3), latestAt: rows[0].occurredAt, counts: { website: 3, whatsapp: 0, phone_call: null, application: 0, consultation: null }, offset: 2 };
  assert.equal(parseRequestsQueue(third3, org, selection3, unexpectedKind, unexpectedKind).offset, 2);
  assert.throws(() => parseRequestsQueue({ ...third3, offset: 1 }, org, selection3, unexpectedKind, unexpectedKind), undefined, "offset must be the one asked for");
  assert.throws(() => parseRequestsQueue({ ...third3, version: 3 }, org, selection3, unexpectedKind, unexpectedKind), undefined, "v3 answers are not read any more");
  const sql = readFileSync(new URL("../supabase/migrations/377_platform_requests_queue_page_numbers.sql", import.meta.url), "utf8");
  assert.match(sql, /FUNCTION platform\.staff_requests_queue_v4\(p_organization_id uuid, p_source text DEFAULT 'all'::text, p_status text DEFAULT 'waiting'::text, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb, p_offset integer DEFAULT 0\)/u);
  assert.match(sql, /OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 50000 OR \(p_offset > 0 AND p_cursor IS NOT NULL\) THEN/u);
  assert.match(sql, /LIMIT p_limit OFFSET p_offset/u);
  assert.match(sql, /a377_queue_anchor_drift/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.staff_requests_queue_v4\(UUID, TEXT, TEXT, INTEGER, JSONB, INTEGER\) TO authenticated;/u);
  assert.doesNotMatch(sql, /DROP FUNCTION|CREATE OR REPLACE FUNCTION platform\.staff_requests_queue_v3/u, "v3 stays for the previous release");
});

test("pager numbers: the first, the last and two on each side of the current page, gaps as «…»", async () => {
  const { pagerNumbers } = await import("../src/lib/requests-queue-contract.ts");
  assert.deepEqual(pagerNumbers(1, 17), [1, 2, 3, "gap", 17]);
  assert.deepEqual(pagerNumbers(4, 17), [1, 2, 3, 4, 5, 6, "gap", 17]);
  assert.deepEqual(pagerNumbers(9, 17), [1, "gap", 7, 8, 9, 10, 11, "gap", 17]);
  assert.deepEqual(pagerNumbers(17, 17), [1, "gap", 15, 16, 17]);
  assert.deepEqual(pagerNumbers(1, 2), [1, 2]);
});

test("an empty numbered page says «список изменился», like an empty page by cursor — not «Новых заявок нет» while requests wait on the first page", async () => {
  const { requestsPastFirstPage } = await import("../src/lib/requests-queue-contract.ts");
  assert.equal(requestsPastFirstPage(parseRequestSelection({})), false, "the first page");
  assert.equal(requestsPastFirstPage(parseRequestSelection({ page: "1" })), false, "?page=1 is the first page");
  assert.equal(requestsPastFirstPage(parseRequestSelection({ page: "2" })), true, "?page=2 is already past the first page");
  assert.equal(requestsPastFirstPage(parseRequestSelection({ source: "website", status: "all", page: "3" })), true, "?page=3");
  assert.equal(requestsPastFirstPage({ ...selection, cursor: cursor(row(1)) }), true, "a page by cursor, as before 377");
  // Оба вида (новый и прежний) спрашивают это правило, а не один курсор.
  for (const file of ["src/components/staff/requests-next/RequestsNextEmpty.tsx", "src/components/staff/requests/RequestsQueueView.tsx"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(text, /if \(requestsPastFirstPage\(selection\)\) \{[\s\S]{0,400}?На этой странице заявок больше нет: список изменился\./u, file);
    assert.doesNotMatch(text, /if \(selection\.cursor\b/u, `${file}: the cursor alone is not the whole rule`);
  }
});
