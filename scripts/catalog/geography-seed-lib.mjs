/**
 * Общая часть сида географии 283 (страны, города, связи вуз → город) для
 * scripts/catalog/generate-geography-seed.mjs и
 * scripts/catalog/upload-geography-photos.mjs: чтение и проверка входов,
 * sha256 и размеры фото, путь объекта в Storage, SQL раздела сида.
 *
 * Входная схема описана в docs/catalog/geography-costs-contract.md («Сид»)
 * и в output/student-app-v2/seed/SEED_CONTRACT.backend.md. Файлы:
 *   countries.json          { schemaVersion: 1, countries: [CountryInput] }
 *   cities.json             { schemaVersion: 1, cities: [CityInput] }
 *   institution-cities.json { schemaVersion: 1, links: [LinkInput] }
 * Путь photo.file задаётся относительно папки сида.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MIGRATION_FILE = resolve(REPO_ROOT, "supabase/migrations/283_platform_catalog_geography_costs.sql");
export const SEED_BEGIN = "-- >>> BEGIN GENERATED GEOGRAPHY SEED (scripts/catalog/generate-geography-seed.mjs)";
export const SEED_END = "-- <<< END GENERATED GEOGRAPHY SEED";
export const PHOTO_BUCKET = "portal-university-photos";
export const STUDY_COUNTRY_CODES = Object.freeze(["CN", "MY", "AE", "TR", "IT", "CZ"]);
const PHOTO_SOURCE_HOSTS = Object.freeze(new Map([
  ["Unsplash", ["unsplash.com", "www.unsplash.com"]],
  ["Pexels", ["pexels.com", "www.pexels.com"]],
  ["Wikimedia Commons", ["commons.wikimedia.org", "upload.wikimedia.org"]],
]));
const BLOCKED_HOST_PATTERN = /eduprchina/i;
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export class SeedError extends Error {
  constructor(problems) {
    super(`geography seed invalid: ${problems.length} problem(s)`);
    this.problems = problems;
  }
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Текст для студента: непустой, без управляющих символов и краевых пробелов (как catalog_text_ok в 283). */
function textOk(value, max) {
  return typeof value === "string" && value.trim() !== "" && value === value.trim()
    && [...value].length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Как platform_private.university_public_url в 148: https, публичный хост, без секретов в запросе. */
export function publicUrlOk(value) {
  if (typeof value !== "string" || value.length > 1000 || /[\u0000-\u001f\u007f\s]/u.test(value)) return false;
  if (!/^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}([/?][^\s#\\]*)?$/u.test(value)) return false;
  if (/\.(localhost|local|internal|test|invalid|example)([/?]|$)/iu.test(value)) return false;
  if (/[?&][^=&]*%[^=&]*(=|&|$)/u.test(value)) return false;
  return !/[?&][^=&]*(token|secret|password|auth|api.?key)[^=&]*(=|&|$)/iu.test(value);
}

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };

function dateOk(value, today) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    && value >= "2000-01-01" && value <= today;
}

/** Размеры и тип изображения по байтам: JPEG, PNG, WebP. */
export function imageInfo(bytes) {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("ascii", 12, 16) === "IHDR") {
    return { contentType: "image/png", extension: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { contentType: "image/webp", extension: "webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { contentType: "image/webp", extension: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { contentType: "image/webp", extension: "webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { contentType: "image/jpeg", extension: "jpg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

/** Объект в бакете: geography/<scope>/<имя>-<12 знаков sha256>.<расширение>. */
export const photoObjectPath = (scope, name, digest, extension) => `geography/${scope}/${name}-${digest.slice(0, 12)}.${extension}`;

function readJsonFile(path, problems, allowMissing) {
  if (!existsSync(path)) {
    if (!allowMissing) problems.push(`${path}: file missing`);
    return null;
  }
  const raw = readFileSync(path);
  try {
    return { value: JSON.parse(raw.toString("utf8")), sha256: sha256(raw) };
  } catch {
    problems.push(`${path}: invalid JSON`);
    return null;
  }
}

function exactKeys(value, required, optional, where, problems) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) { problems.push(`${where}: not an object`); return false; }
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) problems.push(`${where}: missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) problems.push(`${where}: unknown key ${key}`);
  return true;
}

function readPhoto(photo, scope, name, seedDir, where, problems) {
  if (photo === null || photo === undefined) return null;
  if (!exactKeys(photo, ["file", "author", "sourceName", "sourceUrl", "license"], ["authorUrl", "licenseUrl"], where, problems)) return null;
  const before = problems.length;
  if (!textOk(photo.author, 200)) problems.push(`${where}.author: required text up to 200`);
  if (photo.authorUrl != null && !publicUrlOk(photo.authorUrl)) problems.push(`${where}.authorUrl: not a public https URL`);
  if (!PHOTO_SOURCE_HOSTS.has(photo.sourceName)) problems.push(`${where}.sourceName: must be Unsplash, Pexels or Wikimedia Commons`);
  if (!publicUrlOk(photo.sourceUrl) || !(PHOTO_SOURCE_HOSTS.get(photo.sourceName) ?? []).includes(hostOf(photo.sourceUrl))) {
    problems.push(`${where}.sourceUrl: must be a public https URL on the ${photo.sourceName} host`);
  }
  if (!textOk(photo.license, 120)) problems.push(`${where}.license: required text up to 120`);
  if (photo.licenseUrl != null && !publicUrlOk(photo.licenseUrl)) problems.push(`${where}.licenseUrl: not a public https URL`);
  if (BLOCKED_HOST_PATTERN.test(JSON.stringify(photo))) problems.push(`${where}: agency source is not allowed`);
  if (typeof photo.file !== "string" || photo.file.trim() === "") { problems.push(`${where}.file: required`); return null; }
  const file = isAbsolute(photo.file) ? photo.file : resolve(seedDir, photo.file);
  if (!existsSync(file) || !statSync(file).isFile()) { problems.push(`${where}.file: ${photo.file} not found`); return null; }
  const bytes = readFileSync(file);
  if (bytes.length < 1024 || bytes.length > MAX_PHOTO_BYTES) problems.push(`${where}.file: size ${bytes.length} outside 1 KB to 20 MB`);
  const info = imageInfo(bytes);
  if (!info || !(info.width >= 1 && info.width <= 99999 && info.height >= 1 && info.height <= 99999)) {
    problems.push(`${where}.file: not a JPEG, PNG or WebP image`);
    return null;
  }
  if (problems.length > before) return null;
  const digest = sha256(bytes);
  return {
    upload: { file, bytes: bytes.length, sha256: digest, contentType: info.contentType,
      path: photoObjectPath(scope, name, digest, info.extension) },
    db: {
      path: photoObjectPath(scope, name, digest, info.extension), width: info.width, height: info.height,
      author: photo.author, authorUrl: photo.authorUrl ?? null, sourceName: photo.sourceName, sourceUrl: photo.sourceUrl,
      license: photo.license, licenseUrl: photo.licenseUrl ?? null,
    },
  };
}

function pairOk(ru, ky, max) {
  return (ru == null && ky == null) || (textOk(ru, max) && textOk(ky, max));
}

/**
 * Читает и проверяет входы сида. allowMissing: отсутствующий файл даёт
 * пустую часть (сид без городов), а не ошибку.
 */
export function loadGeographySeed({ seedDir, allowMissing = false, today = new Date().toISOString().slice(0, 10) }) {
  const problems = [];
  const studyCountries = JSON.parse(readFileSync(resolve(REPO_ROOT, "src/lib/study-countries.json"), "utf8"));
  const codes = studyCountries.countries.map((country) => country.code);
  if (JSON.stringify(codes) !== JSON.stringify(STUDY_COUNTRY_CODES)) problems.push("src/lib/study-countries.json: codes differ from CN, MY, AE, TR, IT, CZ");
  const inputs = {
    countries: readJsonFile(resolve(seedDir, "countries.json"), problems, allowMissing),
    cities: readJsonFile(resolve(seedDir, "cities.json"), problems, allowMissing),
    links: readJsonFile(resolve(seedDir, "institution-cities.json"), problems, allowMissing),
  };
  const countries = [];
  const cities = [];
  const links = [];
  const uploads = [];

  if (inputs.countries) {
    const root = inputs.countries.value;
    if (root?.schemaVersion !== 1 || !Array.isArray(root?.countries)) problems.push("countries.json: expected { schemaVersion: 1, countries: [] }");
    const seen = new Set();
    for (const [index, item] of (Array.isArray(root?.countries) ? root.countries : []).entries()) {
      const where = `countries.json countries[${index}]`;
      if (!exactKeys(item, ["code"], ["summaryRu", "summaryKy", "kyReview", "photo"], where, problems)) continue;
      if (!codes.includes(item.code)) { problems.push(`${where}.code: not a product country`); continue; }
      if (seen.has(item.code)) problems.push(`${where}.code: duplicate ${item.code}`);
      seen.add(item.code);
      if (!pairOk(item.summaryRu, item.summaryKy, 300)) problems.push(`${where}: summaryRu and summaryKy must both be text up to 300 or both absent`);
      if (item.kyReview != null && !["pending", "done"].includes(item.kyReview)) problems.push(`${where}.kyReview: pending or done`);
      const photo = readPhoto(item.photo, "countries", item.code.toLowerCase(), seedDir, `${where}.photo`, problems);
      if (photo) uploads.push({ scope: "country", key: item.code, ...photo.upload });
      countries.push({ code: item.code, summaryRu: item.summaryRu ?? null, summaryKy: item.summaryKy ?? null,
        kyReview: item.kyReview ?? "pending", photo: photo?.db ?? null });
    }
  }

  if (inputs.cities) {
    const root = inputs.cities.value;
    if (root?.schemaVersion !== 1 || !Array.isArray(root?.cities)) problems.push("cities.json: expected { schemaVersion: 1, cities: [] }");
    const seenKeys = new Set();
    const seenNames = new Set();
    for (const [index, item] of (Array.isArray(root?.cities) ? root.cities : []).entries()) {
      const where = `cities.json cities[${index}]`;
      if (!exactKeys(item, ["key", "country", "nameRu", "nameKy", "nameEn", "status"],
        ["lat", "lng", "summaryRu", "summaryKy", "factRu", "factKy", "factSourceUrl", "factVerifiedOn", "kyReview", "photo"], where, problems)) continue;
      const before = problems.length;
      if (typeof item.key !== "string" || !KEY_PATTERN.test(item.key) || item.key.length < 2 || item.key.length > 64) problems.push(`${where}.key: lowercase latin slug, 2 to 64`);
      if (seenKeys.has(item.key)) problems.push(`${where}.key: duplicate ${item.key}`);
      seenKeys.add(item.key);
      if (!codes.includes(item.country)) problems.push(`${where}.country: not a product country`);
      for (const field of ["nameRu", "nameKy", "nameEn"]) if (!textOk(item[field], 100)) problems.push(`${where}.${field}: required text up to 100`);
      if (seenNames.has(`${item.country}:${item.nameRu}`)) problems.push(`${where}.nameRu: duplicate in ${item.country}`);
      seenNames.add(`${item.country}:${item.nameRu}`);
      const hasLat = item.lat != null, hasLng = item.lng != null;
      if (hasLat !== hasLng || (hasLat && !(Number.isFinite(item.lat) && item.lat >= -90 && item.lat <= 90
        && Number.isFinite(item.lng) && item.lng >= -180 && item.lng <= 180))) problems.push(`${where}: lat and lng must both be valid numbers or both absent`);
      if (!pairOk(item.summaryRu, item.summaryKy, 300)) problems.push(`${where}: summaryRu and summaryKy must both be text up to 300 or both absent`);
      if (!pairOk(item.factRu, item.factKy, 200)) problems.push(`${where}: factRu and factKy must both be text up to 200 or both absent`);
      if (item.factSourceUrl != null && !publicUrlOk(item.factSourceUrl)) problems.push(`${where}.factSourceUrl: not a public https URL`);
      if (item.factVerifiedOn != null && !dateOk(item.factVerifiedOn, today)) problems.push(`${where}.factVerifiedOn: YYYY-MM-DD not in the future`);
      if (item.kyReview != null && !["pending", "done"].includes(item.kyReview)) problems.push(`${where}.kyReview: pending or done`);
      if (!["draft", "published"].includes(item.status)) problems.push(`${where}.status: draft or published`);
      const photo = readPhoto(item.photo, "cities", `${String(item.country).toLowerCase()}-${item.key}`, seedDir, `${where}.photo`, problems);
      if (item.status === "published" && (!photo || item.summaryRu == null || item.factRu == null
        || item.factSourceUrl == null || item.factVerifiedOn == null)) {
        problems.push(`${where}: a published city needs photo, summary, fact, fact source and verification date`);
      }
      if (problems.length > before) continue;
      if (photo) uploads.push({ scope: "city", key: item.key, ...photo.upload });
      cities.push({ key: item.key, country: item.country, nameRu: item.nameRu, nameKy: item.nameKy, nameEn: item.nameEn,
        lat: item.lat ?? null, lng: item.lng ?? null, summaryRu: item.summaryRu ?? null, summaryKy: item.summaryKy ?? null,
        factRu: item.factRu ?? null, factKy: item.factKy ?? null, factSourceUrl: item.factSourceUrl ?? null,
        factVerifiedOn: item.factVerifiedOn ?? null, kyReview: item.kyReview ?? "pending", status: item.status, photo: photo?.db ?? null });
    }
  }

  if (inputs.links) {
    const root = inputs.links.value;
    if (root?.schemaVersion !== 1 || !Array.isArray(root?.links)) problems.push("institution-cities.json: expected { schemaVersion: 1, links: [] }");
    const cityCountry = new Map(cities.map((city) => [city.key, city.country]));
    const seen = new Set();
    for (const [index, item] of (Array.isArray(root?.links) ? root.links : []).entries()) {
      const where = `institution-cities.json links[${index}]`;
      if (!exactKeys(item, ["country", "institutionName", "cityKey"], [], where, problems)) continue;
      const before = problems.length;
      if (!codes.includes(item.country)) problems.push(`${where}.country: not a product country`);
      if (typeof item.institutionName !== "string" || item.institutionName === "" || item.institutionName.length > 300) problems.push(`${where}.institutionName: exact catalog name required`);
      if (!cityCountry.has(item.cityKey)) problems.push(`${where}.cityKey: ${item.cityKey} is not in cities.json`);
      else if (cityCountry.get(item.cityKey) !== item.country) problems.push(`${where}: city ${item.cityKey} is in ${cityCountry.get(item.cityKey)}, not ${item.country}`);
      const identity = `${item.country}\u0000${item.institutionName}`;
      if (seen.has(identity)) problems.push(`${where}: duplicate institution ${item.country} ${item.institutionName}`);
      seen.add(identity);
      if (problems.length === before) links.push({ country: item.country, institutionName: item.institutionName, cityKey: item.cityKey });
    }
  }

  if (problems.length > 0) throw new SeedError(problems);
  // Правило текстов EVO: без длинного и среднего тире. Не ошибка входа, а
  // предупреждение в отчёте генератора (тексты правит контент-поток).
  const warnings = [];
  const dash = /[\u2013\u2014]/u;
  for (const country of countries) for (const field of ["summaryRu", "summaryKy"]) {
    if (dash.test(country[field] ?? "")) warnings.push(`countries ${country.code}.${field}: em or en dash`);
  }
  for (const city of cities) for (const field of ["nameRu", "nameKy", "summaryRu", "summaryKy", "factRu", "factKy"]) {
    if (dash.test(city[field] ?? "")) warnings.push(`cities ${city.key}.${field}: em or en dash`);
  }
  return {
    warnings,
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value ? value.sha256 : null])),
    countries, cities, links, uploads,
  };
}

const sqlText = (value) => (value == null ? "NULL::TEXT" : `'${String(value).replaceAll("'", "''")}'`);
const sqlJson = (value) => (value == null ? "NULL::JSONB" : `${sqlText(JSON.stringify(value))}::JSONB`);
const sqlDate = (value) => (value == null ? "NULL::DATE" : `${sqlText(value)}::DATE`);
const sqlNumber = (value) => (value == null ? "NULL::DOUBLE PRECISION" : `${Number(value).toString()}::DOUBLE PRECISION`);

/** SQL раздела сида между маркерами (маркеры включены). */
export function buildSeedSql(seed) {
  const published = seed.cities.filter((city) => city.status === "published").length;
  const lines = [
    SEED_BEGIN,
    "-- Руками не править: node scripts/catalog/generate-geography-seed.mjs --seed-dir <папка> --write.",
    `-- Входы (sha256): countries.json ${seed.inputs.countries ?? "нет"}, cities.json ${seed.inputs.cities ?? "нет"},`,
    `--   institution-cities.json ${seed.inputs.links ?? "нет"}.`,
    `-- Страны: ${seed.countries.length} (с фото ${seed.countries.filter((c) => c.photo).length}); города: ${seed.cities.length} (опубликовано ${published}); связи вуз → город: ${seed.links.length}.`,
    "-- Города создаются для каждой организации, где есть вуз этой страны; вуз связывается по",
    "-- (country_code, точное institution_name), отсутствующий вуз пропускается.",
  ];
  if (seed.countries.length > 0) {
    lines.push(
      "UPDATE platform.study_countries AS s SET photo = v.photo, summary_ru = v.summary_ru, summary_ky = v.summary_ky,",
      "  ky_review = v.ky_review, updated_at = clock_timestamp()",
      "FROM (VALUES",
      seed.countries.map((c) => `  (${sqlText(c.code)}, ${sqlJson(c.photo)}, ${sqlText(c.summaryRu)}, ${sqlText(c.summaryKy)}, ${sqlText(c.kyReview)})`).join(",\n"),
      ") AS v(country_code, photo, summary_ru, summary_ky, ky_review)",
      "WHERE s.country_code = v.country_code;",
    );
  }
  if (seed.cities.length > 0) {
    lines.push(
      "INSERT INTO platform.catalog_cities (organization_id, city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo,",
      "  summary_ru, summary_ky, fact_ru, fact_ky, fact_source_url, fact_verified_on, ky_review, status, published_at, published_via)",
      "SELECT o.id, v.city_key, v.country_code, v.name_ru, v.name_ky, v.name_en, v.lat, v.lng, v.photo,",
      "  v.summary_ru, v.summary_ky, v.fact_ru, v.fact_ky, v.fact_source_url, v.fact_verified_on, v.ky_review, v.status,",
      "  CASE WHEN v.status = 'published' THEN clock_timestamp() END, CASE WHEN v.status = 'published' THEN 'migration' END",
      "FROM platform.organizations o",
      "CROSS JOIN (VALUES",
      seed.cities.map((c) => `  (${[sqlText(c.key), sqlText(c.country), sqlText(c.nameRu), sqlText(c.nameKy), sqlText(c.nameEn),
        sqlNumber(c.lat), sqlNumber(c.lng), sqlJson(c.photo), sqlText(c.summaryRu), sqlText(c.summaryKy), sqlText(c.factRu),
        sqlText(c.factKy), sqlText(c.factSourceUrl), sqlDate(c.factVerifiedOn), sqlText(c.kyReview), sqlText(c.status)].join(", ")})`).join(",\n"),
      ") AS v(city_key, country_code, name_ru, name_ky, name_en, lat, lng, photo, summary_ru, summary_ky, fact_ru, fact_ky,",
      "  fact_source_url, fact_verified_on, ky_review, status)",
      "WHERE EXISTS (SELECT 1 FROM platform.catalog_institutions i WHERE i.organization_id = o.id AND i.country_code = v.country_code);",
    );
  }
  if (seed.links.length > 0) {
    lines.push(
      "INSERT INTO platform.catalog_institution_cities (institution_id, organization_id, city_key, assigned_via)",
      "SELECT i.id, i.organization_id, v.city_key, 'migration'",
      "FROM (VALUES",
      seed.links.map((l) => `  (${sqlText(l.country)}, ${sqlText(l.institutionName)}, ${sqlText(l.cityKey)})`).join(",\n"),
      ") AS v(country_code, institution_name, city_key)",
      "JOIN platform.catalog_institutions i ON i.country_code = v.country_code AND i.institution_name = v.institution_name",
      "JOIN platform.catalog_cities c ON c.organization_id = i.organization_id AND c.city_key = v.city_key",
      "  AND c.country_code = v.country_code;",
    );
  }
  lines.push(SEED_END);
  return `${lines.join("\n")}\n`;
}

/** Заменяет раздел сида в тексте миграции; ошибка, если маркеров не ровно по одному. */
export function replaceSeedSection(migrationText, sectionSql) {
  const begin = migrationText.indexOf(SEED_BEGIN);
  const end = migrationText.indexOf(SEED_END);
  if (begin < 0 || end < begin || migrationText.indexOf(SEED_BEGIN, begin + 1) >= 0 || migrationText.indexOf(SEED_END, end + 1) >= 0) {
    throw new Error("seed markers missing or repeated in migration 283");
  }
  const afterEnd = migrationText.indexOf("\n", end);
  return migrationText.slice(0, begin) + sectionSql + migrationText.slice(afterEnd + 1);
}

/** Покрытие production: каждый опубликованный вуз шести стран связан? */
export function coverageAgainst(seed, institutions) {
  const linked = new Set(seed.links.map((link) => `${link.country}\u0000${link.institutionName}`));
  const known = new Set(institutions.map((item) => `${item.country_code}\u0000${item.institution_name}`));
  const missing = institutions.filter((item) => !linked.has(`${item.country_code}\u0000${item.institution_name}`))
    .map((item) => ({ country: item.country_code, institutionName: item.institution_name }));
  const unknown = seed.links.filter((link) => !known.has(`${link.country}\u0000${link.institutionName}`));
  const cityStatus = new Map(seed.cities.map((city) => [city.key, city.status]));
  const toPublished = seed.links.filter((link) => known.has(`${link.country}\u0000${link.institutionName}`)
    && cityStatus.get(link.cityKey) === "published").length;
  return { institutions: institutions.length, linked: institutions.length - missing.length, linkedToPublishedCity: toPublished,
    missing, unknownLinks: unknown };
}
