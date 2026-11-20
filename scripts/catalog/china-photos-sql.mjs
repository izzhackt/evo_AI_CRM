#!/usr/bin/env node
/**
 * Китай 2026-11, срез C8: фото новых карточек вузов (план docs/catalog/china-2026-11-plan.md, запись 2026-11-20
 * «Китай: фото 118 новых вузов» в docs/PLAN_CHANGES.md).
 *
 *   node scripts/catalog/china-photos-sql.mjs [--commit] [--actor-membership UUID] [--only key,key] > china-photos.sql
 *
 * Скрипт ничего не выполняет: он печатает SQL. Без --commit транзакция заканчивается ROLLBACK (сухой прогон, в конце
 * печатается отчёт). С --commit заканчивается COMMIT. Запуск на production тот же, что у china-universities-sql.mjs:
 *
 *   ssh hermes-vps 'docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q -At -F "	" -v ON_ERROR_STOP=1' < china-photos.sql
 *
 * Карточки берутся из явного списка scripts/catalog/data/china-2026-11/photo-keys.json (ключи карточек среза C8; ключ
 * фото равен ключу карточки, кроме явных исключений PHOTO_KEY_FOR_CARD ниже). Для каждой: новая версия карточки из
 * src/lib/server/university-catalog-reviewed-china.json
 * теми же RPC, что Admin-публикация в CRM (stage + review), от действующего системного Admin. Меняется ТОЛЬКО photoKey:
 * в живой опубликованной версии он пуст, во входном файле это ключ из src/lib/university-photo-library.json, а все
 * остальные поля совпадают. Иначе транзакция прерывается: в карточке есть правка, которой нет во входном файле.
 * Ключ обязан быть и в закрытом списке проверки карточки (миграция расширения списка ключей), иначе RPC откажет.
 * Повтор тем же файлом ничего не дублирует: карточки, где фото уже стоит, пропускаются (current).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORGANIZATION_ID } from "./malaysia-universities-sql.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PHOTO_KEYS_FILE = "scripts/catalog/data/china-2026-11/photo-keys.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_PREFIX = "evo-cn-2611-photo";

const dollar = (value, tag) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.includes(`$${tag}$`)) throw new Error(`dollar tag ${tag} occurs in data`);
  return `$${tag}$${text}$${tag}$`;
};

/** JSON с упорядоченными ключами: равенство по смыслу, как у jsonb в базе. */
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/** Чистая проверка «меняется только фото»: тот же смысл, что у PL/pgSQL-проверки в SQL ниже. */
export function isPhotoOnlyUpdate(oldContent, nextContent) {
  if (oldContent === null || typeof oldContent !== "object" || nextContent === null || typeof nextContent !== "object") return false;
  if (!Object.hasOwn(oldContent, "photoKey") || oldContent.photoKey !== null) return false;
  if (typeof nextContent.photoKey !== "string" || nextContent.photoKey.length === 0) return false;
  const withoutPhoto = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "photoKey"));
  return canonical(withoutPhoto(oldContent)) === canonical(withoutPhoto(nextContent));
}

export function loadPhotoInputs() {
  return {
    cards: JSON.parse(readFileSync(resolve(ROOT, "src/lib/server/university-catalog-reviewed-china.json"), "utf8")),
    library: JSON.parse(readFileSync(resolve(ROOT, "src/lib/university-photo-library.json"), "utf8")),
    photoKeys: JSON.parse(readFileSync(resolve(ROOT, PHOTO_KEYS_FILE), "utf8")),
  };
}

/**
 * Карточки, у которых ключ фото не равен ключу карточки. Загрузчик PORT-9d кладёт копию под `<ключ фото>.<расширение>`
 * и никогда не перезаписывает объект (x-upsert: false), поэтому другая версия фото получает свой ключ.
 * - harbin-institute-of-technology-shenzhen: под ключом карточки в бакете лежит снимок Commons 2018 года (960 px), а
 *   владелец одобрил официальный снимок с en.hitsz.edu.cn.
 * - Пять вузов ниже: под ключом карточки в бакете лежит оригинал больше 16,8 Мп (загружен 20.11.2026 до того, как
 *   нашёлся лимит imgproxy), а карточка показывает уменьшенную копию того же кадра (migrate-university-photos.mjs).
 */
