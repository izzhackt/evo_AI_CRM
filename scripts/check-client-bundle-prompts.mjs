#!/usr/bin/env node
// После `next build`: ни один файл, который браузер скачивает из `.next/static`, не содержит тексты ИИ-агентов
// (src/content/ai-agents). Они живут на сервере; страница отдаёт клиенту только нужное вкладке (как `AgentBody` прежнего вида).
// Статические файлы отдаются без входа, поэтому текст в них — это публичный файл (27.10.2026: «Новый вид» ИИ-агентов).
//
//   node --experimental-strip-types scripts/check-client-bundle-prompts.mjs [каталог-со-статикой]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AI_AGENT_PREAMBLE_TEXT, AI_AGENT_PROMPT_SOURCES } from "../src/content/ai-agents/prompts.generated.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SAFE_LINE = /^[\p{L}\p{N} .,:;()—–-]{24,}$/u;

/** По 4 самые длинные «простые» строки каждого текста (без кавычек и косых черт, которые сборка может записать иначе). */
function markersOf(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => SAFE_LINE.test(line))
    .sort((a, b) => b.length - a.length).slice(0, 4).map((line) => line.slice(0, 64));
}

export function promptMarkers() {
  const markers = new Map();
  const add = (owner, text) => { for (const marker of markersOf(text ?? "")) markers.set(marker, owner); };
  add("общая преамбула", AI_AGENT_PREAMBLE_TEXT);
  markers.set("# Общие правила агентов", "общая преамбула");
  for (const [key, source] of Object.entries(AI_AGENT_PROMPT_SOURCES)) {
    add(`инструкция ${key}`, source.instructions);
    add(`поручение по расписанию ${key}`, source.schedulePrompt);
  }
  return markers;
}

function* jsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (entry.name.endsWith(".js")) yield path;
  }
}

export function findPromptLeaks(staticDir) {
  const markers = promptMarkers();
  const leaks = [];
  for (const file of jsFiles(staticDir)) {
    const source = readFileSync(file, "utf8");
    const owners = new Set();
    for (const [marker, owner] of markers) if (source.includes(marker)) owners.add(owner);
    if (owners.size > 0) leaks.push({ file: relative(ROOT, file), bytes: Buffer.byteLength(source), owners: [...owners] });
  }
  return leaks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staticDir = resolve(process.argv[2] ?? join(ROOT, ".next/static"));
  if (!existsSync(staticDir)) {
    console.error(`check-client-bundle-prompts: нет каталога ${staticDir} — сначала \`next build\`.`);
    process.exit(2);
  }
  const leaks = findPromptLeaks(staticDir);
  if (leaks.length > 0) {
    console.error("check-client-bundle-prompts: тексты ИИ-агентов попали в файлы для браузера:");
    for (const leak of leaks) console.error(`  ${leak.file} (${leak.bytes} Б): ${leak.owners.join("; ")}`);
    console.error("Держите `@/content/ai-agents` на сервере: страница передаёт клиенту только то, что нужно вкладке.");
    process.exit(1);
  }
  console.log(`check-client-bundle-prompts: в ${staticDir} текстов ИИ-агентов нет.`);
}
