/**
 * Общая часть сида географии 283 (страны, города, связи вуз → город) для
 * scripts/catalog/generate-geography-seed.mjs и
 * scripts/catalog/upload-geography-photos.mjs: чтение и проверка входов,
 * sha256 и размеры фото, путь объекта в Storage, SQL раздела сида.
 *
 * Входная схема: контракт контент-потока
 * output/student-app-v2/seed/SEED_CONTRACT.md (snake_case), сводка в
 * docs/catalog/geography-costs-contract.md, раздел 4. Файлы папки сида:
 *   countries.json          { generated_on, count, countries: [Country] }
 *   cities.json             { generated_on, count, cities: [City] }
 *   institution-cities.json { generated_on, count, match_rule, links: [Link] }
 *   photos-manifest.json    { generated_on, count, rules, photos: [Photo] }
 * Путь photo.file и photos[].file задаётся относительно папки сида.
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

export const SEED_FILES = Object.freeze({
  countries: "countries.json", cities: "cities.json", links: "institution-cities.json", photos: "photos-manifest.json",
});
// source манифеста → sourceName в базе (CHECK catalog_photo_valid в 283).
const PHOTO_SOURCES = Object.freeze(new Map([
  ["unsplash", "Unsplash"], ["pexels", "Pexels"], ["wikimedia_commons", "Wikimedia Commons"],
]));
const LINK_RESOLUTIONS = Object.freeze(["exact", "latin_alias_merged", "latin_name", "composite_city_string", "empty_city_resolved"]);
// Длинное, среднее и похожие тире запрещены в текстах для людей (правило EVO).
const DASH_PATTERN = /[‒-―]/u;

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

/** Корень файла: { generated_on, count, <list>: [] } и count равен длине списка. */
function readRoot(input, file, listKey, optional, problems, today) {
  if (!input) return [];
  const root = input.value;
  if (!exactKeys(root, ["generated_on", "count", listKey], optional, file, problems)) return [];
  if (!dateOk(root.generated_on, today)) problems.push(`${file}.generated_on: YYYY-MM-DD not in the future`);
  if (!Array.isArray(root[listKey])) { problems.push(`${file}.${listKey}: array expected`); return []; }
  if (root.count !== root[listKey].length) problems.push(`${file}.count: ${root.count} but ${root[listKey].length} items`);
  return root[listKey];
}

function studentText(value, max, where, problems, { nullable = false } = {}) {
  if (value == null && nullable) return;
  if (!textOk(value, max)) problems.push(`${where}: required text up to ${max}`);
  else if (DASH_PATTERN.test(value)) problems.push(`${where}: em or en dash (EVO text rule)`);
}

/**
 * Фото места: { key, file } в карточке и запись манифеста с тем же key.
 * Байты файла сверяются с sha256, bytes, width, height манифеста.
 */
