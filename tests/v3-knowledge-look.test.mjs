import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { knowledgeDay, knowledgeMoment } from "../src/components/v3/knowledge/knowledge-look.ts";

/*
 * Э8.10 (28.09.2026): облик «Базы знаний» — только интерфейс. Сервер, API,
 * SQL, проверки доступа, адреса и команды не меняются; здесь закреплены
 * правила облика и то, что облик не должен был задеть.
 */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const DIR = "src/components/v3/knowledge";
const files = readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((name) => /\.(tsx|ts|css)$/u.test(name));
const source = Object.fromEntries(files.map((name) => [name, read(`${DIR}/${name}`)]));
const library = source["KnowledgeLibrary.tsx"];
const tree = source["KnowledgeTree.tsx"];

test("dates are «ДД.ММ» and «ДД.ММ ЧЧ:ММ» in Bishkek time, the year only when it is not the current one", () => {
  const now = new Date("2026-09-28T04:00:00Z");
  // 19.09 20:30 UTC — уже 20.09 02:30 по Бишкеку (UTC+6).
  assert.equal(knowledgeDay("2026-09-19T20:30:00Z", now), "20.09");
  assert.equal(knowledgeMoment("2026-09-19T20:30:00Z", now), "20.09 02:30");
  assert.equal(knowledgeDay("2025-12-03T04:00:00Z", now), "03.12.25");
  assert.equal(knowledgeMoment("2025-12-31T19:00:00Z", now), "01.01 01:00");
  assert.equal(knowledgeDay("not a date", now), null);
  for (const [name, text] of Object.entries(source)) {
    assert.doesNotMatch(text, /toLocaleDateString|new Date\([^)]*\)\.toLocaleString/u, `${name} formats dates by the browser locale and zone`);
  }
});

test("the staff look: tokens, neutral selection, no pink, no red checkboxes, no loading text", () => {
  for (const [name, text] of Object.entries(source)) {
    assert.doesNotMatch(text, /#fff0f1|#fff4f5|#[0-9a-f]{6}\b/iu, `${name} hard-codes a colour`);
    assert.doesNotMatch(text, /accent-color:\s*var\(--accent/u, `${name} paints checkboxes red`);
    assert.doesNotMatch(text, /Загрузка…|Загрузка базы знаний|>Поиск…</u, `${name} shows a loading text instead of skeleton rows`);
  }
  assert.doesNotMatch(read("src/app/(v3)/v3/knowledge/page.tsx"), /Загрузка/u);
  assert.match(read("src/app/(v3)/v3/knowledge/page.tsx"), /<Suspense fallback=\{<KnowledgeLibrarySkeleton \/>\}>/u);
  // Выбор — общий нейтральный `.v3-choice` по aria-current / aria-pressed.
  assert.match(tree, /v3-choice/u);
  assert.match(tree, /aria-current=\{current \? "page" : undefined\}/u);
  assert.match(tree, /aria-current=\{!section && view === key \? "page" : undefined\}/u);
  assert.match(library, /v3-choice/u);
  // Отметки — нейтральные (RowSelect очереди и accent-fg).
  assert.match(library, /<RowSelect /u);
  assert.match(source["knowledge-look.ts"], /accent-fg/u);
});

test("every CSS-module class the components use is defined", () => {
  const css = source["KnowledgeLibrary.module.css"];
  const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/gu)].map((match) => match[1]));
  for (const [name, text] of Object.entries(source)) {
    for (const [, key] of text.matchAll(/styles\.([A-Za-z]\w*)/gu)) assert.ok(defined.has(key), `${name}: .${key} is not defined`);
  }
});

test("one toolbar: search first, then «Создать ▾», then «⋯»; the only solid red is «Создать»", () => {
  const toolbar = library.slice(library.indexOf('data-testid="knowledge-toolbar"'), library.indexOf("</TopLayerMenu>", library.indexOf('label="Ещё действия с базой знаний"')));
  const order = ["Поиск по базе знаний", 'label="Создать"', 'label="Ещё действия с базой знаний"'].map((marker) => toolbar.indexOf(marker));
  assert.ok(order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2], `toolbar order ${order}`);
  for (const item of ["Загрузить файлы", "Загрузить папку", '"Выгрузить папку" : "Выгрузить раздел"', "Выгрузить всю базу", "Перенос локальной базы"]) {
    assert.ok(toolbar.includes(item), `«⋯» has ${item}`);
  }
  assert.match(toolbar, /area === "secrets"\s*\? <button[^>]*>.*Доступ<\/button>/u, "«Создать» in the secrets area offers «Доступ»");
  assert.equal([...library.matchAll(/\bbtnCls\b/gu)].length, 2, "btnCls is imported once and used once (the «Создать» trigger)");
  for (const name of ["KnowledgeLibrary.tsx", "KnowledgeImport.tsx", "KnowledgeProtectedImport.tsx", "KnowledgeExport.tsx"]) {
    assert.doesNotMatch(source[name], /<details|<summary/u, `${name} keeps a ▶ disclosure`);
  }
  // Где искать — две кнопки выбора и только внутри папки.
  assert.match(library, /\{parentId \? <div role="group" aria-label="Где искать"/u);
  assert.doesNotMatch(library, /<select aria-label="Область поиска"/u);
});

