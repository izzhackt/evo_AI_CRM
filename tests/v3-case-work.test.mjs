import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  caseApplicationLines,
  caseChatWork,
  caseChecklistCounts,
  caseContacts,
  caseDirectionLabel,
  caseMomentLabel,
  caseOpenTasks,
  casePortalStatus,
} from "../src/components/v3/profile/case-work-view.ts";
import { studentsDocumentsLine } from "../src/components/v3/students/students-queue-view.ts";
import { caseSectionAccessForState, readCaseProfileSections } from "../src/lib/v3/case-access-contract.ts";
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
  assert.match(text, /Состояние ждёт принятия/u);
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
  assert.match(text, /Документы 7 из 12 принято 2 на проверке 1 исправить 2 не загружено Документы дела/u);
  assert.match(text, /Переписка Нужен ответ Открыть переписку/u);
  assert.match(html, /href="\/v3\/messages\?case=cccccccc-2222-4222-8222-000000000001"/u);
  assert.match(text, /Шанхайский университет · Международная торговля — готовится · основной вариант · дедлайн 30\.11/u);
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
  assert.match(read("src/components/v3/profile/CaseWorkParts.tsx"), /<SalesOverview [^>]*requestIds=\{input\.requestIds\} quiet \/>/u);
  assert.match(text, /Оплата 40% оплачено · остаток 900 \$ Договор и оплата/u);
  assert.match(html, /<details name="case-edit" id="portal-access" data-lead-group="" data-testid="v3-case-portal"[^>]*>/u);
  assert.match(text, /Доступ к порталу анкета одобрена/u);
  assert.match(text, /Сведения Направление Китай Куратор АО Айгүл Осмонова Нагрузка кураторов Передал Эрмек Токтосунов · 30\.08 12:00 Продажа Эрмек Токтосунов Передано в поступление Контакты \+996 000 000 001 student@example\.invalid Приём дела Дело принято куратором Согласованный контакт: 24\.09\.2026/u);
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
  assert.match(page, /<PartShell title=\{\(caseParts \|\| leadParts\) && view \? view\.profile\.person : docsMode \? "EVO Docs" : view \? "Профиль"\n\s+: closedLead \? closedLead\.name \?\? "Лид без имени" : "Студенты"\}/u);
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
  assert.match(read("src/components/v3/queue/QueueTabStrip.tsx"), /tabIndex=\{focusable \? 0 : undefined\}\n\s+data-tab-strip=\{focusable \? "" : undefined\}/u);
  assert.match(read("src/app/(v3)/v3.css"), /\.v3-world \[data-tab-strip\] \.v3-choice:focus-visible \{\n {2}outline-offset: -2px;\n\}/u);
  // Прежний «Обзор» лида рисует ту же часть продажи, что «Данные продажи» дела.
  assert.match(read("src/components/v3/profile/tabs.tsx"), /<SalesOverview profile=\{profile\} sales=\{sales\} draft=\{draft\} actor=\{actor\} requestIds=\{requestIds\} \/>/u);
  // Строка очереди дела — то же чтение 241, выбранная по id; не нашлась — null, а не выдумка.
  const source = read("src/lib/v3/case-work-source.ts");
  assert.match(source, /view: target\.state, sort: "due", pageSize: STUDENT_CASE_QUEUE_PAGE_SIZE_MAX, query,/u);
  assert.match(source, /page\.rows\.find\(\(row\) => row\.studentCaseId === target\.studentCaseId\) \?\? null/u);
});

// --- Дело без лида для чтения: контакты и направление в «Сведениях» ----------------------------
// Дело прямого студента (форма «Добавить студента», импорт из amoCRM): его лид `converted`, лидовые
// чтения отдают только `open`, и `readCaseProfile` идёт по ветке «только дело» без клиента лида.

