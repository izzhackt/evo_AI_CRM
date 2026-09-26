import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  caseApplicationLines,
  caseChatWork,
  caseChecklistCounts,
  caseMomentLabel,
  caseOpenTasks,
  casePortalStatus,
} from "../src/components/v3/profile/case-work-view.ts";
import { studentsDocumentsLine } from "../src/components/v3/students/students-queue-view.ts";

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

test("the case view: facts under the name, «Что дальше» first, one solid red only while the case awaits acceptance", () => {
  const html = surfaces.get("curator-accept");
  const shown = visible(html);
  const text = texts(html);
  // Строка фактов: направление · этап словами «Воронки» · куратор · шаг со сроком и «Изменить».
  assert.match(text, /Направление Китай Этап Документы Куратор Айгүл Осмонова ждёт принятия Следующий шаг Собрать апостиль на аттестат 20\.09 прошёл Изменить/u);
  assert.match(html, /<button id="queue-trigger-[^"]+" type="button" popovertarget="queue-popover-[^"]+"[^>]*aria-haspopup="dialog"[^>]*>Изменить<\/button>/iu);
  assert.match(html, /popover="auto"[^>]*role="dialog"[^>]*><h2[^>]*>Следующий шаг<\/h2>[\s\S]*?data-testid="v3-next-step-editor"/u);
  // «Обзор» по порядку: Что дальше → Документы → Переписка → Заявки → Заметки.
  let cursor = 0;
  for (const title of ["Что дальше", "Документы Документы дела", "Переписка", "Заявки", "Заметки"]) {
    const position = text.indexOf(`${title} `, cursor);
    assert.ok(position > cursor, `${title} after ${cursor}`);
    cursor = position;
  }
  // «Принять дело» — первым в «Что дальше» и единственная сплошная красная кнопка.
  // «Все задачи дела» из «Быстрого просмотра» ведёт на `#case-tasks`.
  assert.match(html, /<section id="case-tasks" aria-labelledby="case-next-title"/u);
  assert.match(html, /data-testid="v3-case-next"[\s\S]*?data-testid="v3-case-handoff"[\s\S]*?>Принять дело<\/button>[\s\S]*?data-testid="v3-case-tasks"/u);
  assert.equal((shown.match(/bg-accent (?:px|text)/gu) ?? []).length, 1, "one solid red button");
  // Задачи: просроченные первыми, выполнение в строке, без имени студента в каждой строке.
  assert.match(text, /Проверить перевод аттестата у нотариуса.*Позвонить семье.*Отправить мотивационное письмо/u);
  assert.match(html, /aria-label="Завершить с результатом: Проверить перевод аттестата у нотариуса"/u);
  assert.equal((html.match(/data-queue-row=/gu) ?? []).length, 6);
  assert.match(text, /Показать ещё 2/u);
  assert.doesNotMatch(texts(html.slice(html.indexOf('data-testid="v3-case-tasks"'))).split("Показать ещё")[0], /Айдана Сыдыкова/u);
  // Документы, переписка, заявки — строками из прочитанных данных, со ссылками на вкладки.
  assert.match(text, /Документы Документы дела 7 из 12 принято · 2 на проверке · 1 исправить · 2 не загружено/u);
  assert.match(text, /Переписка Нужен ответ Открыть переписку Айдана Сыдыкова · 22\.09 14:14 Здравствуйте!/u);
  assert.match(html, /href="\/v3\/messages\?case=cccccccc-2222-4222-8222-000000000001"/u);
  assert.match(text, /Шанхайский университет · Международная торговля — готовится · основной вариант · дедлайн 30\.11/u);
  // Прежние дубли ушли: ссылка дела на само себя, «Коротко», вторая «Создать задачу по студенту».
  assert.doesNotMatch(text, /Дело уже создано|Коротко|Создать задачу по студенту|Открыть дело/u);
  // Оплата не видна без права на неё; «Добавить заметку» — спокойная кнопка.
  assert.doesNotMatch(text, /Оплата /u);
  assert.match(html, />Добавить заметку<\/button>/u);
  assert.doesNotMatch(html, /bg-accent px-3 text-xs font-semibold text-white[^>]*>Добавить заметку/u);
});