export const PHOTO_KEY_FOR_CARD = Object.freeze({
  "anhui-university-of-technology": "anhui-university-of-technology-campus",
  "guangdong-university-of-finance": "guangdong-university-of-finance-campus",
  "hainan-university": "hainan-university-campus",
  "harbin-institute-of-technology-shenzhen": "harbin-institute-of-technology-shenzhen-campus",
  "huangshan-university": "huangshan-university-campus",
  "jilin-university": "jilin-university-campus",
});
export const photoKeyForCard = (cardKey) => (Object.hasOwn(PHOTO_KEY_FOR_CARD, cardKey) ? PHOTO_KEY_FOR_CARD[cardKey] : cardKey);

/** Карточки среза C8: каждая из списка есть во входном файле, её ключ фото (photoKeyForCard) стоит в ней и есть в библиотеке. */
export function photoTargets({ cards, library, photoKeys }, only = null) {
  if (!Array.isArray(photoKeys) || photoKeys.some((key) => typeof key !== "string")) throw new Error("photo-keys.json must be a list of keys");
  if (new Set(photoKeys).size !== photoKeys.length) throw new Error("photo-keys.json has duplicates");
  const byKey = new Map();
  for (const card of cards) {
    if (byKey.has(card.key)) throw new Error(`duplicate card key ${card.key}`);
    byKey.set(card.key, card);
  }
  if (only !== null) for (const key of only) if (!photoKeys.includes(key)) throw new Error(`--only: ${key} is not a C8 photo key`);
  return photoKeys.filter((key) => only === null || only.includes(key)).map((key) => {
    const card = byKey.get(key);
    if (!card) throw new Error(`photo key ${key}: no such card in the China file`);
    if (card.content.country !== "CN") throw new Error(`photo key ${key}: not a China card`);
    const photoKey = photoKeyForCard(key);
    if (card.content.photoKey !== photoKey) throw new Error(`photo key ${key}: the card's photoKey must be ${photoKey}`);
    if (!Object.hasOwn(library, photoKey)) throw new Error(`photo key ${key}: ${photoKey} is missing from the photo library`);
    return card;
  });
}

