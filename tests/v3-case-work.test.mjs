import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  caseApplicationLines,
  caseChatWork,
  caseChecklistCounts,
  caseContacts,
  caseMomentLabel,
  caseOpenTasks,
  casePortalStatus,
  caseSaleBlocks,
  caseSaleSummary,
} from "../src/components/v3/profile/case-work-view.ts";
import { studentsDocumentsLine } from "../src/components/v3/students/students-queue-view.ts";
import { caseDocumentsAwaitCurator, caseSectionAccessForState, readCaseProfileSections } from "../src/lib/v3/case-access-contract.ts";
import { getPlatformCaseDocumentWorkspace, PlatformPrivateDocumentsRepositoryError } from "../src/lib/platform-private-documents.ts";
import { caseDocumentsWords, country } from "../src/lib/v3/wording.ts";

/**
 * Дело студента «сначала работа» (решение владельца 26.09.2026,
 * docs/PLAN_CHANGES.md). Логика строк «Обзора» проверяется напрямую,
 * разметка — настоящей сборкой страницы дела (`caseWorkParts` + `Profile`)
 * с синтетическими данными (tests/e2e/case-static-render.cjs --json) в
 * отдельном node-процессе. Это не живая проверка данных: права решает SQL.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
// Настоящий разбор ответа RPC условий дела (290) с его зависимостями, без подмен: модуль тянет импорты без расширения.
const { parseCaseSaleConditionsResult } = await import(`data:text/javascript;base64,${Buffer.from((await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/lead-sale-conditions-contract.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
})).outputFiles[0].text).toString("base64")}`);
const texts = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
/**
 * Разметка без свёрнутого: закрытых `<details>` и скрытых областей
 * (`hidden`) — то, что видно без раскрытия. Вырезается весь элемент с
 * вложенными элементами того же имени.
 */
function visible(html) {
  let out = html;
  for (const [tag, open] of [["details", /<details(?![^>]*\bopen\b)[^>]*>/u], ["div", /<div[^>]*\bhidden=""[^>]*>/u]]) {
    for (let match = open.exec(out); match; match = open.exec(out)) {
      let depth = 0;
      const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "gu");
      pattern.lastIndex = match.index;
      let end = out.length;
      for (let token = pattern.exec(out); token; token = pattern.exec(out)) {
        depth += token[0].startsWith("</") ? -1 : 1;
        if (depth === 0) { end = token.index + token[0].length; break; }
      }
      out = out.slice(0, match.index) + out.slice(end);
    }
  }
  return out;
}

const ME = "aaaaaaaa-1111-4111-8111-000000000001";
const OTHER = "aaaaaaaa-1111-4111-8111-000000000002";
const CASE = "cccccccc-2222-4222-8222-000000000001";

