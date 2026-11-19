#!/usr/bin/env node
/**
 * Китай 2026-11: карточки вузов из рабочей таблицы EVO, привязка к существующим городам и строки стоимости
 * одной транзакцией SQL (план docs/catalog/china-2026-11-plan.md).
 *
 *   node scripts/catalog/china-universities-sql.mjs [--commit] [--actor-membership UUID] [--skip-costs] [--only key,key] > china.sql
 *
 * Скрипт ничего не выполняет: он печатает SQL. Без --commit транзакция заканчивается ROLLBACK (сухой прогон,
 * в конце печатается отчёт). С --commit заканчивается COMMIT. Запуск на production (self-hosted Supabase):
 *
 *   ssh hermes-vps 'docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q -At -F "	" -v ON_ERROR_STOP=1' < china.sql
 *
 * Все записи идут теми же RPC, что и Admin-публикация в CRM, от имени действующего системного Admin:
 *   1. src/lib/server/university-catalog-reviewed-china.json: для каждой карточки находится вуз по названию и
 *      стране; нет: публикуется новой карточкой (stage + review); есть и равна: пропуск; есть и отличается:
 *      новая версия, но только если она ДОБАВЛЯЕТ (все прежние программы остаются без изменений; имя, страна,
 *      город, обзор, сайты, дата проверки и фото не меняются; заметка либо прежняя, либо прежняя плюс ровно
 *      MERGE_NOTE). Иначе транзакция прерывается: в карточке есть правка, которой нет во входном файле;
 *   2. scripts/catalog/data/china-2026-11/city-links.json: связь НОВЫХ карточек с уже существующими городами
 *      (staff_catalog_institution_city_set_v1); связь карточек, уже имевшихся в каталоге, не трогается;
 *   3. scripts/catalog/data/china-2026-11/programme-costs.json: строки стоимости через staff_catalog_cost_import_v1
 *      (формат и проверки import-catalog-costs.mjs; importKey, уже импортированный, не создаётся второй раз).
 * Повтор тем же файлом ничего не дублирует: неизменные карточки пропускаются, request_id выводятся из содержимого
 * (у стоимости из хэша самих строк, поэтому правка файла не даёт повторное использование идентификатора).
 * Режим --only key,key: те же шаги только для перечисленных карточек (пробный пуск перед полным).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planImport } from "./import-catalog-costs.mjs";
import { MERGE_NOTE } from "./china-2026-11-lib.mjs";
import { ORGANIZATION_ID } from "./malaysia-universities-sql.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = resolve(ROOT, "scripts/catalog/data/china-2026-11");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REQUEST_PREFIX = "evo-cn-2611";

const dollar = (value, tag) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.includes(`$${tag}$`)) throw new Error(`dollar tag ${tag} occurs in data`);
  return `$${tag}$${text}$${tag}$`;
};

/** Поля карточки, которые обновление не вправе менять; растут только programs и (ровно на MERGE_NOTE) notes. */
export const IMMUTABLE_CARD_FIELDS = Object.freeze(["name", "country", "city", "overview", "websiteUrl", "sourceUrl", "verifiedOn", "photoKey"]);

export function loadChinaInputs() {
  const cards = JSON.parse(readFileSync(resolve(ROOT, "src/lib/server/university-catalog-reviewed-china.json"), "utf8"));
  const links = JSON.parse(readFileSync(resolve(DATA, "city-links.json"), "utf8"));
  const costFile = readFileSync(resolve(DATA, "programme-costs.json"));
  return { cards, links, costFile };
}

/** Чистая проверка «обновление только добавляет»: тот же смысл, что у PL/pgSQL-проверки в SQL ниже. */
export function isAdditiveUpdate(oldContent, nextContent) {
  for (const field of IMMUTABLE_CARD_FIELDS) {
    if (JSON.stringify(oldContent[field]) !== JSON.stringify(nextContent[field])) return false;
  }
  if (nextContent.notes !== oldContent.notes && nextContent.notes !== `${oldContent.notes} ${MERGE_NOTE}`) return false;
  const byId = new Map(nextContent.programs.map((program) => [program.id, program]));
  return oldContent.programs.every((program) => {
    const next = byId.get(program.id);
    return next !== undefined && JSON.stringify(next) === JSON.stringify(program);
  });
}

