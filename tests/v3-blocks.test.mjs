import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { dueWordOf } from "../src/components/v3/queue/due-bucket.ts";
import { personInitials } from "../src/components/v3/queue/person-name.ts";
import { progressOf } from "../src/components/v3/blocks/progress.ts";
import { QUEUE_PASSIVE_POPOVER, popoverBlocksQueueKeys } from "../src/components/v3/queue/queue-navigation.ts";
import { resumedUndoDeadline } from "../src/components/v3/tasks/undo-deadline.ts";
import { ADMISSIONS_PIPELINE_STAGES } from "../src/lib/platform-admissions-pipeline-contract.ts";
import {
  ADMISSIONS_TRACK_STAGES,
  SALES_TRACK_STAGES,
  STAGE_PHASE_TITLE,
  admissionsStageTitle,
  salesStageTitle,
  stagePhase,
  stageTrack,
} from "../src/lib/v3/stages.ts";
import { admissionsPipelineStage, admissionsPipelineTab } from "../src/lib/v3/wording.ts";

/**
 * Э1.3–Э1.4 плана редизайна (26.09.2026): общие блоки нового облика — чип,
 * срок словом, инициалы, полоса прогресса, дорожка этапа, «Отменить» — и один
 * набор этапов. Чистая логика проверяется напрямую; разметка блоков —
 * рендером `tests/e2e/blocks-static-render.cjs --json`, экраны — теми же
 * статическими рендерами «Задач», «Студентов», досок и дела в прежнем и новом
 * облике (`--look=next`). Это не живая проверка данных и прав.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const render = (script, ...flags) => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL(`./e2e/${script}`, import.meta.url)), "--json", ...flags],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const blocks = render("blocks-static-render.cjs");
const css = read("src/app/(v3)/v3.css");
const NOW = new Date("2026-09-26T06:00:00.000Z");
const BLOCK_CLASSES = /\bv3-(?:chip|stage|phase-dot|due|initials|progress|track|toasts?)\b/u;
const textOf = (html) => html.replace(/<[^>]+>/gu, "").trim();

// --- слова этапов (Э1.4, умолчания владельца 26.09) -------------------------

test("one stage set: the owner's sales and admissions words, three phases", () => {
  assert.deepEqual(SALES_TRACK_STAGES.map(salesStageTitle), [
    "Новый", "Связались", "Квалифицирован", "Встреча назначена", "Встреча проведена", "Потенциальный клиент", "Переданы",
  ]);
  assert.deepEqual(ADMISSIONS_TRACK_STAGES, ADMISSIONS_PIPELINE_STAGES, "the board's nine columns, in board order");
  assert.deepEqual(ADMISSIONS_TRACK_STAGES.map(admissionsStageTitle), [
    "Новые", "Подбор вузов", "Документы", "Готовы к подаче", "Ожидаем решения",
    "Поступление подтверждено", "Оформление визы", "Подготовка к выезду", "Прибыл",
  ]);
  // Слово этапа — то же, что у доски и «Студентов»: один словарь.
  for (const stage of ADMISSIONS_TRACK_STAGES) assert.equal(admissionsStageTitle(stage), admissionsPipelineStage(stage));
  assert.deepEqual(STAGE_PHASE_TITLE, { sales: "Продажи", admission: "Поступление", visa: "Виза и выезд" });
  assert.equal(STAGE_PHASE_TITLE.admission, admissionsPipelineTab("admission"), "phases are the board's tabs");
  assert.deepEqual(ADMISSIONS_TRACK_STAGES.map((stage) => stagePhase("admissions", stage)),
    ["admission", "admission", "admission", "admission", "admission", "visa", "visa", "visa", "visa"]);
  assert.ok(SALES_TRACK_STAGES.every((stage) => stagePhase("sales", stage) === "sales"));
  // Сырой ключ не становится словом или фазой.
  assert.equal(salesStageTitle("admissions_validation"), null);
  assert.equal(admissionsStageTitle("admissions_validation"), null);
  assert.equal(stagePhase("admissions", "intake"), null);
  assert.equal(stagePhase("sales", null), null);
});

test("the stage track marks one current stage and knows nothing it cannot name", () => {
  const track = stageTrack("admissions", "documents");
  assert.equal(track.steps.length, 9);
  assert.equal(track.position, 3);
  assert.deepEqual(track.steps.map((step) => step.state), ["done", "done", "current", "next", "next", "next", "next", "next", "next"]);
  assert.equal(track.current.title, "Документы");
  assert.equal(stageTrack("sales", "handed_off").current.title, "Переданы");
  assert.equal(stageTrack("sales", "handed_off").steps.length, 7);
  assert.equal(stageTrack("admissions", "admissions_validation"), null, "a process-stage key is not a board stage");
  assert.equal(stageTrack("sales", undefined), null);
});

test("staff screens never show the separate process-stage words", () => {
  // Слова этапа процесса (`studentOperationalStage`) читает только портал студента.
  const roots = ["src/app/(v3)", "src/components/v3", "src/lib/v3"];
  const offenders = [];
  for (const root of roots) {
    for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })) {
      const path = `${root}/${String(entry).split("\\").join("/")}`;
      if (!/\.(tsx?|css)$/u.test(path) || path === "src/lib/v3/wording.ts") continue;
      const source = read(path);
      if (/studentOperationalStage|CUSTOM_STUDENT_OPERATIONAL_STAGE|индивидуальный этап сопровождения/iu.test(source)) offenders.push(path);
    }
  }
  assert.deepEqual(offenders, []);
  // Экраны, которые показывают этап дела, называют его словом доски.
  for (const path of [
    "src/components/v3/students/StudentsQueueTable.tsx",
    "src/components/v3/students/StudentQuickView.tsx",
    "src/components/v3/students/StudentsQueueHead.tsx",
    "src/components/v3/profile/CaseHeader.tsx",
    "src/components/v3/AdmissionsPipelineBoard.tsx",
  ]) {
    assert.match(read(path), /admissionsPipelineStage\(/u, `${path} names the stage with the board's word`);
  }
});

// --- срок словом ------------------------------------------------------------

test("due word: past with days in red, today as a red fill, the rest neutral, always a word", () => {
  const word = (dueOn, dueAt = null, open = true) => dueWordOf({ dueOn, dueAt }, NOW, open);
  assert.deepEqual(word("2026-09-23"), { text: "прошёл 3 дн", tone: "overdue" });
  assert.deepEqual(word("2026-09-25"), { text: "прошёл 1 дн", tone: "overdue" });
  assert.deepEqual(word(null, "2026-09-26T03:00:00.000Z"), { text: "прошёл", tone: "overdue" }, "time already passed today");
  assert.deepEqual(word("2026-09-26"), { text: "сегодня", tone: "today" });
  assert.deepEqual(word(null, "2026-09-26T12:00:00.000Z"), { text: "сегодня", tone: "today" });
  assert.deepEqual(word("2026-09-27"), { text: "завтра", tone: "upcoming" });
  assert.deepEqual(word("2026-09-28"), { text: "через 2 дн", tone: "upcoming" });
  assert.equal(word("2026-09-23", null, false), null, "a closed task has no overdue word");
  assert.equal(word(null), null, "no deadline, no word");

  assert.equal(blocks.get("due-overdue"), '<span class="v3-due t-caption" data-due="overdue">прошёл 3 дн</span>');
  assert.equal(blocks.get("due-today"), '<span class="v3-due t-caption" data-due="today">сегодня</span>');
  assert.equal(blocks.get("due-later"), '<span class="v3-due t-caption" data-due="upcoming">через 2 дн</span>');
  assert.equal(blocks.get("due-closed"), "");
  assert.equal(blocks.get("due-none"), "");
});

// --- чипы -------------------------------------------------------------------

test("chips always carry a word; colour only supports it, phase colour only with a stage word", () => {
  assert.equal(blocks.get("chip-danger"), '<span class="v3-chip t-caption" data-tone="danger">просрочено</span>');
  assert.equal(textOf(blocks.get("chip-neutral")), "Ждём партнёра");
  assert.equal(blocks.get("chip-empty"), "", "no word, no chip");
  assert.equal(blocks.get("stage-empty"), "", "no stage word, no phase dot");
  for (const name of ["stage-admission", "stage-visa", "stage-sales-truncate"]) {
    const html = blocks.get(name);
    assert.match(html, /<span class="v3-phase-dot" aria-hidden="true"><\/span>/u, `${name}: the dot is a drawing`);
    assert.ok(textOf(html).length > 0, `${name}: the stage word is there`);
  }
  assert.match(blocks.get("stage-visa"), /data-phase="visa"/u);
  // Цвет фазы — только у чипа этапа и дорожки: никакой другой блок фазы не знает.
  for (const [name, html] of blocks) {
    if (/^(?:stage|track)-/u.test(name)) continue;
    assert.doesNotMatch(html, /data-phase=/u, `${name} has no phase colour`);
  }
});

// --- инициалы ---------------------------------------------------------------

test("initials are a neutral circle: no per-person colour, the name in the title and for screen readers", () => {
  assert.equal(personInitials("Имя Фамилия"), "ИФ");
  assert.equal(personInitials("Администратор (синтетический)"), "А");
  assert.equal(personInitials("  "), "");
  const one = blocks.get("initials");
  const other = blocks.get("initials-other");
  assert.equal(one, '<span class="v3-initials t-caption" title="Имя Фамилия"><span aria-hidden="true">ИФ</span><span class="sr-only">Имя Фамилия</span></span>');
  assert.equal(one.replace(/Имя Фамилия|ИФ/gu, ""), other.replace(/Другое Имя|ДИ/gu, ""), "two people differ only by their letters and name");
  assert.doesNotMatch(one + other, /style=|data-color|--person/u);
  assert.equal(blocks.get("initials-decorative"), '<span class="v3-initials t-caption" aria-hidden="true">ИФ</span>', "next to a written name the circle is only a drawing");
  assert.equal(blocks.get("initials-empty"), "");
});

// --- полоса прогресса ---------------------------------------------------------

test("progress only from real counts: «N из M», nothing estimated", () => {
  assert.deepEqual(progressOf(3, 7, "принято"), { done: 3, total: 7, percent: 42.9, label: "3 из 7 принято" });
  assert.equal(progressOf(null, 7), null, "no read, no bar");
  assert.equal(progressOf(3, null), null);
  assert.equal(progressOf(undefined, undefined), null);
  assert.equal(progressOf(0, 0), null, "an empty checklist is not 0 %");
  assert.equal(progressOf(8, 7), null, "counts that do not add up are not shown");
  assert.equal(progressOf(-1, 7), null);
  assert.equal(progressOf(2.5, 7), null);
  const html = blocks.get("progress");
  assert.match(html, /<span class="t-body-compact text-fg">3 из 7 принято<\/span>/u, "the label carries the meaning");
  assert.match(html, /<span class="v3-progress-track" aria-hidden="true">/u, "the bar is its drawing");
  for (const name of ["progress-unread", "progress-empty-checklist", "progress-inconsistent", "progress-fraction"]) {
    assert.equal(blocks.get(name), "", name);
  }
  // Без полосы остаётся строка прежнего облика — прочитанные числа не пропадают.
  assert.equal(blocks.get("progress-inconsistent-fallback"), '<p class="t-body-compact text-fg">8 из 7 принято</p>');
  assert.equal(blocks.get("progress-empty-fallback"), '<p class="t-body-compact text-fg">Чек-лист не собран</p>');
  for (const path of ["src/components/v3/profile/CaseOverview.tsx", "src/components/v3/students/StudentQuickView.tsx"]) {
    const source = read(path);
    assert.match(source, /<ProgressBar done=\{[a-z.]+\?\.approved\} total=\{[a-z.]+\?\.total\} word="принято"\s+fallback=\{<p className="t-body-compact text-fg">\{[a-z]+\.summary\}<\/p>\} \/>/u, `${path}: summary line when there is no bar`);
    assert.doesNotMatch(source, /documents\.total > 0\s*\?\s*<ProgressBar/u, `${path}: no bar-or-nothing branch`);
  }
});

// --- дорожка этапа ------------------------------------------------------------

test("stage track: 9 or 7 segments in phase colour, one current, every segment named", () => {
  for (const [name, count, current] of [["track-admissions", 9, "Документы"], ["track-admissions-visa", 9, "Оформление визы"], ["track-sales", 7, "Квалифицирован"], ["track-sales-handed", 7, "Переданы"]]) {
    const html = blocks.get(name);
    const steps = [...html.matchAll(/<li class="v3-track-step"([^>]*)><span class="sr-only">([^<]+)<\/span><\/li>/gu)];
    assert.equal(steps.length, count, name);
    assert.equal(steps.filter(([, attributes]) => attributes.includes('aria-current="step"')).length, 1, `${name}: one current stage`);
    assert.ok(steps.every(([, , words]) => /, (?:пройден|текущий этап|впереди)/u.test(words)), `${name}: every segment says its state in words`);
    assert.match(html, new RegExp(`<p class="v3-track-caption" aria-hidden="true"><span class="t-body-compact text-fg">${current}</span>`, "u"));
  }
  const visa = blocks.get("track-admissions-visa");
  assert.equal([...visa.matchAll(/data-phase-start=""/gu)].length, 1, "one gap between «Поступление» and «Виза и выезд»");
  assert.match(visa, /Оформление визы, текущий этап, Виза и выезд/u, "the current segment names its phase too");
  assert.equal(blocks.get("track-unknown"), "");
  assert.equal(blocks.get("track-null"), "");
});

test("a closed case has no current stage: the stage word «при закрытии», no track, no aria-current", () => {
  const closed = blocks.get("track-closed");
  assert.equal(closed, '<div class="v3-track" data-track="admissions" data-closed=""><p class="v3-track-caption"><span class="t-body-compact text-fg">Документы</span> <span class="t-meta text-fg-2">этап при закрытии</span></p></div>');
  assert.doesNotMatch(closed, /aria-current|текущий этап|v3-track-step/u);
  assert.match(read("src/components/v3/profile/CaseHeader.tsx"), /<StageTrack kind="admissions" current=\{row\.pipelineStage\} closed=\{input\.state === "closed"\} \/>/u);
  assert.match(read("src/components/v3/students/StudentQuickView.tsx"), /<StageTrack kind="admissions" current=\{row\.pipelineStage\} closed=\{row\.state === "closed"\} \/>/u);
});

// --- «Отменить» -------------------------------------------------------------

test("undo lives in the top layer and only where a real reverse command exists", () => {
  const toast = blocks.get("toast");
  assert.match(toast, /^<div popover="manual" role="group" aria-label="Можно отменить" class="v3-toasts"/u, "top layer (popover)");
  assert.match(toast, /<p class="min-w-0 flex-1 break-words t-body-compact">Задача «Синтетическая задача» завершена\.<\/p><button type="button" data-queue-undo="" data-undo-row="staff:synthetic-1" class="v3-toast-action t-label">Отменить<\/button>/u);
  assert.match(blocks.get("toast-error"), /<p role="alert" class="w-full t-body-compact">Не удалось отменить\. Обновите страницу\.<\/p>/u);
  // Только «Задачи»: отмена завершения рабочей задачи — та же команда смены состояния с версией.
  const users = [];
  for (const root of ["src/app/(v3)", "src/components/v3"]) {
    for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })) {
      const path = `${root}/${String(entry).split("\\").join("/")}`;
      if (/\.tsx?$/u.test(path) && /<UndoToast\b|import \{[^}]*\bUndoToast\b/u.test(read(path))) users.push(path);
    }
  }
  assert.deepEqual(users, ["src/components/v3/tasks/TaskQueueList.tsx"]);
  const list = read("src/components/v3/tasks/TaskQueueList.tsx");
  // Команда отмены — общая с «Сегодня» (useRecentCompletions, #1067).
  assert.match(read("src/components/v3/tasks/useRecentCompletions.ts"), /staffStatusForm\(\{ id: completion\.task\.id, version: completion\.version \}, completion\.previousStatus\)/u, "reverse command with the version after completion");
  assert.match(list, /const toasts = isNextLook\(look\) \?/u, "new look only");
  // У перемещения по доске поступления нет проверки версии (187/244) — «Отменить» там не появляется.
  assert.match(read("supabase/migrations/244_platform_access_by_permissions.sql"), /Deliberately no optimistic version check/u);
  // Задача по студенту завершается с результатом, отмены у неё нет.
  assert.match(read("src/components/v3/profile/CaseTaskList.tsx"), /onCompleted=\{\(\) => \{\}\}/u);
});

test("the undo deadline stands still while focus or the pointer is on the undo row", () => {
  // Завершена до паузы: срок сдвигается на всю паузу — оставшиеся 4 с сохраняются.
  assert.equal(resumedUndoDeadline({ completedAt: 1_000, expiresAt: 7_000 }, 3_000, 20_000), 24_000);
  // Завершена во время паузы: сдвиг — только время с завершения.
  assert.equal(resumedUndoDeadline({ completedAt: 5_000, expiresAt: 11_000 }, 3_000, 20_000), 26_000);
  // Пауза без времени — срок прежний.
  assert.equal(resumedUndoDeadline({ completedAt: 1_000, expiresAt: 7_000 }, 3_000, 3_000), 7_000);
  const hook = read("src/components/v3/tasks/useRecentCompletions.ts");
  assert.match(hook, /if \(!live\.length \|\| held\) return;/u, "no timer while held");
  assert.match(hook, /expiresAt: resumedUndoDeadline\(entry, since, now\)/u);
  assert.match(read("src/components/v3/tasks/TaskQueueList.tsx"), /<UndoToast items=\{toasts\} onHold=\{hold\} \/>/u);
  const toast = read("src/components/v3/blocks/UndoToast.tsx");
  for (const handler of ["onFocus", "onBlur", "onPointerEnter", "onPointerLeave"]) assert.match(toast, new RegExp(`${handler}=\\{`, "u"), handler);
  assert.match(toast, /event\.currentTarget\.contains\(event\.relatedTarget\)\) return;/u, "focus moving inside the row keeps the pause");
  assert.match(toast, /items\.length === 0\s*\? \{ focus: false, pointer: false \}/u, "hidden rows release the pause");
  // «Сегодня» и прежний облик паузу не зовут.
  assert.doesNotMatch(read("src/components/v3/today/TodayQueueList.tsx"), /\bhold\b/u);
});

test("the queue keys keep working while the undo row is open", () => {
  // Ревью PR #1070 (голова 0faee9fc): строка «Отменить» — `popover="manual"`, и
  // проверка «открыто любое :popover-open» выключала j/k, ↑/↓, «/», «?»,
  // Shift+Enter и Esc панели на всё время строки (≥ 6 с, без конца при фокусе).
  const element = (...attributes) => ({ hasAttribute: (name) => attributes.includes(name) });
  const undoRow = element(QUEUE_PASSIVE_POPOVER);
  const menu = element();
  assert.equal(QUEUE_PASSIVE_POPOVER, "data-queue-passive");
  assert.equal(popoverBlocksQueueKeys([]), false, "nothing open");
  assert.equal(popoverBlocksQueueKeys([undoRow]), false, "only the undo row: keys work");
  assert.equal(popoverBlocksQueueKeys([menu]), true, "a menu, «Результат» or the «?» help: keys wait");
  assert.equal(popoverBlocksQueueKeys([undoRow, menu]), true, "a menu over the undo row still wins");
  assert.equal(popoverBlocksQueueKeys([menu, undoRow]), true);
  // Строка «Отменить» помечена пассивной; другие окна верхнего слоя — нет.
  assert.match(blocks.get("toast"), /^<div [^>]*data-testid="v3-undo-toasts" data-queue-passive=""/u);
  const passive = [];
  for (const root of ["src/app/(v3)", "src/components/v3"]) {
    for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { recursive: true })) {
      const path = `${root}/${String(entry).split("\\").join("/")}`;
      if (/\.tsx?$/u.test(path) && /data-queue-passive=/u.test(read(path))) passive.push(path);
    }
  }
  assert.deepEqual(passive, ["src/components/v3/blocks/UndoToast.tsx"], "only the undo row is passive");
  // Обе проверки клавиш — клавиатура очереди и Esc панели — идут через одно правило.
  const hook = read("src/components/v3/queue/useQueueKeyboard.ts");
  assert.match(hook, /export function openPopover\(\): boolean \{\s*try \{ return popoverBlocksQueueKeys\(document\.querySelectorAll\(":popover-open"\)\); \} catch \{ return false; \}/u);
  assert.doesNotMatch(hook, /querySelector\(":popover-open"\)/u, "no «any popover» check is left");
  assert.match(hook, /if \(openPopover\(\) \|\| modalOpen\(\)\) return;/u);
  assert.match(read("src/components/v3/queue/QueueDetailPanel.tsx"), /event\.key !== "Escape"[^\n]*openPopover\(\) \|\| modalOpen\(\)\) return;/u);
  // j/k с «Отменить» продолжают от завершённой строки (data-undo-row), а не с начала списка.
  assert.match(hook, /active\.closest<HTMLElement>\("\[data-undo-row\]"\)\?\.dataset\.undoRow/u);
  assert.match(hook, /const current = focusedRowIndex\(links\);/u);
  // Живая проверка в Chromium — `tests/e2e/tasks-static-render.cjs --screenshots <dir> --look=next`:
  // снимки `*-undo-keys-1440` падают, если j/k, ↓, «?», «/» или Esc панели молчат при открытой строке.
  const harness = read("tests/e2e/tasks-static-render.cjs");
  assert.match(harness, /\["tasks-undo-keys-1440\.png", DESKTOP, false, "undo-keys"\]/u);
  assert.match(harness, /\["tasks-panel-staff-undo-keys-1440\.png", DESKTOP, false, "undo-keys"\]/u);
  assert.match(harness, /if \(failures\.length\) throw new Error/u);
});

test("an undo error belongs to one completion and does not come back with the next", () => {
  const list = read("src/components/v3/tasks/TaskQueueList.tsx");
  assert.match(list, /const state = undoState\[key\]\?\.completedAt === completedAt \? undoState\[key\] : undefined;/u);
  assert.equal(list.match(/\[key\]: \{ completedAt, pending: (?:true|false), error: (?:null|failure) \}/gu)?.length, 2);
});

// --- CSS: только новый облик, движение, контраст ------------------------------

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../gu).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const tokens = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return Object.fromEntries([...css.slice(start, css.indexOf("}", start)).matchAll(/--([a-z0-9-]+):\s*(#[a-f0-9]{6});/gu)].map((match) => [match[1], match[2]]));
};

test("block styles exist only in the new look, set no font sizes and keep contrast", () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const rules = [...plain.matchAll(/(?:^|[;}])\s*([^;{}@]+)\{/gu)].map((match) => match[1].trim()).filter((selector) => BLOCK_CLASSES.test(selector));
  assert.ok(rules.length >= 20, "the blocks have their rules");
  for (const selector of rules) {
    for (const part of selector.split(/,(?![^(]*\))/u)) {
      assert.match(part.trim(), /^\.v3-world\[data-look="next"\] /u, `${part.trim()}: new look only`);
    }
  }
  const blockCss = css.slice(css.indexOf("Общие блоки нового облика"));
  assert.doesNotMatch(blockCss, /font-size|font-weight|line-height/u, "type comes from the t-* roles in markup");
  const base = tokens(".v3-world");
  const next = { ...base, ...tokens('.v3-world[data-look="next"]') };
  const phases = [next["phase-sales"], next["phase-admission"], next["phase-visa"]];
  assert.equal(new Set(phases).size, 3, "three phase colours");
  for (const phase of phases) {
    assert.ok(phase, "phase colour defined in the new look");
    for (const surface of ["surface", "bg", "surface-2", "surface-3", "accent-weak"]) {
      assert.ok(contrast(phase, next[surface]) >= 3, `${phase} on ${surface}`);
    }
    for (const status of ["ok", "warn", "danger", "info", "accent"]) assert.notEqual(phase, next[status], "a phase is not a status colour");
  }
  assert.ok(contrast(next["on-accent"], next.accent) >= 4.5, "«сегодня»: white on red");
  assert.ok(contrast(next["text-2"], next["surface-2"]) >= 4.5, "initials letters");
  assert.ok(contrast(next.surface, next.text) >= 4.5, "undo row");
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-due\[data-due="today"\] \{[^}]*background: var\(--accent\);[^}]*color: var\(--on-accent\);/u);
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-due\[data-due="overdue"\] \{\s*color: var\(--danger\);/u);
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-toast-action \{[^}]*min-height: 44px;/u, "44 px target");
  // Чип-ссылка: чип 18 px с полями −1 px — ссылка 16 px; зона нажатия 16 + 2 × 14 = 44 px.
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-chip\[data-size="sm"\] \{\s*min-height: 18px;\s*margin-block: -1px;/u);
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-chip-link::after \{\s*content: "";\s*position: absolute;\s*inset: -14px -4px;/u);
  // Чип-ссылка подчёркнут: рядом такой же чип «просрочено», который не ссылка.
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-chip-link \.v3-chip \{\s*text-decoration-line: underline;/u);
  // Третья строка карточки продаж — одна линия; не поместилось — уходит целиком.
  assert.match(css, /\.v3-world\[data-look="next"\] \.v3-card-meta \{\s*height: 1lh;\s*overflow: hidden;/u);
  assert.match(css, /\.v3-world\[data-look="next"\] :is\(\.v3-card-due, \.v3-card-age\) \{\s*white-space: nowrap;/u);
});

test("motion is short and only when the system allows it", () => {
  const blockCss = css.slice(css.indexOf("Общие блоки нового облика"));
  const motion = blockCss.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/u);
  assert.ok(motion, "block motion sits behind prefers-reduced-motion: no-preference");
  const outside = blockCss.replace(motion[0], "");
  assert.doesNotMatch(outside, /\b(?:transition|animation)(?:-[a-z]+)?:/u, "no motion outside that media query");
  for (const [, ms] of motion[1].matchAll(/(\d+)ms/gu)) assert.ok(Number(ms) <= 200, `${ms}ms ≤ 200ms`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.v3-world \*, \.v3-world \*::before, \.v3-world \*::after \{\s*animation: none !important;\s*transition: none !important;/u);
});

// --- экраны: прежний облик без блоков, новый — с блоками ---------------------

const SCREENS = [
  ["tasks-static-render.cjs", ["team-view", "team-panel"]],
  ["students-static-render.cjs", ["admin-active", "admin-panel", "curator-mine"]],
  ["boards-static-render.cjs", ["sales", "sales-panel", "admissions"]],
  ["case-static-render.cjs", ["curator", "admin", "unread", "closed"]],
];
const current = new Map(SCREENS.map(([script]) => [script, render(script)]));
const next = new Map(SCREENS.map(([script]) => [script, render(script, "--look=next")]));

test("the current look renders none of the blocks; the new look renders them on every first surface", () => {
  for (const [script] of SCREENS) {
    for (const [name, html] of current.get(script)) assert.doesNotMatch(html, BLOCK_CLASSES, `${script} ${name}: current look unchanged`);
  }
  const tasks = next.get("tasks-static-render.cjs").get("team-view");
  assert.match(tasks, /<span class="v3-due t-caption" data-due="overdue">прошёл \d+ дн<\/span>/u);
  assert.match(tasks, /<span class="v3-due t-caption" data-due="today">сегодня<\/span>/u);
  assert.match(tasks, /<span class="v3-initials t-caption" aria-hidden="true">[А-ЯЁ]{1,2}<\/span><span class="truncate">/u, "assignee: circle next to the written name");
  const students = next.get("students-static-render.cjs");
  assert.match(students.get("admin-active"), /<span class="v3-stage" data-phase="(?:admission|visa)">/u, "stage column");
  assert.match(students.get("admin-active"), /class="v3-chip t-caption" data-tone="danger"/u, "signals are chips with words");
  assert.match(students.get("admin-panel"), /<div class="v3-track" data-track="admissions">/u, "quick view: stage track");
  assert.match(students.get("admin-panel"), /<span class="t-body-compact text-fg">\d+ из \d+ принято<\/span>/u, "quick view: documents progress");
  const boards = next.get("boards-static-render.cjs");
  // Колонки не подкрашиваются: у доски и вкладки одна фаза — точки над колонками нет.
  for (const name of ["sales", "admissions"]) assert.doesNotMatch(boards.get(name), /v3-phase-dot|v3-stage/u, `${name}: column headers are words`);
  assert.match(boards.get("sales-panel"), /<div class="v3-track" data-track="sales">/u, "lead panel: stage track");
  assert.match(boards.get("admissions"), /<a [^>]*class="v3-chip-link inline-flex" href="\/v3\/messages\?case=[^"]+"><span class="v3-chip t-caption" data-tone="danger" data-size="sm">нужен ответ<\/span><\/a>/u, "reply chip link");
  assert.match(boards.get("admissions"), /<span class="v3-initials t-caption" data-size="sm" title="[^"]+">/u, "card: curator initials with the name in the title");
  // Карточка продаж: дата, затем слово срока — как в «Задачах»; возраст этапа подписан.
  const lines = [...boards.get("sales").matchAll(/<p class="v3-card-meta t-meta text-fg-3">([\s\S]*?)<\/p>/gu)].map(([, html]) => html);
  assert.ok(lines.length >= 5, "sales cards have their third line");
  assert.ok(lines.some((html) => /^<span class="v3-card-due"><time dateTime="[^"]+" class="font-mono tabular-nums">\d\d\.\d\d<\/time> <span class="v3-due t-caption" data-due="overdue">прошёл \d+ дн<\/span><\/span> <span class="v3-card-age"><span aria-hidden="true">· <\/span>на этапе \d+ дн<\/span>$/u.test(html)), "date, word, then «на этапе N дн»");
  assert.ok(lines.some((html) => /<time dateTime="[^"]+" class="font-mono tabular-nums">\d\d\.\d\d<\/time> <span class="v3-due t-caption" data-due="today">сегодня<\/span>/u.test(html)), "«сегодня» after its date");
  assert.ok(lines.some((html) => /^<span class="v3-card-age">на этапе \d+ дн<\/span>$/u.test(html)), "no deadline: only the stage age");
  for (const html of lines) assert.doesNotMatch(html, /дн\./u, "one abbreviation: «дн»");
  assert.match(boards.get("sales-panel"), /<dt class="t-caption pt-0\.5 text-fg-3">На этапе<\/dt><dd class="tabular-nums">\d+ дн<\/dd>/u);
  // Прежний облик — прежние слова.
  assert.match(current.get("boards-static-render.cjs").get("sales"), /\d+ дн\.<span class="sr-only"> на стадии<\/span>/u);
  const kase = next.get("case-static-render.cjs");
  assert.match(kase.get("curator"), /<div class="v3-track" data-track="admissions">/u, "case header: stage track");
  assert.match(kase.get("curator"), /<span class="v3-due t-caption" data-due="[a-z]+">/u, "case header: step due word");
  // Закрытое дело: этап при закрытии, без текущего этапа.
  assert.match(kase.get("closed"), /<div class="v3-track" data-track="admissions" data-closed="">/u);
  assert.doesNotMatch(kase.get("closed"), /aria-current="step"/u);
  // Нет чтения документов — нет полосы.
  assert.doesNotMatch(kase.get("unread"), /v3-progress/u);
  assert.match(kase.get("unread"), /Нет доступа к документам этого дела\./u);
});

test("every chip, due word and stage in the new look has its word", () => {
  for (const [script] of SCREENS) {
    for (const [name, html] of next.get(script)) {
      for (const [element] of html.matchAll(/<span class="v3-(?:chip|due)[^"]*"[^>]*>[^<]*<\/span>/gu)) {
        assert.ok(textOf(element).length > 0, `${script} ${name}: ${element}`);
      }
      for (const [, word] of html.matchAll(/<span class="v3-phase-dot" aria-hidden="true"><\/span><span class="min-w-0[^"]*">([^<]*)<\/span>/gu)) {
        assert.ok(word.trim().length > 0, `${script} ${name}: phase dot without a stage word`);
      }
    }
  }
});