export function buildSql({ commit = false, actorMembership = null, only = null, inputs = loadPhotoInputs() } = {}) {
  if (actorMembership !== null && !UUID.test(actorMembership)) throw new Error("--actor-membership must be a UUID");
  const cards = photoTargets(inputs, only);
  const lines = [];
  const out = (text) => lines.push(text);
  out("\\set ON_ERROR_STOP on");
  out("-- China 2026-11 (C8): photo keys for new university cards. Generated by scripts/catalog/china-photos-sql.mjs.");
  out("BEGIN;");
  out("SET LOCAL statement_timeout = '600s';");
  out("CREATE TEMP TABLE a_cards (ord INT PRIMARY KEY, key TEXT NOT NULL, content JSONB NOT NULL);");
  cards.forEach((card, index) => {
    out(`INSERT INTO a_cards VALUES (${index + 1}, ${dollar(card.key, "k")}, ${dollar(card.content, "j")}::jsonb);`);
  });
  out("CREATE TEMP TABLE a_report (ord INT, key TEXT, state TEXT, photo_key TEXT, version_before BIGINT, version_after BIGINT);");
  out(`SELECT ${actorMembership ? `'${actorMembership}'::uuid` : "m.id"} AS actor_membership, p.auth_user_id AS actor_sub`);
  out("FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id");
  out(`WHERE m.organization_id = '${ORGANIZATION_ID}' AND m.status = 'active' AND p.status = 'active' AND m.is_system_admin`);
  if (actorMembership) out(`  AND m.id = '${actorMembership}'`);
  out("ORDER BY m.created_at LIMIT 1 \\gset");
  // The session claims the Platform reads (platform.current_actor_authority): the user, the membership and the organization.
  out(`SELECT set_config('request.jwt.claims', json_build_object('sub', :'actor_sub', 'role', 'authenticated',
  'platform_membership_id', :'actor_membership', 'platform_organization_id', '${ORGANIZATION_ID}')::text, TRUE) \\g /dev/null`);
  out("SELECT set_config('request.jwt.claim.sub', :'actor_sub', TRUE) \\g /dev/null");
  out(`DO $run$
DECLARE
  org CONSTANT UUID := '${ORGANIZATION_ID}';
  c RECORD; inst UUID; ver BIGINT; old JSONB; st TEXT; digest TEXT; draft JSONB; pub JSONB;
BEGIN
  FOR c IN SELECT * FROM a_cards ORDER BY ord LOOP
    SELECT i.id INTO inst FROM platform.catalog_institutions i
    WHERE i.organization_id = org AND i.institution_kind = 'university' AND i.country_code = c.content ->> 'country'
      AND platform_private.normalize_catalog_institution_name(i.institution_name) = platform_private.normalize_catalog_institution_name(c.content ->> 'name');
    IF inst IS NULL THEN RAISE EXCEPTION 'card % is not in the catalogue', c.key; END IF;
    old := NULL; ver := 0;
    SELECT p.version, p.content INTO ver, old FROM platform_private.university_catalog_publications p
    WHERE p.organization_id = org AND p.institution_id = inst AND p.status = 'published' ORDER BY p.version DESC LIMIT 1;
    IF old IS NULL THEN RAISE EXCEPTION 'card % has no published version', c.key; END IF;
    IF old = c.content THEN
      st := 'current';
    ELSIF (old - 'photoKey') = (c.content - 'photoKey') AND jsonb_typeof(old -> 'photoKey') = 'null'
      AND jsonb_typeof(c.content -> 'photoKey') = 'string' THEN
      st := 'photo';
    ELSE
      RAISE EXCEPTION 'card % differs from the file in more than its photo: refusing', c.key;
    END IF;
    IF st = 'photo' THEN
      digest := encode(sha256(convert_to(c.content::TEXT, 'UTF8')), 'hex');
      EXECUTE 'SET LOCAL ROLE authenticated';
      draft := platform.stage_university_catalog_publication(org, inst, ver, c.content,
        'Фото вуза, Китай 2026-11 (C8): ' || c.key || '; SHA256 ' || digest,
        md5('${REQUEST_PREFIX}:' || c.key || ':' || ver || ':' || digest || ':stage')::UUID);
      pub := platform.review_university_catalog_publication(org, (draft ->> 'draftId')::UUID, 'publish',
        md5('${REQUEST_PREFIX}:' || c.key || ':' || ver || ':' || digest || ':publish')::UUID);
      EXECUTE 'RESET ROLE';
    END IF;
    INSERT INTO a_report VALUES (c.ord, c.key, st, c.content ->> 'photoKey', ver,
      (SELECT COALESCE(max(p.version), 0) FROM platform_private.university_catalog_publications p
       WHERE p.organization_id = org AND p.institution_id = inst AND p.status = 'published'));
  END LOOP;
END
$run$;`);
  out("-- Report");
  out("SELECT 'CARD', key, state, photo_key, version_before, version_after FROM a_report ORDER BY ord;");
  out("SELECT 'SUMMARY_PHOTOS', count(*) FILTER (WHERE state = 'photo'), count(*) FILTER (WHERE state = 'current') FROM a_report;");
  out(`SELECT 'CN_CARDS_WITH_PHOTO_AFTER', count(*) FILTER (WHERE x.content ->> 'photoKey' IS NOT NULL), count(*) FROM (
  SELECT DISTINCT ON (p.institution_id) p.content FROM platform_private.university_catalog_publications p
  JOIN platform.catalog_institutions i ON i.id = p.institution_id
  WHERE p.organization_id = '${ORGANIZATION_ID}' AND i.country_code = 'CN' AND p.status = 'published'
  ORDER BY p.institution_id, p.version DESC) x;`);
  out(commit ? "COMMIT;" : "ROLLBACK;");
  const digest = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  return { sql: `${lines.join("\n")}\n`, cards: cards.length, digest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let commit = false, actorMembership = null, only = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--commit") commit = true;
    else if (args[index] === "--only") only = (args[++index] ?? "").split(",").filter(Boolean);
    else if (args[index] === "--actor-membership") actorMembership = args[++index] ?? null;
    else { process.stderr.write("Usage: node scripts/catalog/china-photos-sql.mjs [--commit] [--actor-membership UUID] [--only key,key]\n"); process.exit(1); }
  }
  const result = buildSql({ commit, actorMembership, only });
  process.stderr.write(`${JSON.stringify({ mode: commit ? "COMMIT" : "ROLLBACK (dry run)", cards: result.cards, digest: result.digest })}\n`);
  process.stdout.write(result.sql);
}
