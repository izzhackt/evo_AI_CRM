#!/usr/bin/env node
/**
 * Импорт стоимости вузов и курсов валют (миграция 283) через
 * platform.staff_catalog_cost_import_v1 и platform.staff_catalog_fx_rate_set_v1.
 *
 *   (по умолчанию)  сухой прогон: проверка файла и план (строки по странам,
 *                   видам, источникам; подтверждения агентств; курсы;
 *                   request_id), без сети и ключей;
 *   --apply         вызов RPC; повтор с тем же файлом безопасен: request_id
 *                   выводится из sha256 файла, строки с уже импортированным
 *                   importKey не создаются второй раз.
 *
 * Вход, один из двух:
 *   --seed-dir <папка>  сид контент-потока: costs-import.json и fx-rates.json
 *                       (схема output/student-app-v2/seed/SEED_CONTRACT.md),
 *                       переводится в файл ниже функцией fromContentSeed;
 *   --file <файл>       схема docs/catalog/geography-costs-contract.md («Импорт»):
 *     { schemaVersion: 1, organizationId?, requestId?, rows: [CostRow], fxRates: [Rate] }
 * Суммы: amountMin / amountMax в единицах валюты (строка или число, не больше
 * знаков после запятой, чем у валюты) или amountMinMinor / amountMaxMinor.
 *
 * Доступ только из окружения, ключи не печатаются (--apply):
 *   NEXT_PUBLIC_SUPABASE_URL              https://<ref>.supabase.co или http://127.0.0.1:<порт>;
 *   EVO_PLATFORM_ORGANIZATION_ID          организация (если нет в файле);
 *   --auth staff:   EVO_CATALOG_STAFF_ACCESS_TOKEN (сессия сотрудника с правом
 *                   публикации каталога; подтверждения агентств только Admin)
 *                   и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 *   --auth service: EVO_PLATFORM_SUPABASE_SECRET_KEY и EVO_CATALOG_ACTOR_MEMBERSHIP_ID
 *                   (членство живого системного Admin этой организации).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicUrlOk } from "./geography-seed-lib.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"];
const PERIODS = ["year", "semester", "month", "week", "day", "once", "program"];
const LEVELS = ["language", "foundation", "diploma", "bachelor", "master", "doctorate"];
const SOURCES = ["official", "agency", "evo_document"];
const STUDY_COUNTRIES = ["CN", "MY", "AE", "TR", "IT", "CZ"];
const ROW_KEYS = new Set(["importKey", "institutionId", "country", "institutionName", "programId", "studyLevel", "teachingLanguage",
  "costKind", "period", "amountMin", "amountMax", "amountMinMinor", "amountMaxMinor", "currency", "academicYear", "noteRu", "noteKy",
  "sourceKind", "sourceName", "sourceUrl", "verifiedOn", "confirmation", "publish"]);
const RATE_KEYS = new Set(["currency", "asOf", "unitsPerUsd", "sourceName", "sourceUrl"]);
const RPC_BATCH = 2000;

class ImportError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new ImportError(code); };

/** Как platform_private.catalog_currency_exponent в 283. */
export function currencyExponent(currency) {
  if (["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"].includes(currency)) return 0;
  if (["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)) return 3;
  return 2;
}

/** «25000», 25000, «1234.5» → минорные единицы без плавающей точки. */
export function toMinor(value, exponent) {
  const text = typeof value === "number" ? (Number.isSafeInteger(value) ? String(value) : value.toString()) : value;
  if (typeof text !== "string" || !/^\d{1,13}(\.\d+)?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > exponent) return null;
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
  return minor <= 1000000000000000n ? Number(minor) : null;
}

const textOk = (value, max) => typeof value === "string" && value.trim() !== "" && value === value.trim()
  && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
function dateOk(value, today) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= today;
}
/** Как platform_private.catalog_academic_year_ok в 283: 2026/27, календарный 2026 или null (год не придумывается). */
const academicYearOk = (value) => value == null || (typeof value === "string" && (/^20\d{2}$/u.test(value)
  || (/^20\d{2}\/\d{2}$/u.test(value) && Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100)));

/** Детерминированный UUID из текста (стабильные request_id повторного запуска). */
export function stableUuid(text) {
  const hex = createHash("sha256").update(text).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Проверяет файл и строит вызовы RPC; ошибки собираются целиком. */
export function planImport(file, { fileSha256, organizationId, today = new Date().toISOString().slice(0, 10) }) {
  const problems = [];
  if (file?.schemaVersion !== 1 || !Array.isArray(file?.rows) || !(file.fxRates === undefined || Array.isArray(file.fxRates))) {
    return { problems: ["expected { schemaVersion: 1, rows: [], fxRates?: [] }"] };
  }
  const org = file.organizationId ?? organizationId;
  if (typeof org !== "string" || !UUID.test(org)) problems.push("organizationId: a UUID in the file or EVO_PLATFORM_ORGANIZATION_ID");
  if (file.requestId !== undefined && !(typeof file.requestId === "string" && UUID.test(file.requestId))) problems.push("requestId: UUID");
  const baseRequest = file.requestId ?? stableUuid(`evo:catalog-cost-import:${fileSha256}`);
  const rows = [];
  const keys = new Set();
  for (const [index, row] of file.rows.entries()) {
    const where = `rows[${index}]`;
    if (row === null || typeof row !== "object" || Array.isArray(row)) { problems.push(`${where}: object`); continue; }
    for (const key of Object.keys(row)) if (!ROW_KEYS.has(key)) problems.push(`${where}: unknown key ${key}`);
    if (typeof row.importKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/u.test(row.importKey)) problems.push(`${where}.importKey`);
    else if (keys.has(row.importKey)) problems.push(`${where}.importKey: duplicate ${row.importKey}`);
    keys.add(row.importKey);
    const byId = row.institutionId !== undefined;
    if (byId ? !(typeof row.institutionId === "string" && UUID.test(row.institutionId))
      : !(STUDY_COUNTRIES.includes(row.country) && typeof row.institutionName === "string" && row.institutionName !== "" && row.institutionName.length <= 300)) {
      problems.push(`${where}: institutionId, or country of the six and the exact institutionName`);
    }
    if (!KINDS.includes(row.costKind)) problems.push(`${where}.costKind`);
    if (!PERIODS.includes(row.period)) problems.push(`${where}.period`);
    if (row.studyLevel != null && !LEVELS.includes(row.studyLevel)) problems.push(`${where}.studyLevel`);
    if (row.programId != null && !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(row.programId)) problems.push(`${where}.programId`);
    if (row.teachingLanguage != null && !/^[a-z]{2}$/u.test(row.teachingLanguage)) problems.push(`${where}.teachingLanguage: ISO 639-1`);
    if (typeof row.currency !== "string" || !/^[A-Z]{3}$/u.test(row.currency)) problems.push(`${where}.currency`);
    const exponent = currencyExponent(row.currency);
    const min = row.amountMinMinor ?? (row.amountMin === undefined ? null : toMinor(row.amountMin, exponent));
    const rawMax = row.amountMaxMinor ?? (row.amountMax == null ? null : toMinor(row.amountMax, exponent));
    // Диапазон «от и до» с равными концами это одна сумма.
    const max = rawMax !== null && rawMax === min ? null : rawMax;
    if (!Number.isSafeInteger(min) || min < 0) problems.push(`${where}: amountMin (or amountMinMinor) with at most ${exponent} decimals`);
    if ((row.amountMax != null || row.amountMaxMinor != null) && max !== null) {
      if (!Number.isSafeInteger(max) || !(max > min)) problems.push(`${where}: amountMax must be above amountMin`);
    }
    if (!academicYearOk(row.academicYear)) problems.push(`${where}.academicYear: 2026/27, 2026 or null`);
    if ((row.noteRu == null) !== (row.noteKy == null) || (row.noteRu != null && !(textOk(row.noteRu, 300) && textOk(row.noteKy, 300)))) {
      problems.push(`${where}: noteRu and noteKy both up to 300 or both absent`);
    }
    if (!SOURCES.includes(row.sourceKind)) problems.push(`${where}.sourceKind`);
    if (!textOk(row.sourceName, 200)) problems.push(`${where}.sourceName`);
    if (row.sourceUrl != null && !publicUrlOk(row.sourceUrl)) problems.push(`${where}.sourceUrl: public https URL`);
    if (row.sourceKind !== "evo_document" && row.sourceUrl == null) problems.push(`${where}.sourceUrl: required for ${row.sourceKind}`);
    if (!dateOk(row.verifiedOn, today)) problems.push(`${where}.verifiedOn: YYYY-MM-DD not in the future`);
    if (row.confirmation != null) {
      const c = row.confirmation;
      if (row.sourceKind !== "agency") problems.push(`${where}.confirmation: only agency rows are confirmed`);
      if (typeof c !== "object" || Object.keys(c).some((k) => !["confirmedOn", "reason"].includes(k))
        || !dateOk(c.confirmedOn, today) || c.confirmedOn < "2026-01-01" || !textOk(c.reason, 500)) {
        problems.push(`${where}.confirmation: { confirmedOn: YYYY-MM-DD, reason: text up to 500 }`);
      }
    }
    if (row.publish !== undefined && typeof row.publish !== "boolean") problems.push(`${where}.publish: boolean`);
    if (row.publish === true && row.sourceKind === "agency" && row.confirmation == null) problems.push(`${where}: an agency row is published only with confirmation`);
    const rpcRow = {
      importKey: row.importKey,
      ...(byId ? { institutionId: row.institutionId } : { country: row.country, institutionName: row.institutionName }),
      programId: row.programId ?? null, studyLevel: row.studyLevel ?? null, teachingLanguage: row.teachingLanguage ?? null,
      costKind: row.costKind, period: row.period, amountMinMinor: min, amountMaxMinor: max, currency: row.currency,
      academicYear: row.academicYear ?? null, noteRu: row.noteRu ?? null, noteKy: row.noteKy ?? null, sourceKind: row.sourceKind,
      sourceName: row.sourceName, sourceUrl: row.sourceUrl ?? null, verifiedOn: row.verifiedOn,
      confirmation: row.confirmation ?? null, publish: row.publish === true,
    };
    rows.push(rpcRow);
  }
  const rates = [];
  for (const [index, rate] of (file.fxRates ?? []).entries()) {
    const where = `fxRates[${index}]`;
    if (rate === null || typeof rate !== "object") { problems.push(`${where}: object`); continue; }
    for (const key of Object.keys(rate)) if (!RATE_KEYS.has(key)) problems.push(`${where}: unknown key ${key}`);
    if (typeof rate.currency !== "string" || !/^[A-Z]{3}$/u.test(rate.currency) || rate.currency === "USD") problems.push(`${where}.currency: not USD`);
    if (!dateOk(rate.asOf, today)) problems.push(`${where}.asOf`);
    const units = typeof rate.unitsPerUsd === "string" ? rate.unitsPerUsd : String(rate.unitsPerUsd);
    if (!/^\d{1,9}(\.\d{1,12})?$/u.test(units) || Number(units) <= 0) problems.push(`${where}.unitsPerUsd: 1 USD = x units`);
    if (!textOk(rate.sourceName, 200)) problems.push(`${where}.sourceName`);
    if (rate.sourceUrl != null && !publicUrlOk(rate.sourceUrl)) problems.push(`${where}.sourceUrl`);
    rates.push({ p_currency: rate.currency, p_as_of: rate.asOf, p_units_per_usd: units, p_source_name: rate.sourceName,
      p_source_url: rate.sourceUrl ?? null, p_request_id: stableUuid(`${baseRequest}:fx:${rate.currency}:${rate.asOf}:${units}`) });
  }
  const batches = [];
  for (let start = 0; start < rows.length; start += RPC_BATCH) {
    batches.push({ p_rows: rows.slice(start, start + RPC_BATCH),
      p_request_id: start === 0 ? baseRequest : stableUuid(`${baseRequest}:batch:${start / RPC_BATCH}`) });
  }
  const count = (predicate) => rows.filter(predicate).length;
  const by = (field) => Object.fromEntries([...new Set(rows.map((r) => r[field] ?? "byId"))].sort().map((v) => [v, count((r) => (r[field] ?? "byId") === v)]));
  return {
    problems, organizationId: org, batches, rates,
    summary: {
      rows: rows.length, byCountry: by("country"), byKind: by("costKind"), bySource: by("sourceKind"),
      agencyConfirmed: count((r) => r.sourceKind === "agency" && r.confirmation), agencyUnconfirmed: count((r) => r.sourceKind === "agency" && !r.confirmation),
      publish: count((r) => r.publish), fxRates: rates.length, requestIds: batches.map((b) => b.p_request_id),
    },
  };
}

// Сид контент-потока (SEED_CONTRACT.md, costs-import.json) → строки импорта.
// Значения, которых нет в модели 283, переводятся явно: «registration»
// (сбор за регистрацию или зачисление) это application_fee плана 7.1 («сбор
// за подачу или регистрацию»), уточнение остаётся в note; «programme» это
// period program. importKey = «s3:» + request_id сида (UUIDv5, стабилен
// между пересборками), поэтому повторный импорт строку не дублирует.
const SEED_COST_KINDS = Object.freeze({ tuition: "tuition", accommodation: "accommodation", application_fee: "application_fee",
  registration: "application_fee", insurance: "insurance", other: "other" });
const SEED_PERIODS = Object.freeze({ year: "year", semester: "semester", month: "month", once: "once", programme: "program" });
const SEED_ROW_KEYS = new Set(["request_id", "country_code", "institution_name", "program_ref", "study_level", "cost_kind", "period",
  "amount_min_minor", "amount_max_minor", "currency", "academic_year", "note_ru", "note_ky", "ky_review", "source_kind",
  "source_name", "source_url", "verified_on", "confirmation", "status"]);
const SEED_CONFIRMATION_KEYS = ["confirmed_on", "confirmed_by", "channel", "statement", "scope"];
const SEED_RATE_KEYS = new Set(["currency", "as_of", "usd_per_unit", "units_per_usd", "source", "source_url", "method"]);

/**
 * Переводит costs-import.json и fx-rates.json сида в файл импорта. Ошибки
 * формы собираются в problems (тогда строки не годятся к импорту).
 */
export function fromContentSeed(costs, fx) {
  const problems = [];
  if (costs?.model !== "catalog_costs (plan 7.2)" || !Array.isArray(costs?.rows) || costs.count !== costs.rows.length) {
    problems.push("costs-import.json: expected { model: \"catalog_costs (plan 7.2)\", count, rows: [] }");
  }
  if (!Array.isArray(fx?.rates)) problems.push("fx-rates.json: expected { rates: [] }");
  const rows = [];
  for (const [index, row] of (Array.isArray(costs?.rows) ? costs.rows : []).entries()) {
    const where = `costs-import.json rows[${index}]`;
    if (row === null || typeof row !== "object" || Array.isArray(row)) { problems.push(`${where}: object`); continue; }
    for (const key of Object.keys(row)) if (!SEED_ROW_KEYS.has(key)) problems.push(`${where}: unknown key ${key}`);
    if (typeof row.request_id !== "string" || !UUID.test(row.request_id)) problems.push(`${where}.request_id: uuid`);
    if (!Object.hasOwn(SEED_COST_KINDS, row.cost_kind)) problems.push(`${where}.cost_kind: ${Object.keys(SEED_COST_KINDS).join(", ")}`);
    if (!Object.hasOwn(SEED_PERIODS, row.period)) problems.push(`${where}.period: ${Object.keys(SEED_PERIODS).join(", ")}`);
    if (row.program_ref != null) problems.push(`${where}.program_ref: only null is supported (rows describe a university and level)`);
    if (!["published", "draft"].includes(row.status)) problems.push(`${where}.status: published or draft`);
    if (!["pending", "done"].includes(row.ky_review)) problems.push(`${where}.ky_review: pending or done`);
    let confirmation = null;
    if (row.confirmation != null) {
      const c = row.confirmation;
      if (typeof c !== "object" || Array.isArray(c) || Object.keys(c).length !== SEED_CONFIRMATION_KEYS.length
        || !SEED_CONFIRMATION_KEYS.every((key) => typeof c[key] === "string" && c[key].trim() !== "") || c.confirmed_by !== "owner") {
        problems.push(`${where}.confirmation: { ${SEED_CONFIRMATION_KEYS.join(", ")} } with confirmed_by "owner"`);
      } else {
        // Видно только сотрудникам (staff_catalog_geography_v1), студенту не отдаётся.
        confirmation = { confirmedOn: c.confirmed_on,
          reason: `Подтверждение владельца (${c.channel}): «${c.statement}». Охват: ${c.scope}.` };
      }
    }
    rows.push({
      importKey: `s3:${row.request_id}`, country: row.country_code, institutionName: row.institution_name,
      programId: null, studyLevel: row.study_level ?? null, teachingLanguage: null,
      costKind: SEED_COST_KINDS[row.cost_kind] ?? row.cost_kind, period: SEED_PERIODS[row.period] ?? row.period,
      amountMinMinor: row.amount_min_minor, amountMaxMinor: row.amount_max_minor ?? null, currency: row.currency,
      academicYear: row.academic_year ?? null, noteRu: row.note_ru ?? null, noteKy: row.note_ky ?? null,
      sourceKind: row.source_kind, sourceName: row.source_name, sourceUrl: row.source_url ?? null, verifiedOn: row.verified_on,
      confirmation, publish: row.status === "published",
    });
  }
  const fxRates = [];
  for (const [index, rate] of (Array.isArray(fx?.rates) ? fx.rates : []).entries()) {
    const where = `fx-rates.json rates[${index}]`;
    if (rate === null || typeof rate !== "object") { problems.push(`${where}: object`); continue; }
    for (const key of Object.keys(rate)) if (!SEED_RATE_KEYS.has(key)) problems.push(`${where}: unknown key ${key}`);
    // Строка USD в сиде это тождество для колонки USD; курс USD к USD не хранится.
    if (rate.currency === "USD") {
      if (rate.units_per_usd !== "1" || rate.usd_per_unit !== "1") problems.push(`${where}: the USD row must be the identity 1`);
      continue;
    }
    fxRates.push({ currency: rate.currency, asOf: rate.as_of, unitsPerUsd: rate.units_per_usd,
      sourceName: rate.source, sourceUrl: rate.source_url ?? null });
  }
  return { problems, file: { schemaVersion: 1, rows, fxRates } };
}

function readAccess(environment, auth) {
  const raw = environment.NEXT_PUBLIC_SUPABASE_URL;
  let url;
  try { url = new URL(raw); } catch { fail("invalid_supabase_url"); }
  const project = /^([a-z0-9]{20})\.supabase\.co$/u.exec(url.hostname);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port;
  if (url.pathname !== "/" || url.search || !((url.protocol === "https:" && project) || local)) fail("unsupported_supabase_url");
  const target = project ? `supabase-project ${project[1]}` : "local-stack";
  if (auth === "staff") {
    const token = environment.EVO_CATALOG_STAFF_ACCESS_TOKEN, key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!token || !key || /\s/u.test(token + key)) fail("missing_staff_session");
    return { origin: url.origin, target, headers: { apikey: key, Authorization: `Bearer ${token}` }, actor: null };
  }
  if (auth === "service") {
    const key = environment.EVO_PLATFORM_SUPABASE_SECRET_KEY, actor = environment.EVO_CATALOG_ACTOR_MEMBERSHIP_ID;
    if (!key || /\s/u.test(key)) fail("missing_secret_key");
    if (!actor || !UUID.test(actor)) fail("missing_actor_membership");
    const headers = { apikey: key };
    if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
    return { origin: url.origin, target, headers, actor };
  }
  fail("auth_mode_required");
}

async function callRpc(fetchImpl, access, name, args) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 120_000);
  let response;
  try {
    response = await fetchImpl(`${access.origin}/rest/v1/rpc/${name}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: stop.signal,
      headers: { ...access.headers, "content-type": "application/json", accept: "application/json", "content-profile": "platform", "accept-profile": "platform" },
      body: JSON.stringify(access.actor ? { ...args, p_actor_membership_id: access.actor } : args),
    });
  } catch {
    fail(stop.signal.aborted ? "rpc_timeout" : "network_error");
  } finally { clearTimeout(timer); }
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok) {
    // Код и сообщение PostgREST (SQLSTATE и текст исключения RPC); ключей в них нет.
    return { ok: false, status: response.status, code: body?.code ?? null, message: typeof body?.message === "string" ? body.message.slice(0, 300) : null };
  }
  return { ok: true, body };
}

export async function runImport(argv, { environment = process.env, fetchImpl = fetch, write = (text) => process.stdout.write(text) } = {}) {
  let filePath = null, seedDir = null, apply = false, auth = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") filePath = argv[++index];
    else if (arg === "--seed-dir") seedDir = argv[++index];
    else if (arg === "--apply") apply = true;
    else if (arg === "--auth") auth = argv[++index];
    else if (arg === "--help") {
      write("Usage: node scripts/catalog/import-catalog-costs.mjs (--seed-dir DIR | --file costs.json) [--apply --auth staff|service]\n");
      return 0;
    } else { write(`${JSON.stringify({ status: "arguments_invalid" })}\n`); return 1; }
  }
  if (Boolean(filePath) === Boolean(seedDir)) { write(`${JSON.stringify({ status: "file_or_seed_dir_required" })}\n`); return 1; }
  let digest, file;
  if (seedDir) {
    let costsRaw, fxRaw, converted;
    try {
      costsRaw = readFileSync(resolve(seedDir, "costs-import.json"));
      fxRaw = readFileSync(resolve(seedDir, "fx-rates.json"));
      converted = fromContentSeed(JSON.parse(costsRaw.toString("utf8")), JSON.parse(fxRaw.toString("utf8")));
    } catch { write(`${JSON.stringify({ status: "seed_files_invalid" })}\n`); return 1; }
    if (converted.problems.length > 0) { write(`${JSON.stringify({ status: "seed_invalid", problems: converted.problems }, null, 2)}\n`); return 1; }
    // request_id пакета выводится из байтов обоих файлов сида.
    digest = createHash("sha256").update(costsRaw).update("\u0000").update(fxRaw).digest("hex");
    file = converted.file;
  } else {
    let raw;
    try { raw = readFileSync(resolve(filePath)); file = JSON.parse(raw.toString("utf8")); } catch { write(`${JSON.stringify({ status: "file_invalid" })}\n`); return 1; }
    digest = createHash("sha256").update(raw).digest("hex");
  }
  const plan = planImport(file, { fileSha256: digest, organizationId: environment.EVO_PLATFORM_ORGANIZATION_ID });
  if (plan.problems.length > 0) { write(`${JSON.stringify({ status: "import_invalid", problems: plan.problems }, null, 2)}\n`); return 1; }
  if (!apply) { write(`${JSON.stringify({ status: "dry_run", ...plan.summary }, null, 2)}\n`); return 0; }
  try {
    const access = readAccess(environment, auth);
    const results = { status: "applied", target: access.target, auth, batches: [], fxRates: [] };
    for (const batch of plan.batches) {
      const result = await callRpc(fetchImpl, access, "staff_catalog_cost_import_v1", { p_organization_id: plan.organizationId, ...batch });
      if (!result.ok) { write(`${JSON.stringify({ ...results, status: "import_failed", requestId: batch.p_request_id, error: result }, null, 2)}\n`); return 1; }
      const statuses = {};
      for (const row of result.body.rows ?? []) statuses[row.status] = (statuses[row.status] ?? 0) + 1;
      results.batches.push({ requestId: batch.p_request_id, created: result.body.created, existing: result.body.existing,
        institutionMissing: result.body.institutionMissing, statuses,
        missing: (result.body.rows ?? []).filter((row) => row.status === "institution_missing").map((row) => row.importKey) });
    }
    for (const rate of plan.rates) {
      const result = await callRpc(fetchImpl, access, "staff_catalog_fx_rate_set_v1", { p_organization_id: plan.organizationId, ...rate });
      if (!result.ok) { write(`${JSON.stringify({ ...results, status: "fx_rate_failed", currency: rate.p_currency, error: result }, null, 2)}\n`); return 1; }
      results.fxRates.push({ currency: rate.p_currency, asOf: rate.p_as_of, unitsPerUsd: result.body.unitsPerUsd });
    }
    write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ImportError) { write(`${JSON.stringify({ status: error.code })}\n`); return 1; }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runImport(process.argv.slice(2));
}
