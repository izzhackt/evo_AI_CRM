#!/usr/bin/env node
/**
 * Генератор текстов агентов «ИИ-агенты» (контракт docs/design/ai-agents/contract.md §E.1).
 *
 * Читает src/content/ai-agents/_shared/preamble.md и папку <key>/ каждого ключа каталога
 * (src/lib/ai-agents/contract.ts): role.md + rules.md (инструкция), tools.json (инструменты).
 * Проверяет их и пишет prompts.generated.ts и tool-grants.generated.ts.
 *
 *   node scripts/maintenance/build-ai-agent-prompts.mjs           — записать сгенерированный файл
 *   node scripts/maintenance/build-ai-agent-prompts.mjs --check   — упасть, если файл расходится с источниками
 *
 * Node без зависимостей. Во время работы приложения ни fs, ни .md не используются:
 * тексты живут в TypeScript-модуле (standalone-сборка Next не копирует .md).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT_DIR = path.join(ROOT, "src", "content", "ai-agents");
const CONTRACT_FILE = path.join(ROOT, "src", "lib", "ai-agents", "contract.ts");
const OUTPUT_FILE = path.join(CONTENT_DIR, "prompts.generated.ts");
const GRANTS_FILE = path.join(CONTENT_DIR, "tool-grants.generated.ts");
const ALWAYS_ALLOWED_TOOL = "get_my_settings";

export const LIMITS = Object.freeze({
  instructionsMaxChars: 40_000,
  preambleMaxChars: 8_000,
  schedulePromptMaxChars: 4_000,
});

const FRONTMATTER_KEYS = new Set(["key", "schedule_prompt"]);

/** Ключи каталога — из замороженного контракта (парсим текст, чтобы не требовать флагов Node). */
export function readCatalogKeys(contractSource = readFileSync(CONTRACT_FILE, "utf8")) {
  const match = /export const AI_AGENT_KEYS = \[([\s\S]*?)\] as const;/.exec(contractSource);
  if (!match) throw new Error("В contract.ts не найден AI_AGENT_KEYS.");
  const keys = [...match[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map((item) => item[1]);
  if (keys.length === 0) throw new Error("AI_AGENT_KEYS пуст.");
  return keys;
}

/** Реестр инструментов — из contract.ts (AI_AGENT_TOOL_NAMES). */
export function readToolNames(contractSource = readFileSync(CONTRACT_FILE, "utf8")) {
  const match = /export const AI_AGENT_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(contractSource);
  if (!match) throw new Error("В contract.ts не найден AI_AGENT_TOOL_NAMES.");
  const names = [...match[1].matchAll(/"([a-z][a-z0-9_]*)"/g)].map((item) => item[1]);
  if (names.length === 0) throw new Error("AI_AGENT_TOOL_NAMES пуст.");
  return names;
}

/** tools.json: { "tools": [...] }; имена из реестра, без повторов. get_my_settings добавляется всегда. Порядок — как в реестре. */
export function parseToolsFile(file, source, registry) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    fail(file, "не JSON.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.tools)) {
    fail(file, 'ожидается объект { "tools": [...] }.');
  }
  const extraKeys = Object.keys(data).filter((name) => name !== "tools");
  if (extraKeys.length > 0) fail(file, `неизвестное поле «${extraKeys[0]}».`);
  const seen = new Set();
  for (const name of data.tools) {
    if (typeof name !== "string") fail(file, "имя инструмента должно быть строкой.");
    if (!registry.includes(name)) fail(file, `инструмента «${name}» нет в AI_AGENT_TOOL_NAMES.`);
    if (seen.has(name)) fail(file, `инструмент «${name}» указан дважды.`);
    seen.add(name);
  }
  seen.add(ALWAYS_ALLOWED_TOOL);
  return registry.filter((name) => seen.has(name));
}

/** HTML-комментарии — заметки авторам, в промпт не попадают. */
export function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** Единый вид текста: \n, без хвостовых пробелов, не более одной пустой строки подряд. */
export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fail(file, message) {
  throw new Error(`${path.relative(ROOT, file)}: ${message}`);
}

function assertNoNul(file, text) {
  if (text.includes("\u0000")) fail(file, "в тексте есть NUL-символ.");
}

/** Самописный разбор frontmatter: только `key: <значение>` и блок `schedule_prompt: |`. */
export function parseAgentFile(file, source) {
  const raw = source.replace(/\r\n?/g, "\n");
  if (!raw.startsWith("---\n")) fail(file, "файл должен начинаться со строки ---.");
  const end = raw.indexOf("\n---\n", 3);
  const endAtEof = raw.endsWith("\n---") ? raw.length - 4 : -1;
  const closing = end >= 0 ? end : endAtEof;
  if (closing < 0) fail(file, "frontmatter не закрыт строкой ---.");
  const frontLines = raw.slice(4, closing).split("\n");
  const body = end >= 0 ? raw.slice(end + 5) : "";

  const fields = {};
  for (let index = 0; index < frontLines.length; index += 1) {
    const line = frontLines[index];
    if (line.trim() === "") continue;
    const match = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (!match) fail(file, `строка frontmatter не разобрана: «${line}».`);
    const [, name, valueRaw] = match;
    if (!FRONTMATTER_KEYS.has(name)) fail(file, `неизвестное поле frontmatter «${name}».`);
    if (name in fields) fail(file, `поле «${name}» задано дважды.`);
    if (name === "schedule_prompt") {
      if (valueRaw.trim() !== "|") fail(file, "schedule_prompt должен быть блоком «|».");
      const block = [];
      while (index + 1 < frontLines.length && (frontLines[index + 1] === "" || /^[ \t]+/.test(frontLines[index + 1]))) {
        index += 1;
        const next = frontLines[index];
        block.push(next.startsWith("  ") ? next.slice(2) : next.replace(/^[ \t]+/, ""));
      }
      fields[name] = normalizeText(stripHtmlComments(block.join("\n")));
    } else {
      fields[name] = valueRaw.trim();
    }
  }
  if (!fields.key) fail(file, "нет поля key.");
  return { key: fields.key, schedulePrompt: fields.schedule_prompt ? fields.schedule_prompt : null, body };
}

/** Читает и проверяет все источники; возвращает данные для генерации. */
export function loadSources({ contentDir = CONTENT_DIR, keys = readCatalogKeys() } = {}) {
  const preambleFile = path.join(contentDir, "_shared", "preamble.md");
  if (!existsSync(preambleFile)) fail(preambleFile, "файл не найден.");
  const preambleRaw = readFileSync(preambleFile, "utf8");
  assertNoNul(preambleFile, preambleRaw);
  const preamble = normalizeText(stripHtmlComments(preambleRaw));
  if (preamble === "") fail(preambleFile, "преамбула пуста.");
  if (preamble.length > LIMITS.preambleMaxChars) {
    fail(preambleFile, `преамбула ${preamble.length} символов, предел ${LIMITS.preambleMaxChars}.`);
  }

  const registry = readToolNames();
  const agents = {};
  const grants = {};
  for (const key of keys) {
    const roleFile = path.join(contentDir, key, "role.md");
    const rulesFile = path.join(contentDir, key, "rules.md");
    const toolsFile = path.join(contentDir, key, "tools.json");
    for (const file of [roleFile, rulesFile, toolsFile]) if (!existsSync(file)) fail(file, "файл агента не найден.");
    const roleSource = readFileSync(roleFile, "utf8");
    const rulesSource = readFileSync(rulesFile, "utf8");
    assertNoNul(roleFile, roleSource);
    assertNoNul(rulesFile, rulesSource);
    const parsed = parseAgentFile(roleFile, roleSource);
    if (parsed.key !== key) fail(roleFile, `key «${parsed.key}» не совпадает с именем папки «${key}».`);
    if (rulesSource.startsWith("---\n")) fail(rulesFile, "frontmatter допустим только в role.md.");
    const instructions = normalizeText(stripHtmlComments(parsed.body + rulesSource));
    if (instructions.length > LIMITS.instructionsMaxChars) {
      fail(roleFile, `инструкция ${instructions.length} символов, предел ${LIMITS.instructionsMaxChars}.`);
    }
    if (parsed.schedulePrompt && parsed.schedulePrompt.length > LIMITS.schedulePromptMaxChars) {
      fail(roleFile, `schedule_prompt ${parsed.schedulePrompt.length} символов, предел ${LIMITS.schedulePromptMaxChars}.`);
    }
    agents[key] = { instructions, schedulePrompt: parsed.schedulePrompt };
    grants[key] = parseToolsFile(toolsFile, readFileSync(toolsFile, "utf8"), registry);
  }
  return { preamble, agents, grants, keys };
}

function tsString(text) {
  // JSON.stringify оставляет U+2028/U+2029 как есть; экранируем их для читаемого diff и старых парсеров.
  return JSON.stringify(text)
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

/** Многострочный текст как `[ "строка", … ].join("\n")`: читаемый diff, без шаблонных литералов. */
function tsLines(text, indent) {
  if (text === "") return '""';
  const pad = " ".repeat(indent);
  const lines = text.split("\n").map((line) => `${pad}  ${tsString(line)},`);
  return `[\n${lines.join("\n")}\n${pad}].join("\\n")`;
}

export function renderModule({ preamble, agents, keys }) {
  const entries = keys.map((key) => {
    const item = agents[key];
    const schedule = item.schedulePrompt === null ? "null" : tsLines(item.schedulePrompt, 4);
    return `  ${tsString(key)}: {\n    instructions: ${tsLines(item.instructions, 4)},\n    schedulePrompt: ${schedule},\n  },`;
  });
  return [
    "/*",
    " * СГЕНЕРИРОВАНО scripts/maintenance/build-ai-agent-prompts.mjs из src/content/ai-agents/<key>/{role,rules}.md и _shared/preamble.md — НЕ РЕДАКТИРОВАТЬ.",
    " * Правьте исходники и запускайте: node scripts/maintenance/build-ai-agent-prompts.mjs (проверка: --check).",
    " */",
    'import type { AiAgentKey } from "../../lib/ai-agents/contract.ts";',
    "",
    `export const AI_AGENT_PREAMBLE_TEXT: string = ${tsLines(preamble, 0)};`,
    "",
    "export const AI_AGENT_PROMPT_SOURCES: Readonly<",
    "  Record<AiAgentKey, { instructions: string; schedulePrompt: string | null }>",
    "> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

export function renderGrantsModule({ grants, keys }) {
  const entries = keys.map((key) => {
    const names = grants[key].map((name) => `    ${tsString(name)},`).join("\n");
    return `  ${tsString(key)}: [\n${names}\n  ],`;
  });
  return [
    "/*",
    " * СГЕНЕРИРОВАНО scripts/maintenance/build-ai-agent-prompts.mjs из src/content/ai-agents/<key>/tools.json — НЕ РЕДАКТИРОВАТЬ.",
    " * Правьте tools.json и запускайте: node scripts/maintenance/build-ai-agent-prompts.mjs (проверка: --check).",
    " */",
    'import type { AiAgentKey, AiAgentToolName } from "../../lib/ai-agents/contract.ts";',
    "",
    "/** Инструменты, которые агент видит и может вызывать. get_my_settings разрешён всегда. */",
    "export const AI_AGENT_TOOL_GRANTS: Readonly<Record<AiAgentKey, readonly AiAgentToolName[]>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

export function generate(options) {
  return renderModule(loadSources(options));
}

export function generateGrants(options) {
  return renderGrantsModule(loadSources(options));
}

function main() {
  const check = process.argv.includes("--check");
  const sources = loadSources();
  const output = renderModule(sources);
  const grantsOutput = renderGrantsModule(sources);
  if (check) {
    const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, "utf8") : null;
    const currentGrants = existsSync(GRANTS_FILE) ? readFileSync(GRANTS_FILE, "utf8") : null;
    if (current !== output || currentGrants !== grantsOutput) {
      console.error(
        "prompts.generated.ts или tool-grants.generated.ts расходятся с src/content/ai-agents/<key>/. Запустите: node scripts/maintenance/build-ai-agent-prompts.mjs",
      );
      process.exit(1);
    }
    console.log("prompts.generated.ts и tool-grants.generated.ts актуальны.");
    return;
  }
  writeFileSync(OUTPUT_FILE, output);
  writeFileSync(GRANTS_FILE, grantsOutput);
  console.log(`Записано ${path.relative(ROOT, OUTPUT_FILE)} и ${path.relative(ROOT, GRANTS_FILE)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