test("local import and «⋯» dialogs stay mounted in every view; export keeps its FileManager trigger", () => {
  const root = library.slice(library.indexOf('return <div className="@container/kb'));
  assert.match(root, /<KnowledgeImport open=\{importOpen\}/u);
  assert.match(root, /<KnowledgeExport open=\{exportOpen === "scope"\}/u);
  assert.match(root, /<KnowledgeExport open=\{exportOpen === "all"\}/u);
  assert.match(source["KnowledgeImport.tsx"], /<dialog ref=\{modal\}/u);
  const exporter = source["KnowledgeExport.tsx"];
  assert.match(exporter, /export function KnowledgeExport\(\{ ids, area, caseIds, canonical, buttonClassName, label = "Выгрузить", open: openProp, onOpenChange \}/u);
  assert.match(exporter, /\{controlled \? null : <button type="button" aria-haspopup="dialog" className=\{buttonClassName \?\? QUEUE_SECONDARY\} onClick=\{\(\) => setOpen\(true\)\}>\{label\}<\/button>\}/u);
  assert.match(read("src/components/v3/FileManager.tsx"), /<KnowledgeExport canonical=\{folderExport\} label=\{current \? "Выгрузить папку" : "Выгрузить все документы"\} buttonClassName=\{btnGhostCls\} \/>/u);
});

test("the tree draws only open branches, rows are a 44 px button and a 44 px link, secrets never open by themselves", () => {
  assert.equal([...tree.matchAll(/\{open \? <ul className="ps-3">/gu)].length, 2, "areas and folders render children only when open");
  assert.doesNotMatch(tree, /<details|<summary/u);
  assert.match(tree, /const TOGGLE = "grid size-11 /u);
  assert.match(tree, /min-h-11/u);
  assert.match(tree, /isOpen\(`area:\$\{nodeArea\}`, !secrets && !section && nodeArea === area\)/u);
  assert.match(tree, /if \(!parentId \|\| area === "secrets" \|\| section\) return ids;/u);
  assert.match(tree, /secrets \? "mt-3 border-t border-border pt-3"/u);
  // «Секреты и доступы» — последний раздел.
  assert.deepEqual([...read("src/lib/knowledge-library-contract.ts").match(/KNOWLEDGE_AREAS = \[([^\]]+)\]/u)[1].matchAll(/"(\w+)"/gu)].map((match) => match[1]), ["internal", "clients", "raw", "secrets"]);
});

test("the redesign keeps URLs, commands and access unchanged", () => {
  for (const key of ["area", "folder", "item", "view", "case"]) assert.match(library, new RegExp(`params\\.get\\("${key}"\\)`, "u"), `reads ?${key}=`);
  const page = read("src/app/(v3)/v3/knowledge/page.tsx");
  assert.match(page, /requireV3PageActor\("\/v3\/knowledge"\); requireKnowledgeAdmin\(actor\);/u);
  assert.match(page, /if \(query\.tab === "snippets"\) redirect\("\/v3\/knowledge\?section=snippets"\);/u);
  assert.match(read("src/app/(v3)/v3/documents/page.tsx"), /section=documents/u);
  assert.match(read("src/app/(v3)/v3/reply-snippets/page.tsx"), /section=snippets/u);
  const ops = new Set([...Object.values(source).join("\n").matchAll(/\{ op: "([a-z_]+)"/gu)].map((match) => match[1]));
  assert.deepEqual([...ops].sort(), ["assign_case", "create", "edit", "move", "reserve_blob", "restore_version"]);
  assert.match(library, /command\(\{ op, id: item\.id, expectedVersion: item\.version \}\)/u);
  assert.match(source["KnowledgeEditor.tsx"], /command\(\{ op: "edit", id: item\.id, expectedVersion: versionRef\.current,/u);
  assert.match(source["KnowledgeEditor.tsx"], /installKnowledgeEditorExitGuard\(/u);
  assert.match(source["KnowledgeSecret.tsx"], /setTimeout\(\(\) => setValue\(null\), 30_000\)/u);
  // «Документы» не переименованы.
  assert.match(tree, />Документы<\/Link>/u);
});
