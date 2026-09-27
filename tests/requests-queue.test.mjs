import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRequestSelection, parseRequestCursor, encodeRequestCursor, decodeRequestCursor,
  requestsHref, parseRequestsReturnTo, parseRequestsQueue, parseRequestOpen, requestTabCount,
} from "../src/lib/requests-queue-contract.ts";

// Contract of platform.staff_requests_queue_v2 (migration 250, Э3 «Заявки»).
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
  v: 2, direction, source: filters.source, status: filters.status, limit: filters.limit,
  timestamp: entry.occurredAt, kind: entry.kind, id: entry.id,
});
const page = (rows = [], filters = selection) => ({
  version: 2, organizationId: org, source: filters.source, status: filters.status, limit: filters.limit,
  states: { lead: "ready", application: "ready", consultation: "forbidden" },
  counts: { website: rows.length, whatsapp: 0, application: 0, consultation: null },
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
  assert.equal(requestsHref(filters), "/v3/requests?source=platform_application&status=all&limit=1");
  assert.equal(requestsHref(parseRequestSelection({})), "/v3/requests");
  // Прежние параметры v1 не ломают страницу: они просто не читаются.
  assert.deepEqual(parseRequestSelection({ applications: "all", consultations: "handled" }), parseRequestSelection({}));
});

test("the open record lives in the address and is a strict kind:uuid", () => {
  const id = row(4).id;
  assert.equal(requestsHref(selection, `lead:${id}`), `/v3/requests?source=website&status=all&open=lead%3A${id}`);
  assert.deepEqual(parseRequestOpen(`application:${id}`), { kind: "application", id });
  for (const value of [undefined, ["lead:" + id], `task:${id}`, `lead:${id}:x`, "lead:not-a-uuid", "lead:ABCDEF00-0000-4000-8000-000000000004"]) {
    assert.equal(parseRequestOpen(value), null);
  }
});

test("cursor preserves PostgreSQL microseconds and binds every filter", () => {
  const valid = cursor(row(2));
  assert.deepEqual(decodeRequestCursor(encodeRequestCursor(valid), selection), valid);
  for (const change of [{ v: 1 }, { timestamp: "2026-02-30T12:00:00.123456Z" }, { timestamp: "2026-09-20T12:00:00.123Z" }, { timestamp: "2026-09-20T12:00:00.123456+00:00" }, { id: null }, { kind: "application" }, { direction: "all" }, { source: "whatsapp" }, { status: "waiting" }, { limit: 1 }, { secret: "unexpected" }]) {
    assert.throws(() => parseRequestCursor({ ...valid, ...change }, selection));
  }
  for (const token of ["x".repeat(1001), "%%%", `${encodeRequestCursor(valid)}=`, "bnVsbA"]) assert.throws(() => decodeRequestCursor(token, selection));
});

test("retry and card return preserve the complete cursor, external or ambiguous returns are rejected", () => {
  const filters = { ...selection, cursor: cursor(row(2)) };
  const href = requestsHref(filters);
  assert.deepEqual(parseRequestSelection(Object.fromEntries(new URL(href, "https://internal.invalid").searchParams)), filters);
  assert.equal(parseRequestsReturnTo(href), href);
  for (const value of ["https://evil.test/v3/requests", "//evil.test/v3/requests", "/v3/requests/other", "/v3/requests#x", "/v3/requests?source=website&source=whatsapp", "/v3/requests?unexpected=x", "/v3/requests?cursor=broken", "/v3/requests?open=lead%3Ax", "javascript:alert(1)"]) assert.equal(parseRequestsReturnTo(value), null);
});

test("an unreadable kind has no count, never a fabricated zero; «Все» sums only what the role reads", () => {
  const raw = page();
  assert.equal(parse(raw).counts.consultation, null);
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, consultation: 0 } }));
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, website: null } }));
  assert.throws(() => parse({ ...raw, states: { ...raw.states, lead: "not-requested" } }));
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, application: null, consultation: 4 }, "all"), 7);
  assert.equal(requestTabCount({ website: 2, whatsapp: 1, application: null, consultation: 4 }, "platform_application"), null);
  assert.equal(requestTabCount({ website: null, whatsapp: null, application: null, consultation: null }, "all"), null);
});

test("response organization, filter echo, unexpected fields and row scope fail closed", () => {
  const raw = page([row(1)]);
  assert.equal(parse(raw).rows.length, 1);
  for (const change of [{ organizationId: "another" }, { source: "all" }, { status: "waiting" }, { limit: 10 }, { version: 1 }, { internal: "unexpected" }, { latestAt: "2026-09-21" }]) assert.throws(() => parse({ ...raw, ...change }));
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