function readPhoto(photo, { placeType, placeKey, scope, objectName }, manifest, seedDir, where, problems) {
  if (photo === null || photo === undefined) return null;
  if (!exactKeys(photo, ["key", "file"], [], where, problems)) return null;
  const expectedKey = `${placeType}-${placeType === "country" ? placeKey.toLowerCase() : placeKey}`;
  if (photo.key !== expectedKey) { problems.push(`${where}.key: expected ${expectedKey}`); return null; }
  const entry = manifest.get(photo.key);
  if (!entry) { problems.push(`${where}: ${photo.key} is not in photos-manifest.json`); return null; }
  entry.used = true;
  const m = entry.value;
  const at = `photos-manifest.json ${photo.key}`;
  const before = problems.length;
  if (m.file !== photo.file) problems.push(`${at}.file: ${m.file} differs from the card (${photo.file})`);
  if (m.place_type !== placeType || m.place_key !== placeKey) problems.push(`${at}: place ${m.place_type}/${m.place_key}, expected ${placeType}/${placeKey}`);
  if (!textOk(m.author, 200)) problems.push(`${at}.author: required text up to 200`);
  if (m.author_url != null && !publicUrlOk(m.author_url)) problems.push(`${at}.author_url: not a public https URL`);
  const sourceName = PHOTO_SOURCES.get(m.source);
  if (!sourceName) problems.push(`${at}.source: unsplash, pexels or wikimedia_commons`);
  if (!publicUrlOk(m.source_url) || !(PHOTO_SOURCE_HOSTS.get(sourceName) ?? []).includes(hostOf(m.source_url))) {
    problems.push(`${at}.source_url: must be a public https URL on the ${sourceName ?? m.source} host`);
  }
  if (!textOk(m.licence, 120)) problems.push(`${at}.licence: required text up to 120`);
  if (m.licence_url != null && !publicUrlOk(m.licence_url)) problems.push(`${at}.licence_url: not a public https URL`);
  if (typeof m.attribution_required !== "boolean") problems.push(`${at}.attribution_required: boolean`);
  if (BLOCKED_HOST_PATTERN.test(JSON.stringify(m))) problems.push(`${at}: agency source is not allowed`);
  if (typeof photo.file !== "string" || photo.file.trim() === "" || isAbsolute(photo.file)) { problems.push(`${where}.file: relative path required`); return null; }
  const file = resolve(seedDir, photo.file);
  if (!existsSync(file) || !statSync(file).isFile()) { problems.push(`${where}.file: ${photo.file} not found`); return null; }
  const bytes = readFileSync(file);
  if (bytes.length < 1024 || bytes.length > MAX_PHOTO_BYTES) problems.push(`${where}.file: size ${bytes.length} outside 1 KB to 20 MB`);
  const info = imageInfo(bytes);
  if (!info || !(info.width >= 1 && info.width <= 99999 && info.height >= 1 && info.height <= 99999)) {
    problems.push(`${where}.file: not a JPEG, PNG or WebP image`);
    return null;
  }
  const digest = sha256(bytes);
  if (m.sha256 !== digest || m.bytes !== bytes.length || m.width !== info.width || m.height !== info.height) {
    problems.push(`${at}: sha256, bytes, width or height differ from ${photo.file}`);
  }
  if (problems.length > before) return null;
  const path = photoObjectPath(scope, objectName, digest, info.extension);
  return {
    upload: { file, bytes: bytes.length, sha256: digest, contentType: info.contentType, path },
    db: {
      path, width: info.width, height: info.height,
      author: m.author, authorUrl: m.author_url ?? null, sourceName, sourceUrl: m.source_url,
      license: m.licence, licenseUrl: m.licence_url ?? null,
    },
  };
}

function pairOk(ru, ky, max) {
  return (ru == null && ky == null) || (textOk(ru, max) && textOk(ky, max));
}

/**
 * Читает и проверяет входы сида (SEED_CONTRACT.md контент-потока).
 * allowMissing: отсутствующий файл даёт пустую часть (сид без городов), а не ошибку.
 */