function task(id, fields) {
  return {
    organizationId: "eeeeeeee-4444-4444-8444-000000000000", caseTaskId: id, version: "1", studentCaseId: CASE, taskType: "general",
    title: fields.title, status: fields.status ?? "todo", priority: "normal", dueOn: fields.dueOn ?? null, dueAt: fields.dueAt ?? null,
    studentVisible: false, assigneeMembershipId: ME, assigneeDisplayName: "Сотрудник", creatorMembershipId: ME,
    creatorDisplayName: "Сотрудник", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

test("open case tasks follow the «Задачи» order: overdue first, undated last, closed ones gone", () => {
  const tasks = caseOpenTasks([
    task("99999999-0000-4000-8000-000000000003", { title: "без срока" }),
    task("99999999-0000-4000-8000-000000000002", { title: "позже", dueOn: "2026-10-01" }),
    task("99999999-0000-4000-8000-000000000001", { title: "просрочена", dueOn: "2026-09-20" }),
    task("99999999-0000-4000-8000-000000000004", { title: "выполнена", dueOn: "2026-09-01", status: "done" }),
    task("99999999-0000-4000-8000-000000000005", { title: "отменена", status: "cancelled" }),
  ], "Студент", "active");
  assert.deepEqual(tasks.map((item) => item.title), ["просрочена", "позже", "без срока"]);
  assert.deepEqual([...new Set(tasks.map((item) => item.kind))], ["case"]);
  assert.equal(tasks[0].key, "case:99999999-0000-4000-8000-000000000001");
  // Ожидающее дело не выдаёт себя за закрытое или работающее.
  assert.equal(caseOpenTasks([task("99999999-0000-4000-8000-000000000001", { title: "x" })], "Студент", "pending")[0].caseState, null);
});

test("the documents line counts the case checklist like the 241 row: removed items do not count", () => {
  const item = (status) => ({ status });
  const counts = caseChecklistCounts([
    { kind: "active", title: "A", items: [item("approved"), item("approved"), item("submitted"), item("correction_required"), item("rejected"), item("required")] },
    { kind: "removed", title: "Удалённые", items: [item("approved")] },
  ]);
  assert.deepEqual(counts, { total: 6, submitted: 1, correctionRequired: 1, rejected: 1, approved: 2, missing: 1 });
  assert.equal(studentsDocumentsLine(counts).summary, "2 из 6 принято");
  assert.equal(studentsDocumentsLine(caseChecklistCounts([])).summary, "Чек-лист не собран");
});

test("the correspondence line is the latest message by sequence and never a read receipt", () => {
  const message = (sequenceId, author, body) => ({
    id: `11111111-0000-4000-8000-00000000000${sequenceId}`, sequenceId: String(sequenceId), authorMembershipId: author, authorName: author === ME ? "Я" : "Студент",
    body, createdAt: "2026-09-22T08:00:00.000Z", quotedMessageId: null, quotedPreview: null, attachmentKind: null, attachmentId: null, attachmentLabel: body ? null : "Паспорт",
  });
  const page = (messages, awaitState = "needs_reply") => ({ messages, cursor: "0", hasMore: false, readSequenceId: "0", thread: { awaitState, lastMessageAt: null, lastMessageSequenceId: null } });
  const work = caseChatWork(page([message(2, OTHER, "Можно  в\nпятницу?"), message(10, ME, "Да")]), ME);
  assert.equal(work.kind, "ready");
  assert.equal(work.awaitState, "needs_reply");
  assert.deepEqual({ mine: work.last.mine, text: work.last.text }, { mine: true, text: "Да" });
  assert.equal(caseChatWork(page([message(2, OTHER, "Можно  в\nпятницу?")]), ME).last.text, "Можно в пятницу?");
  assert.equal(caseChatWork(page([message(3, OTHER, "")]), ME).last.text, "Паспорт");
  assert.equal(caseChatWork(page([], "none"), ME).last, null);
  const long = caseChatWork(page([message(4, OTHER, "а".repeat(300))]), ME).last.text;
  assert.equal(Array.from(long).length, 140);
  assert.ok(long.endsWith("…"));
  assert.equal(caseMomentLabel("2026-09-22T08:14:00.000Z", "2026-09-23"), "22.09 14:14");
  assert.equal(caseMomentLabel("2025-06-01T00:00:00.000Z", "2026-09-23"), "01.06.25 06:00");
  // Чтение переписки — STABLE-функция без записи; отметку о прочтении ставит только открытая переписка.
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /readCaseChatPage\(actor, target\.studentCaseId, "latest"\)/u);
  assert.doesNotMatch(source, /case_chat_command|mode: "read"/u);
});

test("applications put the primary option first; portal status is read, never guessed", () => {
  const row = (id, primary, programName) => ({ universityApplicationId: id, isPrimary: primary, institutionName: "Университет", programName, status: "preparation", universityDeadlineOn: null });
  assert.deepEqual(caseApplicationLines([row("a", false, null), row("b", true, "Экономика")]).map((line) => [line.id, line.title]), [["b", "Университет · Экономика"], ["a", "Университет"]]);
  assert.deepEqual(casePortalStatus(null), { text: "не проверен", tone: "muted" });
  assert.equal(casePortalStatus({ status: "approved" }).text, "анкета одобрена");
  assert.equal(casePortalStatus({ status: "pending" }).tone, "warn");
});

test("the case view (Student 360, Э4): stage and «Что дальше» under the name, work first, one solid red only while the case awaits acceptance", () => {
  const html = surfaces.get("curator-accept");
  const shown = visible(html);
  const text = texts(html);
  // Шапка: этап — дорожка со словами «Воронки» и фазой · «Что дальше» — шаг, срок словом и «Изменить» · состояние.
  assert.match(text, /Этап Новые, пройден .*? Прибыл, впереди Документы Поступление Что дальше Собрать апостиль на аттестат 20\.09 прошёл 3 дн Изменить/u);
  // «Принять дело» у заголовка уже говорит, что дело ждёт принятия: второй раз «Состояние ждёт принятия» под ней нет.
  assert.doesNotMatch(text, /Состояние ждёт принятия/u);
  assert.match(html, /<button id="queue-trigger-[^"]+" type="button" popovertarget="queue-popover-[^"]+"[^>]*aria-haspopup="dialog"[^>]*>Изменить<\/button>/iu);
  assert.match(html, /popover="auto"[^>]*role="dialog"[^>]*><h2[^>]*>Следующий шаг<\/h2>[\s\S]*?data-testid="v3-next-step-editor"/u);
  // «Обзор» по порядку: Задачи → Сведения → Лента (на телефоне — так же; от 1280 px «Сведения» справа).
  let cursor = 0;
  for (const title of ["Задачи", "Сведения", "Лента"]) {
    const position = text.indexOf(`${title} `, cursor);
    assert.ok(position > cursor, `${title} after ${cursor}`);
    cursor = position;
  }
  // «Принять дело» — главное действие у заголовка и единственная сплошная красная кнопка;
  // «Все задачи дела» из «Быстрого просмотра» ведёт на `#case-tasks`.
  assert.match(html, /<section id="case-tasks" aria-labelledby="case-tasks-title"/u);
  assert.match(html, /data-testid="v3-case-actions"><button type="button" aria-haspopup="dialog" class="[^"]*bg-accent[^"]*" data-testid="v3-case-primary">Принять дело<\/button>/u);
  assert.equal((shown.match(/bg-accent (?:px|text)/gu) ?? []).length, 1, "one solid red button");
  // Задачи: просроченные первыми, выполнение в строке, без имени студента в каждой строке.
  assert.match(text, /Проверить перевод аттестата у нотариуса.*Позвонить семье.*Отправить мотивационное письмо/u);
  assert.match(html, /aria-label="Завершить с результатом: Проверить перевод аттестата у нотариуса"/u);
  assert.equal((html.match(/data-queue-row=/gu) ?? []).length, 6);
  assert.match(text, /Показать ещё 2/u);
  assert.doesNotMatch(texts(html.slice(html.indexOf('data-testid="v3-case-tasks"'))).split("Показать ещё")[0], /Айдана Сыдыкова/u);
  // Документы, заявки, переписка — факты из прочитанных данных, со ссылками на вкладки.
  // «N из M принято» — полоса из прочитанных чисел, остальное — чипы со словом (Э1.3).
  // Ссылок «Документы дела», «Вузы и программы», «Договор и оплата» в «Сведениях» нет: те же названия стоят вкладками прямо над ними.
  assert.match(text, /Документы 7 из 12 принято 2 на проверке 1 исправить 2 не загружено Заявки/u);
  assert.match(text, /Переписка Нужен ответ Открыть переписку/u);
  assert.match(html, /href="\/v3\/messages\?case=cccccccc-2222-4222-8222-000000000001"/u);
  assert.match(text, /Шанхайский университет · Международная торговля — готовится · основной вариант · срок подачи 30\.11/u);
  // Последнее сообщение переписки — в ленте.
  assert.match(text, /Лента .*Переписка · Айдана Сыдыкова 22\.09 14:14 Здравствуйте!/u);
  // Прежние дубли ушли: ссылка дела на само себя, «Коротко», вторая «Создать задачу по студенту».
  assert.doesNotMatch(text, /Дело уже создано|Коротко|Создать задачу по студенту|Открыть дело/u);
  // Оплата не видна без права на неё; «Добавить заметку» — спокойная кнопка.
  assert.doesNotMatch(text, /Оплата /u);
  assert.match(html, />Добавить заметку<\/button>/u);
  assert.doesNotMatch(html, /bg-accent px-3 text-xs font-semibold text-white[^>]*>Добавить заметку/u);
});

test("after acceptance the answer moves to «Сведения»; nothing on the page is solid red", () => {
  const html = surfaces.get("curator");
  assert.equal((visible(html).match(/bg-accent (?:px|text)/gu) ?? []).length, 0);
  assert.doesNotMatch(html, /data-testid="v3-case-primary"/u);
  assert.match(texts(html), /Приём дела Дело принято куратором Согласованный контакт: 24\.09\.2026 Изменить ответ/u);
});

test("Student 360 header: the AI consent chip (320) says one of three words, quietly; only «не разрешено» warns; no chip when nothing was read", () => {
  const chip = (name) => {
    const html = surfaces.get(name);
    assert.ok(html, name);
    const found = [...html.matchAll(/<span class="v3-chip t-caption shrink-0" data-tone="([a-z]+)"><span title="([^"]*)" data-testid="v3-case-ai-consent">([^<]*)<\/span><\/span>/gu)];
    return found.length === 0 ? null : { count: found.length, tone: found[0][1], title: found[0][2], label: found[0][3] };
  };
  assert.deepEqual([chip("ai-consent-granted").label, chip("ai-consent-declined").label, chip("ai-consent-none").label, chip("ai-consent-none-no-portal").label],
    ["ИИ: разрешено", "ИИ: не разрешено", "ИИ: не спрашивали", "ИИ: не спрашивали"]);
  assert.deepEqual([chip("ai-consent-granted").tone, chip("ai-consent-declined").tone, chip("ai-consent-none").tone, chip("ai-consent-none-no-portal").tone],
    ["neutral", "warn", "neutral", "neutral"]);
  // One chip per page, with its hint in words (no raw code, no number).
  for (const name of ["ai-consent-granted", "ai-consent-declined", "ai-consent-none", "ai-consent-none-no-portal"]) {
    assert.equal(chip(name).count, 1, name);
    assert.match(chip(name).title, /[А-Яа-я]/u, name);
    assert.doesNotMatch(chip(name).title + chip(name).label, /ai_consent|granted|declined|\d/u, name);
  }
  assert.match(chip("ai-consent-none").title, /пока он не разрешит/u);
  assert.match(chip("ai-consent-none-no-portal").title, /нет кабинета/u);
  // The chip sits in the header section, next to the other quiet state words, not in a red block.
  const header = surfaces.get("ai-consent-declined").match(/<section id="case-header"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.ok(header.includes('data-testid="v3-case-ai-consent"'), "the chip is inside the case header");
  assert.doesNotMatch(header, /data-tone="danger"/u, "a declined consent is never a red pill");
  // Every other scenario (consent not read, no right, preview) draws no chip at all.
  for (const name of ["curator", "admin", "unread", "assign-only", "closed", "preview-awaiting", "direct-case"]) {
    assert.equal(chip(name), null, `${name}: no chip without a read`);
  }
});

test("«Приём дела» in «Сведения» keeps the curator's answer for those who cannot respond: decision, reason, agreed contact", () => {
  // Admin не отвечает на назначение: причина отказа куратора — та же, что в прежней карточке «Приём дела».
  const declined = surfaces.get("admin-declined");
  assert.match(texts(declined), /Приём дела Назначение отклонено куратором Нагрузка выше нормы до конца октября, прошу назначить другого куратора\./u);
  assert.doesNotMatch(texts(declined), /Изменить ответ|Принять дело/u);
  assert.doesNotMatch(declined, /data-testid="v3-case-accept-drawer"/u);
  // Тот же HandoffResponseSummary, что у карточки «Приём дела» на лиде и во вкладке «Вузы и программы».
  const overview = read("src/components/v3/profile/CaseOverview.tsx");
  assert.match(overview, /import \{ HandoffResponseSummary \} from "\.\/ProfileSalesTransition";/u);
  assert.match(overview, /<Fact term="Приём дела">[\s\S]*?<HandoffResponseSummary current=\{handoff\.current \? \{\n\s+decision: handoff\.current\.decision,\n\s+clarification: handoff\.current\.clarification,\n\s+agreedContactDate: handoff\.current\.agreedContactDate,/u);
});

test("Admin: sales forms and portal access are collapsed groups under «Сведения»; contacts are one fact", () => {
  const html = surfaces.get("admin");
  const shown = visible(html);
  const text = texts(html);
  assert.equal((shown.match(/bg-accent (?:px|text)/gu) ?? []).length, 0);
  assert.match(html, /<details name="case-edit" id="sales-data" data-lead-group="" data-testid="v3-case-sales-data"[^>]*><summary[^>]*><span[^>]*><span class="t-item text-fg">Данные продажи<\/span>/u);
  for (const block of ["Условия продажи", "Договор и оплата", "Пожелания", "Образование", "Условия"]) {
    assert.doesNotMatch(texts(shown), new RegExp(`(?:^| )${block} .*Сохранить`, "u"), block);
  }
  assert.match(html, /id="sale-conditions"/u, "the sale conditions anchor still exists inside «Данные продажи»");
  // Раскрытые «Данные продажи» не добавляют красных: четыре «Сохранить» — спокойные кнопки.
  const salesData = html.slice(html.indexOf('id="sales-data"'));
  assert.equal((salesData.match(/bg-accent (?:px|text)/gu) ?? []).length, 0, "no solid red inside «Данные продажи»");
  assert.equal((salesData.match(/>(?:Сохранить|Сохранить условия)<\/button>/gu) ?? []).length, 4);
  assert.match(read("src/components/v3/profile/CaseWorkParts.tsx"), /<SalesOverview [^>]*requestIds=\{input\.requestIds\} quiet groups \/>/u);
  assert.match(text, /Оплата 40% оплачено · остаток 900 \$/u);
  assert.match(html, /<details name="case-edit" id="portal-access" data-lead-group="" data-testid="v3-case-portal"[^>]*>/u);
  assert.match(text, /Доступ к порталу анкета одобрена/u);
  assert.match(text, /Сведения Направление Китай Сменить направление Куратор АО Айгүл Осмонова Сменить куратора Передал Эрмек Токтосунов · 30\.08 12:00 Передано в поступление Контакты \+996 000 000 001 student@example\.invalid Приём дела Дело принято куратором Согласованный контакт: 24\.09\.2026/u);
  assert.match(html, /href="tel:\+996000000001"/u);
  assert.match(html, /href="\/v3\/profile\?view=curators&amp;coverage_curator=aaaaaaaa-1111-4111-8111-000000000001&amp;coverage_case=cccccccc-2222-4222-8222-000000000001#curator-coverage"/u);
});

test("unread parts say so: no stage, no step editor, no invented task, chat, document numbers or events", () => {
  const text = texts(surfaces.get("unread"));
  assert.doesNotMatch(text, /Этап|Изменить|Задать шаг/u);
  assert.match(text, /Что дальше Собрать апостиль на аттестат/u);
  assert.match(text, /Не удалось загрузить задачи\. Обновите страницу, чтобы повторить\./u);
  assert.match(text, /Документы нет доступа/u);
  assert.match(text, /Переписка нет доступа/u);
  assert.match(text, /События журнала дела сейчас не прочитаны\. Обновите страницу, чтобы повторить\./u);
  assert.doesNotMatch(text, /Передал/u, "a case not from Sales has no «Передал»");
  assert.doesNotMatch(surfaces.get("unread"), /href="\/v3\/messages\?case=/u);
  const closed = texts(surfaces.get("closed"));
  assert.match(closed, /Состояние Дело закрыто/u);
  assert.doesNotMatch(closed, /Изменить|Задать шаг/u);
  assert.match(closed, /Открытых задач нет\. .*Переписка сообщений пока нет/u);
});

test("the page: name as h1, «Дело студента» tab title, back to the same list; the lead view keeps its own overview", () => {
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /if \(typeof caseParam === "string" && leadParam === undefined\) return \{ title: "Дело студента" \};/u);
  // Закрытый лид (246) — его имя, как у дела.
  // Лид (Э4) — тоже по имени: `leadParts` — Lead 360 как рабочая карточка.
  // Даже запасная страница (роль без чтения продаж) называется по имени, а не «Профиль»: имя — единственный h1.
  assert.match(page, /<PartShell title=\{view \? leadDisplayName\(view\.profile\.source, view\.profile\.person\) : docsMode \? "EVO Docs"\n\s+: closedLead \? closedLead\.name \?\? "Лид без имени" : "Студенты"\}/u);
  assert.match(page, /<Link href=\{requestsReturnTo \?\? directoryHref\}[^>]*>\s*<Icon name="arrow-left" size=\{16\} \/>\s*\{requestsReturnTo \? "Заявки" : docsMode \? "EVO Docs" : "Студенты"\}/u);
  assert.match(page, /const caseTarget = view\?\.details\.routeTarget\.studentCaseId && view\.details\.admissions/u);
  assert.match(page, /caseOverview=\{caseParts\?\.overview \?\? leadParts\?\.overview \?\? undefined\}/u);
  // Права редактора шага — одни для «Быстрого просмотра» и дела.
  assert.match(page, /stepAccess: caseWork\.row \? nextStepAccess\(editor\.input, caseWork\.row, editor\.recordScopes\) : \{ kind: "read_only", reason: null \}/u);
  assert.match(page, /editor: editor\.input,\n    recordScopes: editor\.recordScopes,/u);
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /\{current === "overview" && caseOverview \? caseOverview : null\}/u);
  assert.match(profile, /\{current === "overview" && !caseOverview \? \(/u);
  assert.match(profile, /<Overview\n/u);
  // Полоса вкладок прокручивается и обрезала бы внешнюю рамку фокуса — у её вкладок рамка внутри
  // (Э8.4: ряд вкладок очередей `QueueTabStrip`, `focusable` — `tabIndex` и `data-tab-strip`).
  assert.match(profile, /<QueueTabStrip label="Разделы профиля" focusable testId="v3-profile-tabs">/u);
  // Одна вкладка («Обзор» у лида без содержимого) — ряда нет.
  assert.match(profile, /\{tabs\.length > 1 \? \(\s*<QueueTabStrip/u);
  assert.match(read("src/components/v3/queue/QueueTabStrip.tsx"), /tabIndex=\{focusable \? 0 : undefined\}\n\s+data-tab-strip=\{focusable \? "" : undefined\}/u);
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \[data-tab-strip\] \.v3-choice:focus-visible \{\n {2}outline-offset: -2px;\n\}/u);
  // Прежний «Обзор» лида рисует ту же часть продажи, что «Данные продажи» дела.
  assert.match(read("src/components/v3/profile/tabs.tsx"), /<SalesOverview profile=\{profile\} sales=\{sales\} draft=\{draft\} actor=\{actor\} requestIds=\{requestIds\} quiet \/>/u);
  // Строка очереди дела — то же чтение 241, выбранная по id; не нашлась — null, а не выдумка.
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /view: target\.state, sort: "due", pageSize: STUDENT_CASE_QUEUE_PAGE_SIZE_MAX, query,/u);
  assert.match(source, /page\.rows\.find\(\(row\) => row\.studentCaseId === target\.studentCaseId\) \?\? null/u);
});

// --- Дело без лида для чтения: контакты и направление в «Сведениях» ----------------------------
// Дело прямого студента (форма «Добавить студента», импорт из amoCRM): его лид `converted`, лидовые
// чтения отдают только `open`, и `readCaseProfile` идёт по ветке «только дело» без клиента лида.

test("direct case: «Контакты» come from the анкета fields with one quiet note, «Направление» from the case snapshot only", () => {
  const html = surfaces.get("direct-case");
  const text = texts(html);
  // Снимок дела (Малайзия) - единственный источник; в строке очереди (Китай) другое значение, оно не берётся.
  assert.match(text, /Сведения Направление Малайзия Сменить направление Куратор .* Контакты \+996 000 000 002 student-2@example\.invalid не подтверждено Документы/u);
  assert.doesNotMatch(text, /Направление Китай/u);
  // «Доступ к порталу» по-прежнему ждёт подтверждённую почту клиента: неподтверждённое поле анкеты его не заполняет.
  assert.match(text, /Нет рабочего email — добавьте его/u);
  assert.doesNotMatch(html, /name="email" value="student-2@example\.invalid"/u);
  // Одна подпись на оба значения, а не по подписи у каждого.
  assert.equal((text.match(/не подтверждено/gu) ?? []).length, 1);
  assert.match(html, /href="tel:\+996000000002"/u);
  assert.match(html, /href="mailto:student-2@example\.invalid"/u);
  // Менеджера продаж у дела нет: ни «Продажа» в «Сведениях», ни «менеджер не назначен», ни форм условий.
  assert.doesNotMatch(text, /Продажа |менеджер не назначен|Условия продажи/u);
  // Ни ключа поля, ни ключа состояния на экране.
  assert.doesNotMatch(html, /needs_review|mobile_phone|student_email|admissions_direction|converted/u);
  assert.doesNotMatch(text, /Не выбрано/u);
  // Подпись без цвета: это не ошибка и не состояние записи.
  assert.doesNotMatch(html, /<[^>]+class="[^"]*\b(?:text-danger|text-warn)\b[^"]*"[^>]*>не подтверждено/u);
});

/** Разметка группы «Данные продажи» (`details`) от её начала до закрытия; "" - группы нет. */
function saleGroup(html) {
  const at = html.indexOf('data-testid="v3-case-sales-data"');
  if (at < 0) return "";
  const open = html.lastIndexOf("<details", at);
  return html.slice(open, html.indexOf("</details>", at) + "</details>".length);
}

test("direct case: «Данные продажи» show the conditions of the converted lead read-only, with the sum and the day in the title", () => {
  const html = surfaces.get("direct-case");
  const group = saleGroup(html);
  assert.ok(group, "the group is drawn");
  // Закрыта (раскрывает `?panel=sales` и `#sale-conditions`); в строке у названия - сумма и день продажи.
  assert.doesNotMatch(group.slice(0, group.indexOf(">") + 1), /\bopen\b/u);
  assert.match(texts(group), /^Данные продажи 1 500,00 USD · 01\.09\.2026 /u);
  // Заполнено только то, что внесено при создании дела: один блок без подзаголовка, две строки, без пустых ключей.
  assert.match(texts(group), /Дата продажи 01\.09\.2026 Сумма 1 500,00 USD$/u);
  assert.doesNotMatch(texts(group), /Услуга|Оплачено|Заметка|Пожелания|Образование|Условия|Бюджет|Стипендия/u);
  assert.equal((group.match(/<h3/gu) ?? []).length, 0);
  // Только чтение: ни полей, ни кнопок, ни форм.
  assert.doesNotMatch(group, /<(?:input|select|textarea|button|form)\b/u);
  // Якорь «Условия продажи» из «Договора и оплаты» стоит в самой группе; день - <time>.
  assert.match(group, /id="sale-conditions"/u);
  assert.match(group, /<time dateTime="2026-09-01"[^>]*>01\.09\.2026<\/time>/u);
});

test("direct case with all four blocks: titles, the budget period as a word, no raw keys, still no form", () => {
  const group = saleGroup(surfaces.get("direct-case-sale-full"));
  const text = texts(group);
  assert.match(text, /Условия продажи Услуга\/пакет Поступление в Китай «под ключ» Дата продажи 28\.08\.2026 Сумма 1 500,00 USD Заметка об оплате Вторая часть — после оффера\./u);
  assert.match(text, /Пожелания Страны Китай Направления Экономика, IT Уровень образования Бакалавриат Год поступления 2027 Сезон поступления Осень Интересующие университеты Шанхайский университет/u);
  assert.match(text, /Образование Текущее образование 11 класс Класс \/ курс 4,6 Уровень английского IELTS 6\.0 Условия Бюджет 8 000,00 USD в год Стипендия Нужна частичная/u);
  // Пустые ключи (оценки, сертификаты, оплачено, примечание условий) не рисуются.
  assert.doesNotMatch(text, /Оценки|Сертификаты|Оплачено|Ограничения и пожелания/u);
  assert.equal((group.match(/<h3/gu) ?? []).length, 4);
  assert.doesNotMatch(group, /<(?:input|select|textarea|button|form)\b/u);
  assert.doesNotMatch(group, /\byear\b|\bprogram\b|service_cost|conditions_budget|wishes_|revision/u);
  assert.match(text, /^Данные продажи 1 500,00 USD · 28\.08\.2026 /u);
});

test("direct case without a finance section: the group holds the signing day only, no money", () => {
  const html = surfaces.get("direct-case-closed-fields");
  const group = saleGroup(html);
  assert.match(texts(group), /^Данные продажи 01\.09\.2026 Дата продажи 01\.09\.2026$/u);
  assert.doesNotMatch(texts(group), /USD|Сумма|Оплачено/u);
  // Права на анкету нет и в снимке нет направления: ни «Контактов», ни выдуманного направления.
  const text = texts(html);
  assert.match(text, /Направление Не выбрано /u);
  assert.doesNotMatch(text, /Контакты/u);
  assert.doesNotMatch(html, /href="(?:tel|mailto):/u);
});

test("direct case whose conditions could not be read: the group says so, the page works", () => {
  const html = surfaces.get("direct-case-sale-unavailable");
  const group = saleGroup(html);
  assert.match(texts(group), /^Данные продажи не прочитаны Не удалось прочитать данные продажи\. Обновите страницу, чтобы повторить\.$/u);
  assert.match(group, /<p role="alert"[^>]*data-testid="v3-case-sale-unavailable"/u);
  assert.match(texts(html), /Сведения Направление Малайзия/u);
});

test("direct case without a direction in the snapshot and without stored conditions: «Не выбрано», no group, no fallback", () => {
  const html = surfaces.get("direct-case-no-row");
  const text = texts(html);
  // В строке очереди Китай, страна цели дела Китай (CN) - ни то, ни другое направлением не называется.
  assert.match(text, /Направление Не выбрано /u);
  assert.doesNotMatch(text, /Направление Китай/u);
  // Телефон подтверждён - без подписи; у почты своя.
  assert.match(text, /Контакты \+996 000 000 002 student-2@example\.invalid источники расходятся Документы/u);
  assert.equal((text.match(/источники расходятся/gu) ?? []).length, 1);
  assert.doesNotMatch(text, /не подтверждено/u);
  assert.doesNotMatch(html, /\bconflict\b|\bconfirmed\b/u);
  assert.equal(saleGroup(html), "");
  assert.doesNotMatch(html, /id="sale-conditions"/u);
});

test("direct case with free-text анкета fields: a value that is not one number or one address is plain text, not a link", () => {
  const html = surfaces.get("direct-case-free-text");
  const text = texts(html);
  assert.match(text, /Контакты \+996 000 000 005, \+996 000 000 006 см\. анкету не подтверждено Документы/u);
  assert.doesNotMatch(html, /href="(?:tel|mailto):/u);
  assert.equal((text.match(/не подтверждено/gu) ?? []).length, 1);
  // Длинное значение без пробелов переносится, а не обрезается по краю экрана (телефон 393 px).
  assert.match(html, /<span class="flex min-h-11 w-fit max-w-full items-center gap-1\.5 break-all tabular-nums text-fg">/u);
  // Два номера через пробел и адрес с темой письма - тоже не ссылки.
  const two = surfaces.get("direct-case-two-numbers");
  assert.match(texts(two), /Контакты 0000 000 005 0000 000 006 a@example\.invalid\?subject=x не подтверждено/u);
  assert.doesNotMatch(two, /href="(?:tel|mailto):/u);
});

test("a lead's client contact wins over the анкета field and has no note; the sales case keeps its contacts line", () => {
  const admin = texts(surfaces.get("admin"));
  assert.match(admin, /Контакты \+996 000 000 001 student@example\.invalid Приём дела/u);
  assert.doesNotMatch(admin, /не подтверждено|источники расходятся/u);
});

test("caseContacts: own client value first, then the field with its state word; blank or unread is nothing", () => {
  const fields = (list) => ({ fields: list.map(([key, value, state]) => ({ key, value, state })) });
  const both = fields([["mobile_phone", " +996 000 000 003 ", "needs_review"], ["student_email", "a@example.invalid", "confirmed"]]);
  assert.deepEqual(caseContacts({ phone: null, email: null }, both), {
    phone: { value: "+996 000 000 003", note: "не подтверждено" },
    email: { value: "a@example.invalid", note: null },
  });
  // Клиент лида главнее поля и состояния не имеет; пустое поле ничего не даёт.
  assert.deepEqual(caseContacts({ phone: "+996 000 000 001", email: "  " }, fields([["mobile_phone", "x", "extracted"], ["student_email", " ", "needs_review"]])), {
    phone: { value: "+996 000 000 001", note: null },
    email: null,
  });
  assert.deepEqual(caseContacts({ phone: null, email: null }, fields([["student_email", "b@example.invalid", "conflict"], ["father_mobile_phone", "+996 000 000 004", "needs_review"]])), {
    phone: null,
    email: { value: "b@example.invalid", note: "источники расходятся" },
  });
  // Анкета не прочитана (нет права) - контактов нет, а не пустые поля.
  assert.deepEqual(caseContacts({ phone: null, email: null }, null), { phone: null, email: null });
});

test("the direction is the snapshot's only: no queue-row or target-country fallback remains in the case parts", () => {
  const parts = read("src/components/v3/profile/CaseWorkParts.tsx");
  assert.match(parts, /const direction = admissions\.direction \? DIRECTION_LABELS\[admissions\.direction\] : null;/u);
  assert.doesNotMatch(parts, /caseDirectionLabel|work\.row\?\.admissionsDirection|targetCountry/u);
  const view = read("src/components/v3/profile/case-work-view.ts");
  assert.doesNotMatch(view, /caseDirectionLabel|targetCountry/u);
  assert.doesNotMatch(read("src/components/v3/profile/types.ts"), /targetCountry/u);
  // Словарь стран знает только свои ключи: имена из прототипа объекта - не слова.
  for (const inherited of ["constructor", "__proto__", "toString", "valueOf"]) assert.equal(country(inherited), null, inherited);
});

test("the case-only branch of readCaseProfile keeps the client e-mail/phone null (portal access needs a confirmed e-mail) and reads the sale conditions apart", () => {
  const source = read("src/lib/v3/profile-source.ts");
  const branch = source.slice(source.indexOf("async function readCaseProfile("), source.indexOf("async function readLeadProfile("));
  assert.match(branch, /person: data\.studentCase\.studentDisplayName,[\s\S]*?email: null,\n {4}phone: null,\n {4}student: true,/u);
  assert.match(source, /direction: data\.studentCase\.admissionsDirection \?\? null,\n {4}applications: data\.applications,/u);
  // Контакты собираются чистой функцией из уже прочитанного, без нового чтения.
  const parts = read("src/components/v3/profile/CaseWorkParts.tsx");
  assert.match(parts, /contacts=\{caseContacts\(\{ phone: profile\.phone, email: profile\.email \}, draft\.profileFields\)\}/u);
  assert.match(parts, /email=\{profile\.email\}/u, "portal access still takes the client e-mail only");
  // Условия продажи (290): одно чтение дела параллельно с делом, не бросает, без запасного пути; блок лида остаётся null.
  assert.match(branch, /const saleRead = readCaseSaleData\(actor, canonicalCaseId\);\n {2}const data = await loadFullCase\(actor, view\.studentCase\);/u);
  assert.match(branch, /\.\.\.\(await saleRead\),/u);
  assert.match(source, /saleConditions: conditions && caseSaleBlocks\(conditions\)\.length > 0 \? conditions : null/u);
  assert.match(source, /return \{ saleConditions: null, saleConditionsUnavailable: true \};/u);
  assert.match(source, /\n {4}saleConditions: null,\n {4}\/\/ Same scoping as saleConditions above/u);
  const read290 = read("src/lib/v3/lead-sale-conditions-source.ts");
  assert.match(read290, /rpc\("staff_student_case_sale_conditions_v1", \{\n {4}p_organization_id: actor\.organizationId, p_student_case_id: studentCaseId,\n {2}\}\);\n {2}return parseCaseSaleConditionsResult\(\{ data, error \}, actor\.organizationId\);/u);
});

test("parseCaseSaleConditionsResult: the function's own refusal and NULL are «no conditions»; every other failure is a failure", () => {
  const ORG = "00000000-0000-4000-8000-0000000000a1";
  const answer = {
    organization_id: ORG, lead_id: "00000000-0000-4000-8000-0000000000b1", revision: "1", service_label: "", signing_date: "2026-09-01",
    service_cost_raw: "", service_cost_minor: 150000, service_cost_currency: "USD", paid_raw: "", paid_minor: null, paid_currency: null,
    payment_note: "", wishes_countries: "", wishes_study_fields: "", wishes_education_level: "", wishes_intake_year: null,
    wishes_intake_season: "", wishes_universities: "", education_current: "", education_grade: "", education_marks: "",
    education_english: "", education_certificates: "", conditions_budget_raw: "", conditions_budget_minor: null,
    conditions_budget_currency: null, conditions_budget_period: "", conditions_scholarship: "", conditions_note: "",
    updated_by_membership_id: null, updated_at: null, linked_sales_register: null,
  };
  const ok = parseCaseSaleConditionsResult({ data: answer, error: null }, ORG);
  assert.equal(ok.serviceCostMinor, 150000);
  assert.equal(ok.serviceCostCurrency, "USD");
  assert.equal(ok.signingDate, "2026-09-01");
  assert.equal(ok.revision, 1);
  assert.equal(ok.linkedSalesRegister, null);
  // Не дело прямого студента: функция ответила NULL.
  assert.equal(parseCaseSaleConditionsResult({ data: null, error: null }, ORG), null);
  // Отказ самой функции (нет права на дело целиком, читатель «Ждут куратора»): условий нет, не сбой.
  assert.equal(parseCaseSaleConditionsResult({ data: null, error: { code: "42501", message: "case_sale_conditions_forbidden" } }, ORG), null);
  // «Нет права на функцию» (миграция не применена, EXECUTE отозван) - тот же код 42501, но это сбой, не молчание.
  for (const error of [
    { code: "42501", message: "permission denied for function staff_student_case_sale_conditions_v1" },
    { code: "42883", message: "function platform.staff_student_case_sale_conditions_v1(uuid, uuid) does not exist" },
    { code: "PGRST202", message: "Could not find the function" },
    { code: "42501" },
    { message: "case_sale_conditions_forbidden" },
  ]) assert.throws(() => parseCaseSaleConditionsResult({ data: null, error }, ORG), /Sale conditions are unavailable/u, JSON.stringify(error));
  // Неверная форма и чужая организация - сбой, а не показ.
  assert.throws(() => parseCaseSaleConditionsResult({ data: { ...answer, extra: 1 }, error: null }, ORG), /unavailable/u);
  assert.throws(() => parseCaseSaleConditionsResult({ data: answer, error: null }, "00000000-0000-4000-8000-0000000000ff"), /unavailable/u);
});

test("caseSaleBlocks: only what is filled, the lead card's words, money as the money tab writes it, nothing raw", () => {
  const blank = {
    leadId: "l", organizationId: "o", revision: 1, serviceLabel: "", signingDate: null, serviceCostRaw: "", serviceCostMinor: null,
    serviceCostCurrency: null, paidRaw: "", paidMinor: null, paidCurrency: null, paymentNote: "", wishesCountries: "", wishesStudyFields: "",
    wishesEducationLevel: "", wishesIntakeYear: "", wishesIntakeSeason: "", wishesUniversities: "", educationCurrent: "", educationGrade: "",
    educationMarks: "", educationEnglish: "", educationCertificates: "", conditionsBudgetRaw: "", conditionsBudgetMinor: null,
    conditionsBudgetCurrency: null, conditionsBudgetPeriod: null, conditionsScholarship: "", conditionsNote: "", updatedByMembershipId: null,
    updatedAt: null, linkedSalesRegister: null,
  };
  assert.deepEqual(caseSaleBlocks(blank), []);
  assert.deepEqual(caseSaleBlocks({ ...blank, serviceLabel: "   ", paymentNote: "\n", wishesCountries: " " }), [], "blank and whitespace are nothing");
  const sale = caseSaleBlocks({ ...blank, serviceCostMinor: 150050, serviceCostCurrency: "USD", signingDate: "2026-09-01" });
  // Разделитель тысяч - из Intl (в ru-RU это узкий неразрывный пробел), как у вкладки «Договор и оплата».
  const thousand = (n) => new Intl.NumberFormat("ru-RU").format(n);
  assert.deepEqual(sale, [{ key: "sale", title: "Условия продажи", rows: [
    { key: "signing_date", label: "Дата продажи", value: "01.09.2026", day: "2026-09-01" },
    { key: "service_cost", label: "Сумма", value: `${thousand(1500)},50 USD` },
  ] }]);
  assert.equal(caseSaleSummary(sale), `${thousand(1500)},50 USD · 01.09.2026`);
  // Сумма текстом (как её набрал продавец) показывается, если числа нет; число главнее текста.
  assert.equal(caseSaleBlocks({ ...blank, serviceCostRaw: " 1500 у.е. " })[0].rows[0].value, "1500 у.е.");
  assert.equal(caseSaleBlocks({ ...blank, serviceCostRaw: "5", serviceCostMinor: 100, serviceCostCurrency: "KGS" })[0].rows[0].value, "1,00 KGS");
  // Бюджет с периодом словом; период без суммы ничего не пишет.
  assert.equal(caseSaleBlocks({ ...blank, conditionsBudgetMinor: 800000, conditionsBudgetCurrency: "EUR", conditionsBudgetPeriod: "program" })[0].rows[0].value, `${thousand(8000)},00 EUR за программу`);
  assert.deepEqual(caseSaleBlocks({ ...blank, conditionsBudgetPeriod: "year" }), []);
  // Блок без значений не рисуется, подпись блока - слова карточки лида; без денег - название строкой.
  const wishes = caseSaleBlocks({ ...blank, wishesIntakeYear: "2027", educationEnglish: "IELTS 6.0" });
  assert.deepEqual(wishes.map((block) => block.title), ["Пожелания", "Образование"]);
  assert.equal(caseSaleSummary(wishes), "пожелания, образование");
  assert.equal(caseSaleSummary(caseSaleBlocks({ ...blank, signingDate: "2026-09-01" })), "01.09.2026");
});

// Дело «Ждёт куратора» у Admin (17.10.2026): снимок разделов обещает документы, рабочего места документов у
// `pending` в базе нет (113: только `active` и `closed`) — страница не должна падать «Не удалось открыть экран».
test("a «Ждёт куратора» case: the section access drops documents only, only for pending, and never grants anything", () => {
  const all = { documents: true, finance: true, studentProfile: true, contract: true };
  assert.deepEqual(caseSectionAccessForState(all, "pending"), { documents: false, finance: true, studentProfile: true, contract: true });
  // active и closed: снимок остаётся как ответила база, чтение документов не отменяется.
  assert.equal(caseSectionAccessForState(all, "active"), all);
  assert.equal(caseSectionAccessForState(all, "closed"), all);
  // Сужение, не право: нет документов в снимке — нет и после; остальное не включается.
  const none = { documents: false, finance: false, studentProfile: false, contract: false };
  for (const state of ["pending", "active", "closed"]) assert.deepEqual(caseSectionAccessForState(none, state), none, state);
  const financeOnly = { documents: false, finance: true, studentProfile: false, contract: false };
  assert.deepEqual(caseSectionAccessForState(financeOnly, "pending"), financeOnly);
  // Исходный снимок не меняется.
  assert.equal(all.documents, true);
});

test("an Admin opening a «Ждёт куратора» case sees why documents are absent, not «нет доступа», and no Documents tab", () => {
  const html = surfaces.get("pending-admin");
  assert.ok(html, "the pending Admin scenario renders");
  const text = texts(html);
  assert.equal(caseDocumentsWords.awaitCurator, "появятся, когда у дела будет куратор");
  assert.match(text, /Документы появятся, когда у дела будет куратор Заявки/u);
  assert.doesNotMatch(text, /Документы нет доступа/u);
  // Вкладки «Документы» и ссылки «Документы дела» нет; «Анкета» Admin читает как прежде.
  assert.doesNotMatch(html, /tab=documents/u);
  assert.doesNotMatch(text, /Документы дела/u);
  assert.match(html, /tab=anketa/u);
  // Назначить куратора можно: форма шапки та же.
  assert.match(text, /Назначить куратора/u);
  assert.match(text, /Куратор нужен куратор/u);
});

test("the reader of «Ждут куратора» without the case right sees the same reason instead of «нет доступа»", () => {
  const text = texts(surfaces.get("assign-only"));
  assert.match(text, /Документы появятся, когда у дела будет куратор Заявки/u);
  assert.doesNotMatch(text, /Документы нет доступа/u);
  // Прочие закрытые права названы как прежде.
  assert.match(text, /Переписка нет доступа/u);
});

test("a case in work keeps its documents line and the Documents tab (the reason line is only for pending)", () => {
  const admin = surfaces.get("admin");
  const text = texts(admin);
  assert.doesNotMatch(text, /появятся, когда у дела будет куратор/u);
  assert.match(admin, /tab=documents/u);
  for (const name of ["curator", "closed", "closed-outcome", "admin"]) {
    assert.doesNotMatch(texts(surfaces.get(name)), /появятся, когда у дела будет куратор/u, name);
  }
});

test("loadFullCase narrows the snapshot by case state and passes pending to the overview; a documents read failure is never caught", () => {
  const source = read("src/lib/v3/profile-source.ts");
  assert.match(source, /const access = caseSectionAccessForState\(snapshotAccess, studentCase\.state\);/u);
  assert.match(source, /readCaseProfileSections\(access, \{[\s\S]*?documents: \(\) => getPlatformCaseDocumentWorkspace\(actor, studentCaseId\),/u);
  // Ни try/catch, ни `.catch` вокруг чтения рабочего места документов: отказ active/closed остаётся ошибкой.
  assert.doesNotMatch(source, /getPlatformCaseDocumentWorkspace\([^)]*\)[^\n]*\.catch|catch[^\n]*getPlatformCaseDocumentWorkspace/u);
  const parts = read("src/components/v3/profile/CaseWorkParts.tsx");
  // Правило состояния не переписывается по месту: страница дела спрашивает ту же функцию, что и остальные экраны.
  assert.match(parts, /documentsAwaitCurator=\{caseDocumentsAwaitCurator\(admissions\.caseState\)\}/u);
  assert.doesNotMatch(parts, /caseState === "pending"/u);
});

// «Ждёт куратора» (17.10.2026), второй срез: правило «документов у дела без куратора нет» записано один раз и по нему
// живут все экраны дела — страница, «Быстрый просмотр» очереди «Студенты» и досье «Клиентской базы».
test("the case-state rule for documents is one function that every screen asks", () => {
  assert.equal(caseDocumentsAwaitCurator("pending"), true);
  assert.equal(caseDocumentsAwaitCurator("active"), false);
  assert.equal(caseDocumentsAwaitCurator("closed"), false);
  // Доступ к разделам сужается ровно этим правилом: документы пропадают тогда и только тогда, когда правило истинно.
  const all = { documents: true, finance: true, studentProfile: true, contract: true };
  for (const state of ["pending", "active", "closed"]) {
    assert.equal(caseSectionAccessForState(all, state).documents, !caseDocumentsAwaitCurator(state), state);
  }
  const consumers = [
    "src/components/v3/profile/CaseWorkParts.tsx",
    "src/components/v3/students/StudentQuickView.tsx",
    "src/components/v3/knowledge/KnowledgeDossiers.tsx",
    "src/lib/server/knowledge-library/dossiers.ts",
  ];
  for (const file of consumers) {
    const source = read(file);
    assert.match(source, /import \{ caseDocumentsAwaitCurator \} from "@\/lib\/v3\/case-access-contract";/u, file);
    assert.match(source, /caseDocumentsAwaitCurator\(/u, file);
  }
  // Второй записи правила нет: ни «не active/closed», ни собственного сравнения с `pending` рядом с документами.
  const dossier = read("src/components/v3/knowledge/KnowledgeDossiers.tsx");
  assert.doesNotMatch(dossier, /\["active", "closed"\]\.includes\(/u);
  assert.doesNotMatch(dossier, /!record\.handoffAt/u);
  // Одна строка слов: досье не держит своих «после передачи дела».
  assert.doesNotMatch(dossier, /после передачи дела/u);
  assert.match(dossier, /Документы \{caseDocumentsWords\.awaitCurator\}\./u);
});

test("the coordinator does not read documents of a pending case, and a refused documents read of an active or closed case still fails", async () => {
  const ORG = "10000000-0000-4000-8000-000000000001";
  const CASE_ID = "20000000-0000-4000-8000-000000000001";
  const actor = { systemRole: "admin", presentationRole: null, organizationId: ORG, permissionKeys: ["documents.read"], assignments: [], platformAccessVersion: 1 };
  // База отвечает рабочему месту документов 42501 (113) — как у дела не `active`/`closed`.
  const rpcCalls = [];
  const refusing = { schema: () => ({ rpc: async (name) => { rpcCalls.push(name); return { data: null, error: { code: "42501", message: `${name} refused` } }; } }) };
  const snapshot = { documents: true, finance: false, studentProfile: false, contract: false };
  const never = async () => assert.fail("a section that is not promised must not be read");
  let reads = 0;
  const documents = () => { reads += 1; return getPlatformCaseDocumentWorkspace(actor, CASE_ID, { client: refusing }); };

  const pending = await readCaseProfileSections(caseSectionAccessForState(snapshot, "pending"),
    { finance: never, studentProfile: never, contract: never, documents });
  assert.equal(pending.documents, null);
  assert.equal(pending.access.documents, false);
  assert.equal(reads, 0, "the workspace read is not attempted for a pending case");
  assert.deepEqual(rpcCalls, [], "and nothing is sent to the database");

  for (const state of ["active", "closed"]) {
    await assert.rejects(
      readCaseProfileSections(caseSectionAccessForState(snapshot, state), { finance: never, studentProfile: never, contract: never, documents }),
      PlatformPrivateDocumentsRepositoryError, `${state}: the refusal is an error, not an empty section`);
  }
  assert.equal(reads, 2, "active and closed still attempt the read");
  assert.deepEqual(rpcCalls, ["staff_student_case_document_workspace", "staff_student_case_document_workspace"], "and the refusal comes from the database, not from a local guard");
});

test("the TypeScript rule mirrors the SQL it narrows: the workspace is defined for active/closed only, the snapshot never looks at state", () => {
  const workspace = read("supabase/migrations/113_platform_document_case_links.sql");
  const body = workspace.slice(workspace.indexOf("CREATE OR REPLACE FUNCTION platform.staff_student_case_document_workspace("));
  const lookup = body.slice(0, body.indexOf("IF NOT FOUND THEN"));
  assert.match(lookup, /AND student_case\.state IN \('active', 'closed'\)\s+AND student_case\.handoff_at IS NOT NULL/u);
  assert.match(lookup, /student_case\.id = p_student_case_id/u);
  const scoped = read("supabase/migrations/156_platform_scoped_staff_consumers.sql");
  const snapshotAt = scoped.indexOf("CREATE FUNCTION platform.staff_case_access_snapshot(");
  const snapshot = scoped.slice(snapshotAt, scoped.indexOf("REVOKE ALL ON FUNCTION platform.staff_case_access_snapshot", snapshotAt));
  assert.match(snapshot, /'documents', platform_private\.staff_can_access\(p_organization_id, a\.membership_id, 'document\.read\.full', 'student_case', p_student_case_id\)/u);
  assert.doesNotMatch(snapshot, /\bstate\b/u, "the snapshot checks permissions, not the case state: that is why the page narrows it");
});

// Досье «Клиентской базы» (`readKnowledgeDossier`, раздел `documents`), 17.10.2026: у дела «Ждёт куратора» (`pending`)
// рабочего места документов нет (113 отвечает 42501 всем), и досье его не запрашивает, а у дела в работе (`active`,
// `closed`) запрос прежний и отказ остаётся ошибкой. Настоящий `dossiers.ts` и настоящее правило состояния
// (`case-access-contract.ts`) собираются esbuild; подменены только чтения базы (дело, рабочее место документов, переписка,
// история) и права Admin. Это проверка ветвления сервера, а не базы: ответ базы на `pending` доказан на локальном стеке.
const DOSSIER_STUBS = {
  "server-only": "",
  "@/lib/platform-admissions": `
    export async function getPlatformStudentCaseView(_actor, id) { const s = globalThis.__dossier; s.views.push(id); return s.view; }
    export async function listPlatformStudentCases() { return { rows: [], hasNext: false, nextCursor: null }; }
  `,
  "@/lib/platform-private-documents": `
    export async function getPlatformCaseDocumentWorkspace(_actor, id) {
      const s = globalThis.__dossier; s.workspaceCalls.push(id);
      if (s.workspaceRefuses) throw new Error("Platform private-document data is unavailable.");
      return { studentCaseId: id, slots: [] };
    }
  `,
  "@/lib/v3/case-chat-source": `export async function readCaseChatPage() { return { messages: [] }; }`,
  "@/lib/v3/profile-activity-source": `export async function readProfileActivity() { return { events: [] }; } export function parseProfileActivityCursor() { return null; }`,
  "@/lib/knowledge-library-contract": `export const KNOWLEDGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`,
  "@/lib/v3/knowledge-library-source": `
    export class KnowledgeError extends Error { constructor(code, status = 503) { super(code); this.code = code; this.status = status; } }
    export function requireKnowledgeAdmin() {}
  `,
};

const dossierBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/server/knowledge-library/dossiers.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{
    name: "dossier-stubs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => (Object.hasOwn(DOSSIER_STUBS, args.path) ? { path: args.path, namespace: "dossier-stub" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "dossier-stub" }, (args) => ({ contents: DOSSIER_STUBS[args.path], loader: "js" }));
    },
  }],
});
const { readKnowledgeDossier } = await import(`data:text/javascript;base64,${Buffer.from(dossierBundle.outputFiles[0].text).toString("base64")}`);

const DOSSIER_CASE = "30000000-0000-4000-8000-000000000001";
const DOSSIER_URL = new URL("https://crm.example.test/api/v3/knowledge/clients");
const dossierActor = { systemRole: "admin" };
function dossierSetup(state, { workspaceRefuses = false } = {}) {
  globalThis.__dossier = { views: [], workspaceCalls: [], workspaceRefuses, view: { access: "full", studentCase: { studentCaseId: DOSSIER_CASE, state } } };
  return globalThis.__dossier;
}

test("a «Ждёт куратора» dossier does not ask for the document workspace and answers none", async () => {
  const stub = dossierSetup("pending");
  assert.equal(await readKnowledgeDossier(dossierActor, DOSSIER_CASE, "documents", DOSSIER_URL), null);
  assert.deepEqual(stub.workspaceCalls, [], "the workspace read is not attempted");
  assert.deepEqual(stub.views, [DOSSIER_CASE], "the case itself is still read, and its access checked, first");
  // Даже если база отказала бы: до неё дело не доходит.
  const refusing = dossierSetup("pending", { workspaceRefuses: true });
  assert.equal(await readKnowledgeDossier(dossierActor, DOSSIER_CASE, "documents", DOSSIER_URL), null);
  assert.deepEqual(refusing.workspaceCalls, []);
});

test("a dossier of a case in work still reads the document workspace, and a refusal there stays an error", async () => {
  for (const state of ["active", "closed"]) {
    const stub = dossierSetup(state);
    const workspace = await readKnowledgeDossier(dossierActor, DOSSIER_CASE, "documents", DOSSIER_URL);
    assert.equal(workspace.studentCaseId, DOSSIER_CASE, state);
    assert.deepEqual(stub.workspaceCalls, [DOSSIER_CASE], state);
    const refusing = dossierSetup(state, { workspaceRefuses: true });
    await assert.rejects(readKnowledgeDossier(dossierActor, DOSSIER_CASE, "documents", DOSSIER_URL), /private-document data is unavailable/u, `${state}: not swallowed`);
    assert.deepEqual(refusing.workspaceCalls, [DOSSIER_CASE], state);
  }
});

test("the rule narrows only the documents section: the case record of a pending case is read as before", async () => {
  const stub = dossierSetup("pending");
  assert.deepEqual(await readKnowledgeDossier(dossierActor, DOSSIER_CASE, undefined, DOSSIER_URL), { studentCaseId: DOSSIER_CASE, state: "pending" });
  assert.deepEqual(await readKnowledgeDossier(dossierActor, DOSSIER_CASE, "chat", DOSSIER_URL), { messages: [] });
  assert.deepEqual(stub.workspaceCalls, []);
  // Неизвестный раздел, как и раньше, - «не найдено».
  await assert.rejects(readKnowledgeDossier(dossierActor, DOSSIER_CASE, "payments", DOSSIER_URL), (error) => error.code === "knowledge_not_found" && error.status === 404);
  // Дело без полного доступа не раскрывается и состоянием.
  globalThis.__dossier.view = { access: "summary", studentCase: { state: "pending" } };
  await assert.rejects(readKnowledgeDossier(dossierActor, DOSSIER_CASE, "documents", DOSSIER_URL), (error) => error.code === "knowledge_not_found");
});

// «Ждёт куратора» (17.10.2026), хвосты ссылок (MINOR 2 ревью #1228): вкладки «Документы» у дела `pending` нет, и ссылки на неё
// не рисуются ни в подготовке по программе, ни во вложении переписки досье, ни во вложении «Переписки». Правило одно:
// `caseDocumentsAwaitCurator`, своего сравнения с `pending` ни у кого из них нет. `active` и `closed` — как прежде.
test("the preparation panel, the dossier chat attachment and the Messages thread draw no link to the missing Documents tab of a «Ждёт куратора» case", () => {
  // Подготовка по программе: признак приходит от панели вузов дела, которая знает состояние, и считается той же функцией.
  const workspace = read("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");
  assert.match(workspace, /import \{ caseDocumentsAwaitCurator \} from "@\/lib\/v3\/case-access-contract";/u);
  assert.match(workspace, /documentsAwaitCurator=\{caseDocumentsAwaitCurator\(workspace\.caseState\)\}/u);
  const panel = read("src/components/v3/profile/StaffPreparationPanel.tsx");
  assert.match(panel, /import \{ caseDocumentsWords \} from "@\/lib\/v3\/wording";/u);
  assert.match(panel, /canReview = false, documentsAwaitCurator = false \}/u, "other callers keep the link");
  assert.match(panel, /\{documentsAwaitCurator\s*\? <p [^>]*data-testid="staff-preparation-documents-await">Документы \{caseDocumentsWords\.awaitCurator\}\.<\/p>\s*: <a href=\{docsHref\} className=\{btnGhostCls\}>Все документы дела<\/a>\}/u);
  // У панели нет ни состояния дела, ни своей записи правила.
  assert.doesNotMatch(panel, /caseState|state === "pending"|"pending"/u);

  // Досье «Клиентской базы»: вложение-документ — метка и строка, ссылка только у дела с рабочим местом документов.
  const dossier = read("src/components/v3/knowledge/KnowledgeDossiers.tsx");
  assert.match(dossier, /const documentsAwait = record !== null && caseDocumentsAwaitCurator\(record\.state\);/u);
  assert.match(dossier, /message\.attachmentKind === "document" && documentsAwait\s*\? <p [^>]*data-testid="knowledge-chat-attachment-await">[\s\S]*?Документы \{caseDocumentsWords\.awaitCurator\}\.<\/span><\/p>\s*: <Link href=\{`\/v3\/profile\?case=\$\{caseId\}&tab=\$\{message\.attachmentKind === "document" \? "documents" : "overview"\}`\}/u);
  assert.doesNotMatch(dossier, /state === "pending"|"pending"/u);

  // «Переписка» (кабинет студента): страница считает признак тем же правилом по состоянию дела, карточка вложения получает его пропсом.
  const page = read("src/app/(v3)/v3/messages/page.tsx");
  assert.match(page, /import \{ caseDocumentsAwaitCurator \} from "@\/lib\/v3\/case-access-contract";/u);
  assert.match(page, /documentsAwaitCurator=\{caseDocumentsAwaitCurator\(caseState\)\}/u);
  const thread = read("src/components/v3/case-chat/CaseChatThread.tsx");
  assert.match(thread, /caseFacts = null, snippets = null, documentsAwaitCurator = false,/u, "the other screens that render the workspace keep the link");
  const cardStart = thread.indexOf("function AttachmentCard(");
  const cardEnd = thread.indexOf("function MessageRow(");
  assert.ok(cardStart !== -1 && cardEnd > cardStart, "AttachmentCard is found");
  const card = thread.slice(cardStart, cardEnd);
  const branchAt = card.indexOf('if (message.attachmentKind === "document" && documentsAwaitCurator) {');
  const hrefAt = card.indexOf("const href =");
  assert.ok(branchAt !== -1 && hrefAt > branchAt, "the «ждёт куратора» branch comes before the link is built");
  const branch = card.slice(branchAt, hrefAt);
  assert.match(branch, /data-testid="case-chat-attachment-await"/u);
  assert.match(branch, /Документы \{caseDocumentsWords\.awaitCurator\}\./u);
  assert.doesNotMatch(branch, /<Link|href=/u, "no link in the branch for a case without a curator");
  // Для `active` и `closed` прежняя ссылка на вкладку «Документы» и на задачу остаётся.
  assert.match(card.slice(hrefAt), /`\/v3\/profile\?case=\$\{caseId\}&tab=documents`\s*: `\/v3\/tasks\?task=\$\{message\.attachmentId\}&kind=case&case=\$\{caseId\}`/u);
  assert.doesNotMatch(thread, /state === "pending"|"pending"/u);
});

// Axe `select-name` (17.10.2026): у выбора валюты бюджета в форме «Условия» карточки лида не было подписи.
test("every select of the lead-card forms has an accessible name, and the budget currency one a visible «Валюта» label", () => {
  for (const file of ["src/components/v3/profile/LeadCardFieldsForm.tsx", "src/components/v3/profile/LeadSaleConditions.tsx"]) {
    const source = read(file);
    const selects = [...source.matchAll(/<select\b/gu)];
    assert.ok(selects.length > 0, file);
    for (const select of selects) {
      const before = source.slice(0, select.index);
      const insideLabel = before.lastIndexOf("<label") > before.lastIndexOf("</label>");
      const named = /aria-label(?:ledby)?=/u.test(source.slice(select.index, source.indexOf("</select>", select.index)));
      assert.ok(insideLabel || named, `${file}: a select at offset ${select.index} has neither a wrapping label nor aria-label`);
    }
  }
  const card = read("src/components/v3/profile/LeadCardFieldsForm.tsx");
  // Подпись — видимое слово, как у соседнего «Период» и у валют сделки; сырых ключей нет.
  assert.match(card, /<label>\s*<span className=\{fieldLabelCls\}>Валюта<\/span>\s*<select\s+value=\{budgetCurrency\}/u);
  assert.match(card, /<option value="">Не указана<\/option>\s*\{SALE_CONDITION_CURRENCIES\.map/u);
});

test("Student 360 «Данные продажи» keeps the lead's linked WhatsApp conversation, gated by messaging.read", () => {
  const tabs = read("src/components/v3/profile/tabs.tsx");
  assert.match(tabs, /staffPresentationCan\(actor, "messaging\.read"\)/u);
  assert.match(tabs, /data-testid="v3-sales-groups">\s*<LinkedConversationLinks sales=\{sales\} actor=\{actor\}/u);
  assert.match(tabs, /<LinkedConversationLinks sales=\{sales\} actor=\{actor\} className="flex flex-col gap-1 border-t/u);
});
