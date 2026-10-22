#!/usr/bin/env node
/**
 * Генератор текстов агентов «ИИ-агенты» (контракт docs/design/ai-agents/contract.md §E.1).
 *
 * Читает src/content/ai-agents/_preamble.md и <key>.md для каждого ключа каталога
 * (src/lib/ai-agents/contract.ts), проверяет их и пишет
 * src/content/ai-agents/prompts.generated.ts.
 *
 *   node scripts/build-ai-agent-prompts.mjs           — записать сгенерированный файл
 *   node scripts/build-ai-agent-prompts.mjs --check   — упасть, если файл расходится с .md
 *
 * Node без зависимостей. Во время работы приложения ни fs, ни .md не используются:
 * тексты живут в TypeScript-модуле (standalone-сборка Next не копирует .md).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "src", "content", "ai-agents");
const CONTRACT_FILE = path.join(ROOT, "src", "lib", "ai-agents", "contract.ts");
const OUTPUT_FILE = path.join(CONTENT_DIR, "prompts.generated.ts");

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
  const preambleFile = path.join(contentDir, "_preamble.md");
  if (!existsSync(preambleFile)) fail(preambleFile, "файл не найден.");
  const preambleRaw = readFileSync(preambleFile, "utf8");
  assertNoNul(preambleFile, preambleRaw);
  const preamble = normalizeText(stripHtmlComments(preambleRaw));
  if (preamble === "") fail(preambleFile, "преамбула пуста.");
  if (preamble.length > LIMITS.preambleMaxChars) {
    fail(preambleFile, `преамбула ${preamble.length} символов, предел ${LIMITS.preambleMaxChars}.`);
  }

  const agents = {};
  for (const key of keys) {
    const file = path.join(contentDir, `${key}.md`);
    if (!existsSync(file)) fail(file, "файл агента не найден.");
    const source = readFileSync(file, "utf8");
    assertNoNul(file, source);
    const parsed = parseAgentFile(file, source);
    if (parsed.key !== key) fail(file, `key «${parsed.key}» не совпадает с именем файла «${key}».`);
    const instructions = normalizeText(stripHtmlComments(parsed.body));
    if (instructions.length > LIMITS.instructionsMaxChars) {
      fail(file, `инструкция ${instructions.length} символов, предел ${LIMITS.instructionsMaxChars}.`);
    }
    if (parsed.schedulePrompt && parsed.schedulePrompt.length > LIMITS.schedulePromptMaxChars) {
      fail(file, `schedule_prompt ${parsed.schedulePrompt.length} символов, предел ${LIMITS.schedulePromptMaxChars}.`);
    }
    agents[key] = { instructions, schedulePrompt: parsed.schedulePrompt };
  }
  return { preamble, agents, keys };
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
    " * СГЕНЕРИРОВАНО scripts/build-ai-agent-prompts.mjs из src/content/ai-agents/*.md — НЕ РЕДАКТИРОВАТЬ.",
    " * Правьте .md и запускайте: node scripts/build-ai-agent-prompts.mjs (проверка: --check).",
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

export function generate(options) {
  return renderModule(loadSources(options));
}

function main() {
  const check = process.argv.includes("--check");
  const output = generate();
  if (check) {
    const current = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, "utf8") : null;
    if (current !== output) {
      console.error(
        "prompts.generated.ts расходится с src/content/ai-agents/*.md. Запустите: node scripts/build-ai-agent-prompts.mjs",
      );
      process.exit(1);
    }
    console.log("prompts.generated.ts актуален.");
    return;
  }
  writeFileSync(OUTPUT_FILE, output);
  console.log(`Записано ${path.relative(ROOT, OUTPUT_FILE)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