export function loadGeographySeed({ seedDir, allowMissing = false, today = new Date().toISOString().slice(0, 10) }) {
  const problems = [];
  const studyCountries = JSON.parse(readFileSync(resolve(REPO_ROOT, "src/lib/study-countries.json"), "utf8")).countries;
  const codes = studyCountries.map((country) => country.code);
  if (JSON.stringify(codes) !== JSON.stringify(STUDY_COUNTRY_CODES)) problems.push("src/lib/study-countries.json: codes differ from CN, MY, AE, TR, IT, CZ");
  const inputs = Object.fromEntries(Object.entries(SEED_FILES).map(([part, name]) => [part, readJsonFile(resolve(seedDir, name), problems, allowMissing)]));

  const manifest = new Map();
  for (const [index, item] of readRoot(inputs.photos, "photos-manifest.json", "photos", ["rules"], problems, today).entries()) {
    const where = `photos-manifest.json photos[${index}]`;
    if (!exactKeys(item, ["key", "place_type", "place_key", "file", "sha256", "bytes", "width", "height", "author", "author_url",
      "source", "source_url", "licence", "licence_url", "attribution_required", "attribution_text", "fetched_on"],
    ["original_download_url", "original_width", "original_height", "subject", "location_evidence", "licence_check",
      "visual_check", "replaced_group_photo", "processing"], where, problems)) continue;
    if (manifest.has(item.key)) problems.push(`${where}.key: duplicate ${item.key}`);
    manifest.set(item.key, { value: item, used: false });
  }

  const countries = [];
  const cities = [];
  const links = [];
  const uploads = [];
  const declared = { countryCities: new Map(), countryInstitutions: new Map(), cityInstitutions: new Map() };

  for (const [index, item] of readRoot(inputs.countries, "countries.json", "countries", [], problems, today).entries()) {
    const where = `countries.json countries[${index}]`;
    if (!exactKeys(item, ["code", "sort_order", "name_ru", "name_ky", "name_en", "ky_review"],
      ["summary_ru", "summary_ky", "photo", "city_count", "institution_count"], where, problems)) continue;
    const product = studyCountries.find((country) => country.code === item.code);
    if (!product) { problems.push(`${where}.code: not a product country`); continue; }
    if (countries.some((country) => country.code === item.code)) problems.push(`${where}.code: duplicate ${item.code}`);
    if (item.sort_order !== codes.indexOf(item.code) + 1) problems.push(`${where}.sort_order: ${codes.indexOf(item.code) + 1} in product order`);
    // Названия стран фиксированы в 283 и src/lib/study-countries.json; сид их не меняет.
    if (item.name_ru !== product.ru || item.name_ky !== product.ky || item.name_en !== product.website) {
      problems.push(`${where}: names differ from src/lib/study-countries.json`);
    }
    if (!pairOk(item.summary_ru, item.summary_ky, 300)) problems.push(`${where}: summary_ru and summary_ky must both be text up to 300 or both absent`);
    studentText(item.summary_ru, 300, `${where}.summary_ru`, problems, { nullable: true });
    studentText(item.summary_ky, 300, `${where}.summary_ky`, problems, { nullable: true });
    if (!["pending", "done"].includes(item.ky_review)) problems.push(`${where}.ky_review: pending or done`);
    for (const field of ["city_count", "institution_count"]) {
      if (item[field] != null && !Number.isSafeInteger(item[field])) problems.push(`${where}.${field}: integer`);
    }
    if (item.city_count != null) declared.countryCities.set(item.code, item.city_count);
    if (item.institution_count != null) declared.countryInstitutions.set(item.code, item.institution_count);
    const photo = readPhoto(item.photo, { placeType: "country", placeKey: item.code, scope: "countries", objectName: item.code.toLowerCase() },
      manifest, seedDir, `${where}.photo`, problems);
    if (photo) uploads.push({ scope: "country", key: item.code, ...photo.upload });
    countries.push({ code: item.code, summaryRu: item.summary_ru ?? null, summaryKy: item.summary_ky ?? null,
      kyReview: item.ky_review, photo: photo?.db ?? null });
  }

  const seenKeys = new Set();
  const seenNames = new Set();
  for (const [index, item] of readRoot(inputs.cities, "cities.json", "cities", [], problems, today).entries()) {
    const where = `cities.json cities[${index}]`;
    if (!exactKeys(item, ["city_key", "country_code", "name_ru", "name_ky", "name_en", "ky_review", "status", "gaps"],
      ["lat", "lng", "coord_source", "coord_source_url", "wikidata_id", "coord_note", "summary_ru", "summary_ky", "fact_ru", "fact_ky",
        "fact_source_url", "fact_source_title", "fact_verified_on", "photo", "institution_count"], where, problems)) continue;
    const before = problems.length;
    if (typeof item.city_key !== "string" || !KEY_PATTERN.test(item.city_key) || item.city_key.length < 2 || item.city_key.length > 64) problems.push(`${where}.city_key: lowercase latin slug, 2 to 64`);
    if (seenKeys.has(item.city_key)) problems.push(`${where}.city_key: duplicate ${item.city_key}`);
    seenKeys.add(item.city_key);
    if (!codes.includes(item.country_code)) problems.push(`${where}.country_code: not a product country`);
    for (const field of ["name_ru", "name_ky", "name_en"]) studentText(item[field], 100, `${where}.${field}`, problems);
    if (seenNames.has(`${item.country_code}:${item.name_ru}`)) problems.push(`${where}.name_ru: duplicate in ${item.country_code}`);
    seenNames.add(`${item.country_code}:${item.name_ru}`);
    const hasLat = item.lat != null, hasLng = item.lng != null;
    if (hasLat !== hasLng || (hasLat && !(Number.isFinite(item.lat) && item.lat >= -90 && item.lat <= 90
      && Number.isFinite(item.lng) && item.lng >= -180 && item.lng <= 180))) problems.push(`${where}: lat and lng must both be valid numbers or both absent`);
    if (!pairOk(item.summary_ru, item.summary_ky, 300)) problems.push(`${where}: summary_ru and summary_ky must both be text up to 300 or both absent`);
    if (!pairOk(item.fact_ru, item.fact_ky, 200)) problems.push(`${where}: fact_ru and fact_ky must both be text up to 200 or both absent`);
    for (const [field, max] of [["summary_ru", 300], ["summary_ky", 300], ["fact_ru", 200], ["fact_ky", 200]]) {
      studentText(item[field], max, `${where}.${field}`, problems, { nullable: true });
    }
    if (item.fact_source_url != null && !publicUrlOk(item.fact_source_url)) problems.push(`${where}.fact_source_url: not a public https URL`);
    if (item.fact_verified_on != null && !dateOk(item.fact_verified_on, today)) problems.push(`${where}.fact_verified_on: YYYY-MM-DD not in the future`);
    if (!["pending", "done"].includes(item.ky_review)) problems.push(`${where}.ky_review: pending or done`);
    if (!["draft", "published"].includes(item.status)) problems.push(`${where}.status: draft or published`);
    if (!Array.isArray(item.gaps) || item.gaps.some((gap) => typeof gap !== "string")) problems.push(`${where}.gaps: array of text`);
    if (item.institution_count != null && !Number.isSafeInteger(item.institution_count)) problems.push(`${where}.institution_count: integer`);
    const photo = readPhoto(item.photo, { placeType: "city", placeKey: item.city_key, scope: "cities",
      objectName: `${String(item.country_code).toLowerCase()}-${item.city_key}` }, manifest, seedDir, `${where}.photo`, problems);
    if (item.status === "published" && (!photo || item.summary_ru == null || item.fact_ru == null
      || item.fact_source_url == null || item.fact_verified_on == null || (Array.isArray(item.gaps) && item.gaps.length > 0))) {
      problems.push(`${where}: a published city needs photo, summary, fact, fact source, verification date and no gaps`);
    }
    if (problems.length > before) continue;
    if (item.institution_count != null) declared.cityInstitutions.set(item.city_key, item.institution_count);
    if (photo) uploads.push({ scope: "city", key: item.city_key, ...photo.upload });
    cities.push({ key: item.city_key, country: item.country_code, nameRu: item.name_ru, nameKy: item.name_ky, nameEn: item.name_en,
      lat: item.lat ?? null, lng: item.lng ?? null, summaryRu: item.summary_ru ?? null, summaryKy: item.summary_ky ?? null,
      factRu: item.fact_ru ?? null, factKy: item.fact_ky ?? null, factSourceUrl: item.fact_source_url ?? null,
      factVerifiedOn: item.fact_verified_on ?? null, kyReview: item.ky_review, status: item.status, photo: photo?.db ?? null });
  }

  const cityCountry = new Map(cities.map((city) => [city.key, city.country]));
  const seen = new Set();
  for (const [index, item] of readRoot(inputs.links, "institution-cities.json", "links", ["match_rule"], problems, today).entries()) {
    const where = `institution-cities.json links[${index}]`;
    if (!exactKeys(item, ["country_code", "institution_name", "city_key"],
      ["production_id", "production_city", "resolution", "owner_question", "note", "source_url"], where, problems)) continue;
    const before = problems.length;
    if (!codes.includes(item.country_code)) problems.push(`${where}.country_code: not a product country`);
    if (typeof item.institution_name !== "string" || item.institution_name === "" || item.institution_name.length > 300) problems.push(`${where}.institution_name: exact catalog name required`);
    if (!cityCountry.has(item.city_key)) problems.push(`${where}.city_key: ${item.city_key} is not in cities.json`);
    else if (cityCountry.get(item.city_key) !== item.country_code) problems.push(`${where}: city ${item.city_key} is in ${cityCountry.get(item.city_key)}, not ${item.country_code}`);
    if (item.production_id != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(item.production_id)) problems.push(`${where}.production_id: uuid`);
    if (item.resolution != null && !LINK_RESOLUTIONS.includes(item.resolution)) problems.push(`${where}.resolution: ${LINK_RESOLUTIONS.join(", ")}`);
    if (item.owner_question != null && typeof item.owner_question !== "boolean") problems.push(`${where}.owner_question: boolean`);
    const identity = `${item.country_code}\u0000${item.institution_name}`;
    if (seen.has(identity)) problems.push(`${where}: duplicate institution ${item.country_code} ${item.institution_name}`);
    seen.add(identity);
    if (problems.length === before) {
      links.push({ country: item.country_code, institutionName: item.institution_name, cityKey: item.city_key,
        productionId: item.production_id ?? null, ownerQuestion: item.owner_question === true });
    }
  }

  // Справочные числа файлов сверяются с самими связями (защита от ручной правки одного файла).
  if (inputs.cities && inputs.links) {
    for (const [code, count] of declared.countryCities) {
      const actual = cities.filter((city) => city.country === code).length;
      if (actual !== count) problems.push(`countries.json ${code}.city_count: ${count}, cities.json has ${actual}`);
    }
    for (const [code, count] of declared.countryInstitutions) {
      const actual = links.filter((link) => link.country === code).length;
      if (actual !== count) problems.push(`countries.json ${code}.institution_count: ${count}, institution-cities.json has ${actual}`);
    }
    for (const [key, count] of declared.cityInstitutions) {
      const actual = links.filter((link) => link.cityKey === key).length;
      if (actual !== count) problems.push(`cities.json ${key}.institution_count: ${count}, institution-cities.json has ${actual}`);
    }
  }
  for (const [key, entry] of manifest) if (!entry.used) problems.push(`photos-manifest.json ${key}: no country or city uses this photo`);

  if (problems.length > 0) throw new SeedError(problems);
  return {
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
    `-- Входы (sha256): countries.json ${seed.inputs.countries ?? "нет"},`,
    `--   cities.json ${seed.inputs.cities ?? "нет"},`,
    `--   institution-cities.json ${seed.inputs.links ?? "нет"},`,
    `--   photos-manifest.json ${seed.inputs.photos ?? "нет"}.`,
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
  // production_id связи только для сверки с выгрузкой production; сид связывает по имени.
  const exportedId = new Map(institutions.map((item) => [`${item.country_code}\u0000${item.institution_name}`, item.id ?? null]));
  const idMismatch = seed.links.filter((link) => link.productionId && exportedId.get(`${link.country}\u0000${link.institutionName}`)
    && exportedId.get(`${link.country}\u0000${link.institutionName}`) !== link.productionId)
    .map((link) => ({ country: link.country, institutionName: link.institutionName }));
  return { institutions: institutions.length, linked: institutions.length - missing.length, linkedToPublishedCity: toPublished,
    missing, unknownLinks: unknown, idMismatch,
    ownerQuestions: seed.links.filter((link) => link.ownerQuestion).map((link) => ({ country: link.country, institutionName: link.institutionName, cityKey: link.cityKey })) };
}
