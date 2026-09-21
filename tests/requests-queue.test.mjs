import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRequestSelection, parseRequestCursor, encodeRequestCursor, decodeRequestCursor,
  requestsHref, parseRequestsReturnTo, parseRequestsQueue,
} from "../src/lib/requests-queue-contract.ts";

const org = "22000000-0000-4000-8000-000000000001";
const selection = parseRequestSelection({ source: "website" });
const row = (number, occurredAt = "2026-09-20T12:00:00.123456Z") => ({
  kind: "lead", id: `22000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  source: "website", occurredAt, personName: "Unit boundary record", email: null, phone: null,
  leadId: `22000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
});
const cursor = (entry, direction = "next", filters = selection) => ({
  v: 1, direction, source: filters.source, applicationStatus: filters.applicationStatus,
  consultationStatus: filters.consultationStatus, limit: filters.limit,
  timestamp: entry.occurredAt, kind: entry.kind, id: entry.id,
});
const page = (rows = []) => ({
  version: 1, organizationId: org, source: selection.source, applicationStatus: selection.applicationStatus,
  consultationStatus: selection.consultationStatus, limit: selection.limit,
  states: { lead: "ready", application: "not-requested", consultation: "not-requested" },
  counts: { lead: rows.length, application: null, consultation: null, pendingApplications: null, openConsultations: null },
  rows, nextCursor: null, previousCursor: null,
});
const unexpectedKind = () => { throw Error("Unexpected row kind in this lead-only unit test"); };
const parse = (value, filters = selection) => parseRequestsQueue(value, org, filters, unexpectedKind, unexpectedKind);

test("request selection defaults preserve kind-specific statuses and reject ambiguous parameters", () => {
  assert.deepEqual(parseRequestSelection({}), { source: "all", applicationStatus: "pending", consultationStatus: "all", limit: 50, cursor: null });
  for (const params of [{ source: ["website"] }, { source: "unknown" }, { applications: "handled" }, { consultations: "pending" }, { limit: "0" }, { limit: "51" }, { limit: "01" }, { limit: ["1"] }, { cursor: "" }, { cursor: ["x"] }]) {
    assert.throws(() => parseRequestSelection(params));
  }
  const filters = parseRequestSelection({ source: "platform_application", applications: "all", consultations: "handled", limit: "1" });
  assert.equal(requestsHref(filters), "/v3/requests?source=platform_application&applications=all&consultations=handled&limit=1");
});

test("cursor preserves PostgreSQL microseconds and binds every filter", () => {
  const valid = cursor(row(2));
  assert.deepEqual(decodeRequestCursor(encodeRequestCursor(valid), selection), valid);
  for (const change of [{ v: 2 }, { timestamp: "2026-02-30T12:00:00.123456Z" }, { timestamp: "2026-09-20T12:00:00.123Z" }, { timestamp: "2026-09-20T12:00:00.123456+00:00" }, { id: null }, { kind: "application" }, { direction: "all" }, { source: "whatsapp" }, { applicationStatus: "all" }, { consultationStatus: "requested" }, { limit: 1 }, { secret: "unexpected" }]) {
    assert.throws(() => parseRequestCursor({ ...valid, ...change }, selection));
  }
  for (const token of ["x".repeat(1001), "%%%", `${encodeRequestCursor(valid)}=`, "bnVsbA"]) assert.throws(() => decodeRequestCursor(token, selection));
});

test("retry and card return preserve the complete cursor, external or ambiguous returns are rejected", () => {
  const filters = { ...selection, cursor: cursor(row(2)) };
  const href = requestsHref(filters);
  assert.deepEqual(parseRequestSelection(Object.fromEntries(new URL(href, "https://internal.invalid").searchParams)), filters);
  assert.equal(parseRequestsReturnTo(href), href);
  for (const value of ["https://evil.test/v3/requests", "//evil.test/v3/requests", "/v3/requests/other", "/v3/requests#x", "/v3/requests?source=website&source=whatsapp", "/v3/requests?unexpected=x", "/v3/requests?cursor=broken", "javascript:alert(1)"]) assert.equal(parseRequestsReturnTo(value), null);
});

test("unavailable or forbidden kinds have unknown counts, never fabricated zero", () => {
  const all = parseRequestSelection({});
  const raw = { ...page(), source: "all", states: { lead: "ready", application: "forbidden", consultation: "unavailable" } };
  assert.equal(parse(raw, all).counts.application, null);
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, application: 0 } }, all));
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, openConsultations: 0 } }, all));
  assert.throws(() => parse({ ...raw, states: { ...raw.states, lead: "not-requested" } }, all));
  assert.throws(() => parse({ ...page(), counts: { ...page().counts, lead: null } }));
});

test("response organization, filter echo, unexpected fields and row scope fail closed", () => {
  const raw = page([row(1)]);
  assert.equal(parse(raw).rows.length, 1);
  for (const change of [{ organizationId: "another" }, { source: "all" }, { limit: 10 }, { version: 2 }, { internal: "unexpected" }]) assert.throws(() => parse({ ...raw, ...change }));
  for (const change of [{ leadId: row(9).id }, { source: "whatsapp" }, { personName: " " }, { phone: 1 }, { workflow: 2 }]) assert.throws(() => parse(page([{ ...row(1), ...change }])));
  assert.throws(() => parse({ ...raw, counts: { ...raw.counts, lead: 0 } }));
  assert.throws(() => parse({ ...page(), counts: { ...raw.counts, lead: 1 } }));
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