test("after acceptance the answer moves to «Сведения»; nothing on the overview is solid red", () => {
  const html = surfaces.get("curator");
  assert.equal((visible(html).match(/bg-accent (?:px|text)/gu) ?? []).length, 0);
  assert.doesNotMatch(html, /data-testid="v3-case-next"[\s\S]*?data-testid="v3-case-handoff"[\s\S]*?data-testid="v3-case-tasks"/u);
  assert.match(texts(html), /Сведения Приём дела Дело принято куратором Согласованный контакт: 24\.09\.2026 Изменить ответ/u);
});

test("«Приём дела» in «Сведения» keeps the curator's answer for those who cannot respond: decision, reason, agreed contact", () => {
  // Admin не отвечает на назначение: причина отказа куратора — та же, что в прежней карточке «Приём дела».
  const declined = surfaces.get("admin-declined");
  assert.match(texts(declined), /Сведения Приём дела Назначение отклонено куратором Нагрузка выше нормы до конца октября, прошу назначить другого куратора\./u);
  assert.doesNotMatch(texts(declined), /Изменить ответ|Принять дело/u);
  assert.doesNotMatch(declined, /data-testid="v3-case-handoff"/u);
  // Тот же HandoffResponseSummary, что у карточки «Приём дела» на лиде и во вкладке «Вузы и программы».
  const overview = read("src/components/v3/profile/CaseOverview.tsx");
  assert.match(overview, /import \{ HandoffResponseSummary \} from "\.\/ProfileSalesTransition";/u);
  assert.match(overview, /<Fact term="Приём дела">[\s\S]*?<HandoffResponseSummary current=\{handoff\.current \? \{\n\s+decision: handoff\.current\.decision,\n\s+clarification: handoff\.current\.clarification,\n\s+agreedContactDate: handoff\.current\.agreedContactDate,/u);
});

test("Admin: sales forms leave the overview for a collapsed «Данные продажи»; contacts and portal are one line each", () => {
  const html = surfaces.get("admin");
  const shown = visible(html);
  const text = texts(html);
  assert.equal((shown.match(/bg-accent (?:px|text)/gu) ?? []).length, 0);
  assert.match(html, /<details id="sales-data"[^>]*data-testid="v3-case-sales-data"><summary[^>]*>Данные продажи/u);
  for (const block of ["Условия продажи", "Договор и оплата", "Пожелания", "Образование", "Условия"]) {
    assert.doesNotMatch(texts(shown), new RegExp(`(?:^| )${block} .*Сохранить`, "u"), block);
  }
  assert.match(html, /id="sale-conditions"/u, "the sale conditions anchor still exists inside «Данные продажи»");
  // Раскрытые «Данные продажи» не добавляют красных: четыре «Сохранить» — спокойные кнопки.
  const salesData = html.slice(html.indexOf('<details id="sales-data"'));
  assert.equal((salesData.match(/bg-accent (?:px|text)/gu) ?? []).length, 0, "no solid red inside «Данные продажи»");
  assert.equal((salesData.match(/>(?:Сохранить|Сохранить условия)<\/button>/gu) ?? []).length, 4);
  assert.match(read("src/components/v3/profile/CaseWorkParts.tsx"), /<SalesOverview [^>]*requestIds=\{input\.requestIds\} quiet \/>/u);
  assert.match(text, /Оплата Договор и оплата 40% оплачено · остаток 900 \$/u);
  assert.match(text, /Доступ к порталу анкета одобрена Настроить/u);
  assert.match(html, /aria-expanded="false" aria-controls="[^"]+"[^>]*>Настроить<\/button><\/div><div id="[^"]+" hidden=""/u);
  assert.match(text, /Сведения Контакты \+996 000 000 001 student@example\.invalid Приём дела Дело принято куратором Согласованный контакт: 24\.09\.2026 Продажа Эрмек Токтосунов Передано в поступление/u);
  assert.match(text, /Нагрузка кураторов/u);
  assert.match(html, /href="\/v3\/profile\?view=curators&amp;coverage_curator=aaaaaaaa-1111-4111-8111-000000000001&amp;coverage_case=cccccccc-2222-4222-8222-000000000001#curator-coverage"/u);
});

test("unread parts say so: no stage, no step editor, no invented task, chat or document numbers", () => {
  const text = texts(surfaces.get("unread"));
  assert.doesNotMatch(text, /Этап|Изменить|Задать шаг/u);
  assert.match(text, /Следующий шаг Собрать апостиль на аттестат/u);
  assert.match(text, /Не удалось загрузить задачи\. Обновите страницу, чтобы повторить\./u);
  assert.match(text, /Нет доступа к документам этого дела\./u);
  assert.match(text, /Нет доступа к переписке этого дела\./u);
  assert.doesNotMatch(surfaces.get("unread"), /href="\/v3\/messages\?case=/u);
  const closed = texts(surfaces.get("closed"));
  assert.match(closed, /Состояние Дело закрыто/u);
  assert.doesNotMatch(closed, /Изменить|Задать шаг/u);
  assert.match(closed, /Открытых задач нет\. .*Сообщений пока нет\./u);
});

test("the page: name as h1, «Дело студента» tab title, back to the same list; the lead view keeps its own overview", () => {
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /if \(typeof caseParam === "string" && leadParam === undefined\) return \{ title: "Дело студента" \};/u);
  assert.match(page, /<PartShell title=\{caseParts && view \? view\.profile\.person : docsMode \? "EVO Docs" : view \? "Профиль" : "Студенты"\}/u);
  assert.match(page, /<Link href=\{requestsReturnTo \?\? directoryHref\}[^>]*>\s*<Icon name="arrow-left" size=\{16\} \/>\s*\{requestsReturnTo \? "Заявки" : docsMode \? "EVO Docs" : "Студенты"\}/u);
  assert.match(page, /const caseTarget = view\?\.details\.routeTarget\.studentCaseId && view\.details\.admissions/u);
  assert.match(page, /caseOverview=\{caseParts\?\.overview \?\? undefined\}/u);
  // Права редактора шага — одни для «Быстрого просмотра» и дела.
  assert.match(page, /stepAccess: caseWork\.row \? nextStepAccess\(editor\.input, caseWork\.row, editor\.recordScopes\) : \{ kind: "read_only", reason: null \}/u);
  assert.match(page, /editor: editor\.input,\n    recordScopes: editor\.recordScopes,/u);
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /\{current === "overview" && caseOverview \? caseOverview : null\}/u);
  assert.match(profile, /\{current === "overview" && !caseOverview \? \(/u);
  assert.match(profile, /<Overview\n/u);
  // Полоса вкладок прокручивается и обрезала бы внешнюю рамку фокуса — у её вкладок рамка внутри.
  assert.match(profile, /aria-label="Разделы профиля"\n\s+tabIndex=\{0\}\n\s+data-tab-strip=""/u);
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \[data-tab-strip\] \.v3-choice:focus-visible \{\n {2}outline-offset: -2px;\n\}/u);
  // Прежний «Обзор» лида рисует ту же часть продажи, что «Данные продажи» дела.
  assert.match(read("src/components/v3/profile/tabs.tsx"), /<SalesOverview profile=\{profile\} sales=\{sales\} draft=\{draft\} actor=\{actor\} requestIds=\{requestIds\} \/>/u);
  // Строка очереди дела — то же чтение 241, выбранная по id; не нашлась — null, а не выдумка.
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /view: target\.state, sort: "due", pageSize: STUDENT_CASE_QUEUE_PAGE_SIZE_MAX, query,/u);
  assert.match(source, /page\.rows\.find\(\(row\) => row\.studentCaseId === target\.studentCaseId\) \?\? null/u);
});
