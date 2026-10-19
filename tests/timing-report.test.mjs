import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { formatReport, parseTimingLines, percentile, summarize } from "../scripts/timing-report.mjs";

// Отчёт по журналу `evo_timing` (замер A0, docs/PLAN_CHANGES.md 19.10.2026).

function line(overrides = {}) {
  return JSON.stringify({
    event: "evo_timing", v: 1, ts: "2026-10-19T08:00:00Z", rel: "r199+01234567", class: "portal/home", kind: "page",
    status: 200, ms: 100, ttfb_ms: 50, rpc: 3, depth: 2, rpc_ms: 60, rpc_wall_ms: 40, other: 0, ...overrides,
  });
}

test("parses evo_timing lines with or without the docker timestamp prefix and skips everything else", () => {
  const text = [
    `2026-10-19T08:00:00.123456789Z ${line()}`,
    line({ class: "portal/profile" }),
    '{"event":"http_request","path":"/portal","method":"GET"}',
    "plain text mentioning evo_timing without json",
    `${line()}x`,
    '{"event":"evo_timing","class":"broken"}',
    "",
  ].join("\n");
  const { records, ignored } = parseTimingLines(text);
  assert.deepEqual(records.map((record) => record.class), ["portal/home", "portal/profile"]);
  assert.equal(ignored, 2, "two lines carry the event name but are not valid records");
});

test("percentiles use the nearest rank", () => {
  const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.deepEqual([50, 90, 99, 100].map((p) => percentile(sorted, p)), [50, 90, 99, 100]);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 99), 7);
});

test("groups by class and kind, with p50/p90/p99, mean depth and RPC, coverage and RPC per hour", () => {
  const records = [];
  for (let index = 1; index <= 10; index += 1) {
    records.push(JSON.parse(line({ ms: index * 100, ttfb_ms: index * 10, depth: index <= 5 ? 2 : 4, rpc: 3, ts: `2026-10-19T0${index % 10}:00:00Z` })));
  }
  records.push(JSON.parse(line({ class: "api/portal/updates", kind: "route", ms: 30, rpc: 1, depth: 1, status: 503, ts: "2026-10-19T09:30:00Z" })));
  const summary = summarize(records);
  assert.equal(summary.requests, 11);
  assert.equal(summary.first, "2026-10-19T00:00:00.000Z");
  assert.equal(summary.last, "2026-10-19T09:30:00.000Z");
  assert.equal(summary.hours, 9.5);
  assert.equal(summary.rpc_total, 31);
  assert.equal(Math.round(summary.rpc_per_hour * 10) / 10, 3.3);
  const home = summary.rows.find((row) => row.class === "portal/home");
  assert.deepEqual(
    [home.n, home.p50, home.p90, home.p99, home.ttfb_p50, home.depth_avg, home.rpc_avg, home.errors],
    [10, 500, 900, 1000, 50, 3, 3, 0],
  );
  const poll = summary.rows.find((row) => row.class === "api/portal/updates");
  assert.deepEqual([poll.kind, poll.n, poll.errors], ["route", 1, 1]);
  assert.equal(summary.rows[0].class, "portal/home", "the most frequent class is first");
});

test("filters by kind and minimum count, and splits by release on request", () => {
  const records = [
    JSON.parse(line({ kind: "prefetch" })),
    JSON.parse(line({ kind: "page", rel: "r198+aaaaaaaa" })),
    JSON.parse(line({ kind: "page", rel: "r199+bbbbbbbb" })),
    JSON.parse(line({ kind: "page", rel: "r199+bbbbbbbb" })),
  ];
  assert.equal(summarize(records, { kinds: new Set(["prefetch"]) }).requests, 1);
  assert.equal(summarize(records, { minN: 3 }).rows.length, 1);
  const byRelease = summarize(records, { byRelease: true });
  assert.deepEqual(byRelease.releases, ["r198+aaaaaaaa", "r199+01234567", "r199+bbbbbbbb"]);
  assert.deepEqual(byRelease.rows.map((row) => [row.rel, row.kind, row.n]), [["r199+bbbbbbbb", "page", 2], ["r198+aaaaaaaa", "page", 1], ["r199+01234567", "prefetch", 1]]);
});

test("the text report names the coverage, the table has one row per group, and no field of a person appears", () => {
  const { records } = parseTimingLines([line(), line({ class: "v3/profile/[caseId]", kind: "nav", ts: "2026-10-19T10:00:00Z" })].join("\n"));
  const text = formatReport(summarize(records));
  assert.match(text, /Запросов: 2/);
  assert.match(text, /Охват: 2026-10-19T08:00:00.000Z \.\. 2026-10-19T10:00:00.000Z \(2.00 ч\)/);
  assert.match(text, /portal\/home\s+page\s+1\s+100/);
  assert.match(text, /v3\/profile\/\[caseId\]\s+nav/);
});

test("the command reads stdin and exits non-zero when there are no records", () => {
  const ok = spawnSync(process.execPath, ["scripts/timing-report.mjs", "--json"], { input: `${line()}\n`, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).requests, 1);
  const empty = spawnSync(process.execPath, ["scripts/timing-report.mjs"], { input: "nothing here\n", encoding: "utf8" });
  assert.equal(empty.status, 2);
  assert.match(empty.stdout, /Запросов: 0/);
  const bad = spawnSync(process.execPath, ["scripts/timing-report.mjs", "--kind=unknown"], { input: "", encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--kind/);
});
