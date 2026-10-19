#!/usr/bin/env node
// Отчёт по строкам журнала `evo_timing` (замер A0, docs/PLAN_CHANGES.md 19.10.2026).
//
//   ssh hermes-vps 'docker logs --since 24h evo-crm-app-1 2>&1' | node scripts/timing-report.mjs
//
// Читает stdin, берёт только строки с событием `evo_timing` (перед JSON может
// стоять любой префикс, например время от `docker logs -t`) и печатает по
// классам маршрута: число запросов, p50/p90/p99 общего времени, p50 до первых
// байтов, среднюю глубину (последовательные волны RPC), число RPC и время RPC.
// В строках журнала нет данных пользователей, поэтому и в отчёте их нет.
//
// Флаги: --json (машинный вывод), --by-release (отдельно по меткам выпуска),
// --kind=page,nav,prefetch,action,route (фильтр), --min-n=N (скрыть редкие).

import { pathToFileURL } from "node:url";

const KINDS = new Set(["page", "nav", "prefetch", "action", "route"]);

export function parseTimingLines(text) {
  const records = [];
  let ignored = 0;
  for (const line of String(text).split(/\r?\n/u)) {
    if (!line.includes('"evo_timing"')) continue;
    const start = line.indexOf("{");
    if (start < 0) { ignored += 1; continue; }
    try {
      const value = JSON.parse(line.slice(start));
      if (
        value && value.event === "evo_timing" && typeof value.class === "string"
        && KINDS.has(value.kind) && Number.isFinite(value.ms) && Number.isFinite(value.rpc)
        && Number.isFinite(value.depth)
      ) records.push(value);
      else ignored += 1;
    } catch {
      ignored += 1;
    }
  }
  return { records, ignored };
}

/** Ближайший ранг: p-й процентиль отсортированного массива. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numbers(records, field) {
  return records.map((record) => record[field]).filter(Number.isFinite);
}

function summarizeGroup(records) {
  const ms = numbers(records, "ms").sort((a, b) => a - b);
  const ttfb = numbers(records, "ttfb_ms").sort((a, b) => a - b);
  return {
    n: records.length,
    p50: percentile(ms, 50),
    p90: percentile(ms, 90),
    p99: percentile(ms, 99),
    ttfb_p50: percentile(ttfb, 50),
    depth_avg: mean(numbers(records, "depth")),
    rpc_avg: mean(numbers(records, "rpc")),
    rpc_ms_avg: mean(numbers(records, "rpc_ms")),
    rpc_total: numbers(records, "rpc").reduce((sum, value) => sum + value, 0),
    errors: records.filter((record) => record.status >= 500).length,
  };
}

export function summarize(records, { byRelease = false, kinds = null, minN = 1 } = {}) {
  const selected = kinds ? records.filter((record) => kinds.has(record.kind)) : records;
  const groups = new Map();
  for (const record of selected) {
    const key = JSON.stringify([byRelease ? record.rel : "", record.class, record.kind]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const rows = [...groups.entries()]
    .map(([key, group]) => {
      const [rel, routeClass, kind] = JSON.parse(key);
      return { ...(byRelease ? { rel } : {}), class: routeClass, kind, ...summarizeGroup(group) };
    })
    .filter((row) => row.n >= minN)
    .sort((a, b) => b.n - a.n || a.class.localeCompare(b.class) || a.kind.localeCompare(b.kind) || (a.rel ?? "").localeCompare(b.rel ?? ""));

  const times = selected.map((record) => Date.parse(record.ts)).filter(Number.isFinite);
  const first = times.length ? Math.min(...times) : null;
  const last = times.length ? Math.max(...times) : null;
  const hours = first !== null && last !== null ? (last - first) / 3_600_000 : 0;
  const rpcTotal = numbers(selected, "rpc").reduce((sum, value) => sum + value, 0);
  return {
    requests: selected.length,
    first: first === null ? null : new Date(first).toISOString(),
    last: last === null ? null : new Date(last).toISOString(),
    hours,
    releases: [...new Set(selected.map((record) => record.rel))].sort(),
    rpc_total: rpcTotal,
    rpc_per_hour: hours > 0 ? rpcTotal / hours : null,
    rows,
  };
}

const fmt = (value, digits = 0) => (value === null || value === undefined ? "-" : Number(value).toFixed(digits));

export function formatReport(summary, ignored = 0) {
  const lines = [];
  lines.push(`Запросов: ${summary.requests}${ignored ? ` (пропущено нечитаемых строк: ${ignored})` : ""}`);
  lines.push(
    summary.first
      ? `Охват: ${summary.first} .. ${summary.last} (${fmt(summary.hours, 2)} ч)`
      : "Охват: нет строк",
  );
  lines.push(`Выпуски: ${summary.releases.join(", ") || "-"}`);
  lines.push(
    `RPC всего: ${summary.rpc_total}${summary.rpc_per_hour === null ? "" : `, в среднем ${fmt(summary.rpc_per_hour, 1)} в час по всем запросам`}`,
  );
  lines.push("");
  const header = [
    ...(summary.rows[0] && "rel" in summary.rows[0] ? ["выпуск"] : []),
    "класс", "вид", "n", "p50 мс", "p90 мс", "p99 мс", "p50 до байта", "глубина", "RPC", "RPC мс", "5xx",
  ];
  const body = summary.rows.map((row) => [
    ...("rel" in row ? [row.rel] : []),
    row.class, row.kind, String(row.n), fmt(row.p50), fmt(row.p90), fmt(row.p99), fmt(row.ttfb_p50),
    fmt(row.depth_avg, 1), fmt(row.rpc_avg, 1), fmt(row.rpc_ms_avg), String(row.errors),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((row) => row[column].length)));
  const render = (cells) => cells.map((cell, column) => (column < header.length - 9 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ");
  lines.push(render(header));
  lines.push(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of body) lines.push(render(row));
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = { json: false, byRelease: false, kinds: null, minN: 1 };
  for (const argument of argv) {
    if (argument === "--json") options.json = true;
    else if (argument === "--by-release") options.byRelease = true;
    else if (argument.startsWith("--kind=")) {
      const kinds = argument.slice(7).split(",").filter(Boolean);
      if (kinds.length === 0 || kinds.some((kind) => !KINDS.has(kind))) throw new Error(`--kind: допустимо ${[...KINDS].join(",")}`);
      options.kinds = new Set(kinds);
    } else if (argument.startsWith("--min-n=")) {
      const value = Number(argument.slice(8));
      if (!Number.isInteger(value) || value < 1) throw new Error("--min-n: целое число от 1");
      options.minN = value;
    } else throw new Error(`Неизвестный флаг: ${argument}`);
  }
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { records, ignored } = parseTimingLines(await readStdin());
  const summary = summarize(records, options);
  process.stdout.write(options.json ? `${JSON.stringify({ ...summary, ignored }, null, 2)}\n` : formatReport(summary, ignored));
  if (records.length === 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
