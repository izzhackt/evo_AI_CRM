"use strict";

// CJS-модуль: его синхронно подключает today-static-render.cjs (require-hook,
// ESM там неприменим), а unit-тест импортирует его как CJS по умолчанию.
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Наборы прав шаблонов ролей из миграции 173 (`staff_role_definitions`):
 * читаются из самого файла миграции, чтобы проверки «Сегодня» шли на тех же
 * правах, что у настоящих ролей, а не на придуманном подмножестве. Шаблон
 * роли и её общий шаблон («… — общие разделы») назначаются вместе, поэтому
 * права роли — их объединение.
 *
 * Только чтение файла; ни базы, ни сети.
 */

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const MIGRATION = join(__dirname, "../../supabase/migrations/173_platform_staff_business_roles.sql");

let sql = null;
function source() {
  sql ??= readFileSync(MIGRATION, "utf8");
  return sql;
}

const quoted = (text) => [...text.matchAll(/'([^']+)'/gu)].map((match) => match[1]);

/** `name_keys CONSTANT TEXT[]:=ARRAY[...]` из блока шаблонов. */
function namedKeys(name) {
  const match = source().match(new RegExp(`\\b${name} CONSTANT TEXT\\[\\]:=ARRAY\\[([^\\]]+)\\]`, "u"));
  if (!match) throw new Error(`migration 173: ${name} is not defined`);
  return quoted(match[1]);
}

/** Права одного шаблона: строка `('slug','Label','Описание',выражение)` из VALUES. */
function templateKeys(slug) {
  const row = source().match(new RegExp(`\\('${slug}','[^']*','[^']*',\\s*([^)]*?)\\)(?:,|\\s*\\))`, "u"));
  if (!row) throw new Error(`migration 173: template ${slug} is not defined`);
  const keys = row[1].split("||").flatMap((part) => {
    const text = part.trim();
    if (/^[a-z_]+_keys$/u.test(text)) return namedKeys(text);
    if (text.startsWith("ARRAY[")) return quoted(text);
    if (text === "'{}'::TEXT[]") return [];
    throw new Error(`migration 173: unexpected expression for ${slug}: ${text}`);
  });
  return [...new Set(keys)].sort();
}

/** Права роли вместе с её общим шаблоном, как их назначают сотруднику. */
function staffRoleKeys(role) {
  const common = role.startsWith("sales") ? "sales-common" : "admissions-common";
  return [...new Set([...templateKeys(role), ...templateKeys(common)])].sort();
}

module.exports = { staffRoleKeys, templateKeys };