test("direct case: «Контакты» come from the анкета fields with one quiet note, «Направление» from the queue row", () => {
  const html = surfaces.get("direct-case");
  const text = texts(html);
  // Строка очереди (Китай) главнее страны цели (Малайзия).
  assert.match(text, /Сведения Направление Китай Куратор .* Контакты \+996 000 000 002 student-2@example\.invalid не подтверждено Документы/u);
  // «Доступ к порталу» по-прежнему ждёт подтверждённую почту клиента: неподтверждённое поле анкеты его не заполняет.
  assert.match(text, /Сначала добавьте студенту подтверждённый рабочий email/u);
  assert.doesNotMatch(html, /name="email" value="student-2@example\.invalid"/u);
  // Одна подпись на оба значения, а не по подписи у каждого.
  assert.equal((text.match(/не подтверждено/gu) ?? []).length, 1);
  assert.match(html, /href="tel:\+996000000002"/u);
  assert.match(html, /href="mailto:student-2@example\.invalid"/u);
  // Продажи у дела нет: ни «Данных продажи», ни «Условий продажи», ни «Продажа» в «Сведениях».
  assert.doesNotMatch(text, /Данные продажи|Условия продажи|Продажа /u);
  // Ни ключа поля, ни ключа состояния на экране.
  assert.doesNotMatch(html, /needs_review|mobile_phone|student_email|admissions_direction|converted/u);
  assert.doesNotMatch(text, /Не выбрано/u);
  // Подпись без цвета: это не ошибка и не состояние записи.
  assert.doesNotMatch(html, /<[^>]+class="[^"]*\b(?:text-danger|text-warn)\b[^"]*"[^>]*>не подтверждено/u);
});

test("direct case without a queue row: direction by the target country, a note only on the value that needs it", () => {
  const html = surfaces.get("direct-case-no-row");
  const text = texts(html);
  assert.match(text, /Направление Малайзия /u);
  // Телефон подтверждён - без подписи; у почты своя.
  assert.match(text, /Контакты \+996 000 000 002 student-2@example\.invalid источники расходятся Документы/u);
  assert.equal((text.match(/источники расходятся/gu) ?? []).length, 1);
  assert.doesNotMatch(text, /не подтверждено/u);
  assert.doesNotMatch(html, /\bconflict\b|\bconfirmed\b/u);
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

test("direct case without the анкета read and with an unknown country: no contacts, no invented direction", () => {
  const html = surfaces.get("direct-case-closed-fields");
  const text = texts(html);
  assert.match(text, /Направление Не выбрано /u);
  assert.doesNotMatch(text, /Контакты/u);
  assert.doesNotMatch(html, /href="(?:tel|mailto):/u);
  assert.doesNotMatch(text, /China/u, "an unknown target country is never shown raw");
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

test("caseDirectionLabel: snapshot, then the queue row, then the target country; unknown values are never shown", () => {
  const label = (snapshot, row, targetCountry) => caseDirectionLabel({ snapshot, row, targetCountry });
  assert.equal(label("TR", "CN", "MY"), "Турция");
  assert.equal(label(null, "CN", "MY"), "Китай");
  assert.equal(label(null, undefined, "MY"), "Малайзия");
  assert.equal(label(null, null, "EUROPE"), "Европа");
  assert.equal(label(null, null, " AE "), "ОАЭ");
  assert.equal(label(null, null, "IT"), "Италия");
  for (const unknown of ["China", "unknown", "handed_off", "", "  ", null, "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(label(null, null, unknown), null, String(unknown));
  }
  // Словарь стран знает только свои ключи: имена из прототипа объекта - не слова.
  for (const inherited of ["constructor", "__proto__", "toString", "valueOf"]) assert.equal(country(inherited), null, inherited);
});

test("the case-only branch of readCaseProfile keeps the client e-mail/phone null (portal access needs a confirmed e-mail) and carries the target country", () => {
  const source = read("src/lib/v3/profile-source.ts");
  const branch = source.slice(source.indexOf("async function readCaseProfile("), source.indexOf("async function readLeadProfile("));
  assert.match(branch, /person: data\.studentCase\.studentDisplayName,[\s\S]*?email: null,\n {4}phone: null,\n {4}student: true,/u);
  assert.match(source, /direction: data\.studentCase\.admissionsDirection \?\? null,\n {4}targetCountry: data\.studentCase\.targetCountry,/u);
  // Контакты и направление собираются чистыми функциями из уже прочитанного, без нового чтения.
  const parts = read("src/components/v3/profile/CaseWorkParts.tsx");
  assert.match(parts, /contacts=\{caseContacts\(\{ phone: profile\.phone, email: profile\.email \}, draft\.profileFields\)\}/u);
  assert.match(parts, /snapshot: admissions\.direction, row: work\.row\?\.admissionsDirection, targetCountry: admissions\.targetCountry,/u);
  assert.match(parts, /email=\{profile\.email\}/u, "portal access still takes the client e-mail only");
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
  assert.match(parts, /documentsAwaitCurator=\{admissions\.caseState === "pending"\}/u);
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