export function buildSql({ commit = false, actorMembership = null, skipCosts = false, only = null } = {}) {
  const { cards: allCards, links, costFile } = loadChinaInputs();
  if (actorMembership !== null && !UUID.test(actorMembership)) throw new Error("--actor-membership must be a UUID");
  const keys = new Set();
  for (const card of allCards) {
    if (keys.has(card.key)) throw new Error(`duplicate card key ${card.key}`);
    keys.add(card.key);
  }
  for (const key of Object.keys(links)) if (!keys.has(key)) throw new Error(`city link for unknown card ${key}`);
  let cards = allCards;
  if (only !== null) {
    for (const key of only) if (!keys.has(key)) throw new Error(`--only: unknown card ${key}`);
    cards = allCards.filter((card) => only.includes(card.key));
  }
  const names = new Set(cards.map((card) => card.content.name));
  const plan = planImport(JSON.parse(costFile.toString("utf8")), {
    fileSha256: createHash("sha256").update(costFile).update(only === null ? "" : `|only:${[...only].sort().join(",")}`).digest("hex"),
    organizationId: ORGANIZATION_ID,
  });
  if (plan.problems.length > 0) throw new Error(`programme-costs.json invalid: ${plan.problems.slice(0, 5).join("; ")}`);
  // Только строки выбранных карточек (при полном прогоне это все строки файла).
  const costRows = plan.batches.flatMap((batch) => batch.p_rows).filter((row) => names.has(row.institutionName));
  const costBatches = [];
  for (let start = 0; start < costRows.length; start += 2000) {
    const rows = costRows.slice(start, start + 2000);
    costBatches.push({ rows, requestId: createHash("sha256").update(`${REQUEST_PREFIX}:costs:`).update(JSON.stringify(rows)).digest("hex") });
  }
  const lines = [];
  const out = (text) => lines.push(text);
  out("\\set ON_ERROR_STOP on");
  out("-- China 2026-11: universities from the EVO worksheet, city links, costs. Generated by scripts/catalog/china-universities-sql.mjs.");
  out("BEGIN;");
  out("SET LOCAL statement_timeout = '900s';");
  out("CREATE TEMP TABLE a_cards (ord INT PRIMARY KEY, key TEXT NOT NULL, city_key TEXT, content JSONB NOT NULL);");
  cards.forEach((card, index) => {
    out(`INSERT INTO a_cards VALUES (${index + 1}, ${dollar(card.key, "k")}, ${links[card.key] ? dollar(links[card.key], "c") : "NULL"}, ${dollar(card.content, "j")}::jsonb);`);
  });
  out("CREATE TEMP TABLE a_report (ord INT, key TEXT, name TEXT, state TEXT, institution_id UUID, version_before BIGINT, version_after BIGINT,");
  out("  programmes INT, programmes_new INT, city_link TEXT);");
  out("CREATE TEMP TABLE a_costs_result (receipt JSONB);");
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
  c RECORD; inst UUID; ver BIGINT; old JSONB; st TEXT; digest TEXT; draft JSONB; pub JSONB; link TEXT; n_new INT; ok BOOLEAN;
  immutable_fields CONSTANT TEXT[] := ARRAY['name','country','city','overview','websiteUrl','sourceUrl','verifiedOn','photoKey'];
  merge_note CONSTANT TEXT := ${dollar(MERGE_NOTE, "m")};
  f TEXT;
BEGIN
  FOR c IN SELECT * FROM a_cards ORDER BY ord LOOP
    SELECT i.id INTO inst FROM platform.catalog_institutions i
    WHERE i.organization_id = org AND i.institution_kind = 'university' AND i.country_code = c.content ->> 'country'
      AND platform_private.normalize_catalog_institution_name(i.institution_name) = platform_private.normalize_catalog_institution_name(c.content ->> 'name');
    old := NULL; ver := 0;
    IF inst IS NOT NULL THEN
      SELECT p.version, p.content INTO ver, old FROM platform_private.university_catalog_publications p
      WHERE p.organization_id = org AND p.institution_id = inst AND p.status = 'published' ORDER BY p.version DESC LIMIT 1;
      ver := COALESCE(ver, 0);
    END IF;
    st := CASE WHEN inst IS NULL OR old IS NULL THEN 'new' WHEN old = c.content THEN 'current' ELSE 'update' END;
    IF st = 'update' THEN
      -- Additive-only: every earlier programme is still present and unchanged; the identity fields are untouched.
      ok := TRUE;
      FOREACH f IN ARRAY immutable_fields LOOP
        IF old -> f IS DISTINCT FROM c.content -> f THEN ok := FALSE; END IF;
      END LOOP;
      IF ok AND NOT (c.content ->> 'notes' = old ->> 'notes' OR c.content ->> 'notes' = (old ->> 'notes') || ' ' || merge_note) THEN ok := FALSE; END IF;
      IF ok THEN
        ok := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old -> 'programs') o
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.content -> 'programs') n WHERE n = o));
      END IF;
      IF NOT ok THEN RAISE EXCEPTION 'card % changed in the catalogue since the import file was built: refusing a non-additive update', c.key; END IF;
    END IF;
    SELECT count(*) FILTER (WHERE old IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old -> 'programs') o WHERE o ->> 'id' = n ->> 'id'))
      INTO n_new FROM jsonb_array_elements(c.content -> 'programs') n;
    digest := encode(sha256(convert_to(c.content::TEXT, 'UTF8')), 'hex');
    IF st <> 'current' THEN
      EXECUTE 'SET LOCAL ROLE authenticated';
      draft := platform.stage_university_catalog_publication(org, inst, ver, c.content,
        'Каталог Китая 2026-11: ' || c.key || '; SHA256 ' || digest,
        md5('${REQUEST_PREFIX}:' || c.key || ':' || ver || ':' || digest || ':stage')::UUID);
      pub := platform.review_university_catalog_publication(org, (draft ->> 'draftId')::UUID, 'publish',
        md5('${REQUEST_PREFIX}:' || c.key || ':' || ver || ':' || digest || ':publish')::UUID);
      EXECUTE 'RESET ROLE';
      inst := (pub ->> 'institutionId')::UUID;
    END IF;
    link := NULL;
    SELECT l.city_key INTO link FROM platform.catalog_institution_cities l WHERE l.institution_id = inst;
    IF c.city_key IS NOT NULL AND link IS NULL THEN
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM platform.staff_catalog_institution_city_set_v1(org, inst, c.city_key,
        md5('${REQUEST_PREFIX}:' || c.key || ':city:' || c.city_key)::UUID);
      EXECUTE 'RESET ROLE';
      link := c.city_key || ' (set)';
    END IF;
    INSERT INTO a_report VALUES (c.ord, c.key, c.content ->> 'name', st, inst, ver,
      (SELECT COALESCE(max(p.version), 0) FROM platform_private.university_catalog_publications p WHERE p.organization_id = org AND p.institution_id = inst AND p.status = 'published'),
      jsonb_array_length(c.content -> 'programs'), n_new, link);
  END LOOP;
END
$run$;`);
  if (!skipCosts && costBatches.length > 0) {
    out("CREATE TEMP TABLE a_cost_rows (batch INT PRIMARY KEY, request_id UUID NOT NULL, rows JSONB NOT NULL);");
    costBatches.forEach((batch, index) => {
      out(`INSERT INTO a_cost_rows VALUES (${index}, md5('${batch.requestId}')::uuid, ${dollar(batch.rows, "r")}::jsonb);`);
    });
    out(`DO $costs$
DECLARE b RECORD; receipt JSONB;
BEGIN
  FOR b IN SELECT * FROM a_cost_rows ORDER BY batch LOOP
    EXECUTE 'SET LOCAL ROLE authenticated';
    receipt := platform.staff_catalog_cost_import_v1('${ORGANIZATION_ID}'::UUID, b.rows, b.request_id);
    EXECUTE 'RESET ROLE';
    INSERT INTO a_costs_result VALUES (jsonb_build_object('created', receipt -> 'created', 'existing', receipt -> 'existing', 'institutionMissing', receipt -> 'institutionMissing'));
  END LOOP;
END
$costs$;`);
  }
  out("-- Report: cards");
  out("SELECT 'CARD', key, state, programmes, programmes_new, version_before, version_after, COALESCE(city_link, '-') FROM a_report ORDER BY ord;");
  out("SELECT 'SUMMARY_CARDS', count(*) FILTER (WHERE state = 'new'), count(*) FILTER (WHERE state = 'update'), count(*) FILTER (WHERE state = 'current'), sum(programmes), sum(programmes_new) FROM a_report;");
  out("SELECT 'UNLINKED_AFTER', count(*) FROM a_report r WHERE NOT EXISTS (SELECT 1 FROM platform.catalog_institution_cities l WHERE l.institution_id = r.institution_id);");
  if (!skipCosts && costBatches.length > 0) {
    out("SELECT 'COSTS_RPC', sum((receipt ->> 'created')::INT), sum((receipt ->> 'existing')::INT), sum((receipt ->> 'institutionMissing')::INT) FROM a_costs_result;");
  }
  out(`SELECT 'COSTS_PUBLISHED_CN_AFTER', count(*) FROM platform.catalog_costs k JOIN platform.catalog_institutions i ON i.id = k.institution_id
  WHERE k.organization_id = '${ORGANIZATION_ID}' AND i.country_code = 'CN' AND k.status = 'published';
SELECT 'CN_INSTITUTIONS_AFTER', count(*) FROM platform.catalog_institutions WHERE organization_id = '${ORGANIZATION_ID}' AND country_code = 'CN';`);
  out(commit ? "COMMIT;" : "ROLLBACK;");
  return { sql: `${lines.join("\n")}\n`, cards: cards.length, costRows: costRows.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let commit = false, actorMembership = null, skipCosts = false, only = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--commit") commit = true;
    else if (args[index] === "--skip-costs") skipCosts = true;
    else if (args[index] === "--only") only = (args[++index] ?? "").split(",").filter(Boolean);
    else if (args[index] === "--actor-membership") actorMembership = args[++index] ?? null;
    else { process.stderr.write("Usage: node scripts/catalog/china-universities-sql.mjs [--commit] [--actor-membership UUID] [--skip-costs] [--only key,key]\n"); process.exit(1); }
  }
  const result = buildSql({ commit, actorMembership, skipCosts, only });
  process.stderr.write(`${JSON.stringify({ mode: commit ? "COMMIT" : "ROLLBACK (dry run)", cards: result.cards, costRows: result.costRows })}\n`);
  process.stdout.write(result.sql);
}
