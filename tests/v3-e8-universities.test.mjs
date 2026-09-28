import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { partnerPacketHref, universityRows } from "../src/components/v3/profile/university-programs-view.ts";
import { APPLICATION_PATH_STEPS, applicationPathStep, applicationPathWord } from "../src/lib/v3/wording.ts";

/**
 * Э8.2 «Вузы и программы» (решение владельца 28.09.2026, docs/PLAN_CHANGES.md
 * «Э8: срезы по итоговой критике»). Логика строк проверяется напрямую,
 * разметка — настоящей сборкой вкладки (`caseWorkParts` + `Profile` +
 * `UniversityProgramsView`) с синтетическими данными
 * (tests/e2e/case-route-static-render.cjs --json) в отдельном node-процессе.
 * Поведение в браузере с настоящим React — `--client` того же файла. Права и
 * данные решает сервер; этот тест их не проверяет.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-route-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
/** Разметка без скрытого: свёрнутых `<details>`, закрытых `<dialog>`, `hidden` и всплывающих меню. */
function visible(html) {
  let out = html;
  const rules = [
    ["details", /<details(?![^>]*\b(?:open|data-folded)\b)[^>]*>/u],
    ["dialog", /<dialog(?![^>]*\bopen\b)[^>]*>/u],
    ["section", /<section[^>]*\bhidden=""[^>]*>/u],
    ["div", /<div[^>]*\bpopover="auto"[^>]*>/u],
  ];
  for (const [tag, open] of rules) {
    for (let match = open.exec(out); match; match = open.exec(out)) {
      let depth = 0;
      let index = match.index;
      const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gu");
      tags.lastIndex = index;
      for (let next = tags.exec(out); next; next = tags.exec(out)) {
        depth += next[1] ? -1 : 1;
        if (depth === 0) { index = tags.lastIndex; break; }
      }
      // Закрывающий тег свёрнутого `<details>` оставляется — его `<summary>` виден.
      out = tag === "details"
        ? `${out.slice(0, match.index)}${out.slice(match.index, index).match(/^<details[^>]*>\s*<summary[\s\S]*?<\/summary>/u)?.[0].replace("<details", "<details data-folded") ?? ""}</details>${out.slice(index)}`
        : `${out.slice(0, match.index)}${out.slice(index)}`;
    }
  }
  return out;
}

// --- логика строк ------------------------------------------------------------

const NOW = new Date("2026-09-23T06:00:00.000Z"); // 12:00 по Бишкеку
const CASE = "cccccccc-2222-4222-8222-000000000001";
const id = (n) => `66666666-5555-4555-8555-${String(n).padStart(12, "0")}`;
function application(n, fields = {}) {
  return {
    universityApplicationId: id(n), version: "1", studentCaseId: CASE, institutionName: fields.institution ?? `Вуз ${n}`,
    programName: fields.program ?? null, isPrimary: fields.primary ?? false, universityDeadlineOn: fields.deadline ?? null,
    country: fields.country ?? null, degree: fields.degree ?? null, status: fields.status ?? "preparation",
    latestEvidenceReference: null, intake: "2027", createdByDisplayName: fields.addedBy ?? null,
  };
}
function preparation(n, fields = {}) {
  return {
    applicationId: id(n), studentCaseId: CASE, institutionId: "i", programId: "p", intakeId: "k", deadlineStateAtSelection: fields.state ?? "confirmed",
    applicationStatus: fields.status ?? "preparation", applicationVersion: "1",
    content: { name: fields.name ?? `Каталог ${n}`, country: "MY", programs: [{ id: "p", title: "Программа каталога",
      intakes: [{ id: "k", label: "Осень 2027", applicationDeadline: fields.deadline ?? null }] }] },
  };
}

test("the path words: вариант → заявка подана → решение, one status word for the current step", () => {
  assert.deepEqual([...APPLICATION_PATH_STEPS], ["вариант", "заявка подана", "решение"]);
  const cases = {
    preparation: [0, "вариант"], ready: [0, "готова к подаче"], submitted: [1, "заявка подана"], under_review: [1, "на рассмотрении"],
    offer: [2, "получен оффер"], rejected: [2, "отказ вуза"], enrolled: [2, "зачислен"], withdrawn: [null, "отозвана"], closed: [null, "закрыта"],
  };
  for (const [status, [step, word]] of Object.entries(cases)) {
    assert.equal(applicationPathStep(status), step, status);
    assert.equal(applicationPathWord(status), word, status);
  }
  assert.equal(applicationPathWord("unknown_key"), null, "an unknown key is never shown raw");
  assert.equal(applicationPathStep(null), null);
});

test("one row per university: an application and its catalogue preparation merge, main first, orphans last", () => {
  const rows = universityRows([
    application(1, { institution: "Ручной вуз", country: "CN", degree: "bachelor", addedBy: "Сотрудник" }),
    application(2, { institution: "Имя из заявки", primary: true }),
  ], [preparation(2, { name: "Имя из каталога", deadline: "2026-11-30" }), preparation(3, { name: "Без строки заявки" })], NOW);
  assert.deepEqual(rows.map((row) => row.university), ["Имя из каталога", "Ручной вуз", "Без строки заявки"]);
  const [main, manual, orphan] = rows;
  assert.equal(main.primary, true);
  assert.equal(main.program, "Программа каталога");
  assert.equal(main.intake, "Осень 2027", "the catalogue intake names the row");
  assert.equal(manual.intake, null, "the application `intake` is the case's intake — same on every row, not shown");
  assert.deepEqual(manual.facts, ["Китай", "Бакалавриат"]);
  assert.equal(manual.addedBy, "Сотрудник");
  assert.equal(orphan.application, null);
  assert.equal(orphan.applicationId, id(3));
  assert.deepEqual(orphan.facts, ["Малайзия"]);
});

test("the deadline: Bishkek day, own deadline first, a word only before submission, unconfirmed named", () => {
  const [catalogue] = universityRows([application(1)], [preparation(1, { deadline: "2026-11-30" })], NOW);
  assert.deepEqual({ ...catalogue.deadline }, { dateTime: "2026-11-30", text: "30.11", word: { text: "через 68 дн", tone: "upcoming" }, unconfirmed: false });
  const [own] = universityRows([application(1, { deadline: "2026-09-23" })], [preparation(1, { deadline: "2026-11-30" })], NOW);
  assert.equal(own.deadline.text, "23.09", "the application's own deadline wins over the catalogue");
  assert.equal(own.deadline.word.tone, "today");
  const [late] = universityRows([application(1, { deadline: "2026-09-18", status: "ready" })], [], NOW);
  assert.deepEqual({ ...late.deadline.word }, { text: "прошёл 5 дн", tone: "overdue" });
  const [submitted] = universityRows([application(1, { deadline: "2026-09-18", status: "submitted" })], [], NOW);
  assert.equal(submitted.deadline.word, null, "after submission the deadline is a date, not an alarm");
  const [nextYear] = universityRows([application(1, { deadline: "2027-01-15" })], [], NOW);
  assert.equal(nextYear.deadline.text, "15.01.27", "the year only when it is not the current one");
  const [unconfirmed] = universityRows([application(1)], [preparation(1, { deadline: "2026-11-30", state: "needs_confirmation" })], NOW);
  assert.equal(unconfirmed.deadline.unconfirmed, true);
  assert.equal(unconfirmed.deadline.word, null);
  const [none] = universityRows([application(1)], [], NOW);
  assert.equal(none.deadline, null);
});

test("tones: offer and enrolment are ok, a university rejection is the only red word", () => {
  const rows = universityRows(["offer", "enrolled", "rejected", "withdrawn", "submitted"].map((status, n) => application(n + 1, { status })), [], NOW);
  assert.deepEqual(rows.map((row) => row.tone), ["ok", "ok", "danger", "neutral", "neutral"]);
  assert.equal(partnerPacketHref("/v3/profile?case=c&tab=route&returnTo=%2Fv3", id(1)),
    `/v3/profile?case=c&tab=route&returnTo=%2Fv3&panel=packets&packet_application=${id(1)}#partner-packets`);
});

// --- разметка вкладки ----------------------------------------------------------

test("one list, one add button: the catalogue is the page's main action unless «Принять дело» is", () => {
  for (const name of ["empty", "one-variant", "decision", "many"]) {
    const html = visible(surfaces.get(name));
    const reds = [...html.matchAll(/<(?:button|a)\b[^>]*class="[^"]*\bbg-accent\b[^"]*"[^>]*>/gu)];
    assert.equal(reds.length, 1, `${name}: exactly one solid red action`);
    assert.match(reds[0][0], /data-testid="v3-catalog-preparation-launcher"/u, `${name}: it is «Вуз из каталога»`);
    assert.match(text(html), /Вузы и программы Вуза нет в каталоге\? Добавить вручную Вуз из каталога/u, `${name}: the manual entry is a quiet link before the button`);
    assert.doesNotMatch(html, /Приём дела|v3-handoff-acknowledgement|Выбрать программу и набор из каталога|title="Заявки"/u, `${name}: no case-acceptance card, no second catalogue entry`);
  }
  const accept = visible(surfaces.get("accept"));
  assert.equal([...accept.matchAll(/class="[^"]*\bbg-accent\b[^"]*"/gu)].length, 1, "accept: one red — «Принять дело» in the header");
  assert.match(accept, /data-testid="v3-case-primary"/u);
  assert.match(accept, /<button[^>]*class="v3-raised [^"]*bg-surface[^"]*"[^>]*data-testid="v3-catalog-preparation-launcher"/u, "accept: the catalogue button is neutral");
  assert.doesNotMatch(accept, /<h3 class="t-section[^"]*">Приём дела<\/h3>/u, "accept: no «Приём дела» card on the case page");
  // Страница лида (`?id=`): у заголовка «Принять дело» нет, ответить можно только здесь.
  const lead = visible(surfaces.get("lead"));
  assert.match(lead, /id="handoff-acknowledgement"[\s\S]*?Принять дело/u, "lead: «Приём дела» stays");
  assert.match(lead, /<button[^>]*class="v3-raised [^"]*bg-surface[^"]*"[^>]*data-testid="v3-catalog-preparation-launcher"/u, "lead: the catalogue button is neutral");
  assert.match(surfaces.get("empty"), /data-testid="v3-universities-empty">Вузов пока нет\. Добавленный вуз — это вариант, а не подача документов\.<\/p>/u);
});

test("a row: university · program · intake, the path with one chip, the deadline and who added it", () => {
  const html = surfaces.get("decision");
  const rows = [...html.matchAll(/<li class="py-3" data-testid="v3-profile-application"[\s\S]*?(?=<li class="py-3" data-testid="v3-profile-application"|<\/ul>)/gu)].map(([row]) => row);
  assert.equal(rows.length, 3);
  const [main, submitted, decided] = rows.map((row) => text(visible(row)));
  assert.match(rows[0], /data-primary="true"/u);
  assert.match(main, /^Шанхайский университет ★ основной Международная торговля · Осень 2027 Китай · Бакалавриат · Добавил: Айгүл Осмонова вариант → заявка подана → решение Срок подачи 30\.11 через 68 дн Документы программы$/u);
  assert.match(submitted, /Подтверждение: Номер заявления 0000 \(синтетика\) вариант → заявка подана → решение Срок подачи 30\.09$/u);
  assert.match(decided, /Партнёр: Партнёр «Синтетика» · Решение: Оффер № 0000 Ссылка партнёра \(откроется в новой вкладке\) вариант → заявка подана → получен оффер Срок подачи 15\.08$/u);
  // Текущий шаг — одно слово-чип; остальные шаги — текст.
  for (const row of rows) assert.equal([...row.matchAll(/class="v3-chip t-caption"/gu)].length, 1);
  assert.match(rows[1], /<li class="flex items-center gap-1\.5" aria-current="step"><span aria-hidden="true" class="text-fg-3">→<\/span><span class="v3-chip t-caption" data-tone="neutral">заявка подана<\/span><\/li>/u);
  assert.match(rows[2], /<span class="v3-chip t-caption" data-tone="ok">получен оффер<\/span>/u);
  assert.match(rows[0], /<time dateTime="2026-11-30" class="font-mono tabular-nums text-fg">30\.11<\/time> <span class="v3-due t-caption" data-due="upcoming">через 68 дн<\/span>/u);
  // «⋯»: три формы строки и пакет партнёру; формы стоят скрытыми под строкой.
  assert.match(rows[1], /aria-label="Ещё: Университет Малайи"[\s\S]*?>Параметры заявки<[\s\S]*?>Отметить статус<[\s\S]*?>Партнёр и решение<[\s\S]*?href="[^"]*&amp;panel=packets&amp;packet_application=66666666-5555-4555-8555-000000000002#partner-packets"[^>]*>Пакет партнёру</u);
  for (const panel of ["details", "status", "partner"]) assert.match(rows[1], new RegExp(`<section hidden="" [^>]*data-row-panel="${panel}"`, "u"));
  assert.match(rows[1], /<form[^>]*>[\s\S]*?name="application_id" value="66666666-5555-4555-8555-000000000002"[\s\S]*?<select name="status" required=""/u);
  const many = surfaces.get("many");
  assert.match(text(visible(many)), /Карлов университет Медицина Чехия · Магистратура · Добавил: Айгүл Осмонова отозвана/u, "off the path: only the status word");
  assert.match(text(visible(many)), /Университет Цинхуа Архитектура · Осень 2027 Китай вариант → заявка подана → решение Срок подачи 15\.01\.27 · нужно подтвердить Документы программы/u);
  assert.match(many, /<span class="v3-due t-caption" data-due="today">сегодня<\/span>/u);
  assert.match(many, /<span class="v3-due t-caption" data-due="overdue">прошёл 5 дн<\/span>/u);
  assert.match(many, /<span class="v3-chip t-caption" data-tone="danger">отказ вуза<\/span>/u);
  // Подготовка без строки заявки: «⋯» нет — формам нужна строка заявки.
  const orphan = many.slice(many.lastIndexOf('data-testid="v3-profile-application"'));
  assert.doesNotMatch(orphan.slice(0, orphan.indexOf("</li>")), /popovertarget/u);
});

test("disclosures: one chevron style, 44 px, no red summaries; anchors and proof addresses stay", () => {
  const html = surfaces.get("decision");
  assert.match(html, /<section id="applications" aria-labelledby="applications-title" class="@container\/unis scroll-mt-4" data-testid="v3-profile-admissions-workspace">/u);
  assert.match(html, /<section id="preparation-66666666-5555-4555-8555-000000000001" class="mt-1 scroll-mt-6" aria-label="Подготовка по выбранной программе"><button type="button" class="group [^"]*min-h-11[^"]*" aria-expanded="false" aria-controls="preparation-66666666-5555-4555-8555-000000000001-documents">Документы программы<svg[^>]*class="[^"]*group-aria-expanded:rotate-180/u);
  // scripts/lib/document-package-browser-proof.mjs: `<details id="partner-packets">` и `:scope > summary`.
  assert.match(html, /<details class="group scroll-mt-4 border-b border-border" id="partner-packets"><summary class="flex min-h-12 [^"]*">[\s\S]*?Пакеты документов партнёру[\s\S]*?group-open:rotate-180/u);
  assert.match(html, /data-testid="v3-application-create-launcher"[^>]*>Добавить вручную<\/button>/u);
  for (const [name, surface] of surfaces) {
    assert.doesNotMatch(surface, /<summary[^>]*\btext-accent\b/u, `${name}: no red-accent summary`);
    for (const [summary] of surface.matchAll(/<summary\b[^>]*>/gu)) assert.match(summary, /min-h-1[12]/u, `${name}: ${summary}`);
  }
  // «⋯ → Пакет партнёру»: панель открыта, заявка выбрана; подтверждение пакета — тёмное, не красное.
  const packet = surfaces.get("packet");
  assert.match(packet, /<details class="group scroll-mt-4 border-b border-border" id="partner-packets" open="">/u);
  assert.match(packet, /<option value="66666666-5555-4555-8555-000000000003" selected="">Чжэцзянский университет · Экономика<\/option>/u);
  assert.match(packet, /<button class="[^"]*\bbg-fg\b[^"]*" disabled="">Зафиксировать пакет<\/button>/u);
});

test("the page wires the tab address and a validated packet preselection; reads stay separate", () => {
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /<UniversityProgramsTab actor=\{actor\} draft=\{view\.details\} routeHref=\{hrefFor\("route"\)\}/u);
  assert.match(page, /packetApplicationId=\{singleSearchParam\(params\.packet_application\) \?\? null\}/u);
  const tab = read("src/components/v3/profile/UniversityProgramsTab.tsx");
  assert.match(tab, /readApplicationPartnerDetails\(actor, caseId\)\.catch\(\(\) => \[\]\)/u);
  assert.match(tab, /readStaffPreparationsAction\(caseId\)\.catch\(/u);
  assert.match(tab, /readPartnerPackets\(actor, caseId\)\.catch\(\(\) => null\)/u);
  assert.match(tab, /if \(!caseId \|\| actor\.presentationRole === "sales"\) return null;/u, "the sales presentation role still sees nothing here");
  assert.match(tab, /applications\.some\(\(application\) => application\.id === packetApplicationId\) \? packetApplicationId : null/u, "only an application of this case is preselected");
  assert.match(tab, /\{handoff && !casePage \? <ProfileHandoffAcknowledgement snapshot=\{handoff\} \/> : null\}/u);
  assert.match(tab, /const canWriteApplications = !preview && active && staffHasPermission\(actor, "application\.manage"\);/u);
  assert.match(tab, /const canSelect = canWriteApplications && staffHasPermission\(actor, "catalog\.read"\);/u);
  // Сохранённые запросы без результата: выбор — у кнопки и в окне, подготовка документов — в строке.
  const picker = read("src/components/v3/profile/StaffCatalogPreparationPicker.tsx");
  assert.match(picker, /const \{ intent: retained, blocked \} = useStaffPending\(picker\.scope, "selection"\);/u);
  assert.match(picker, /Повторить сохранённый запрос/u);
  const panel = read("src/components/v3/profile/StaffPreparationPanel.tsx");
  assert.match(panel, /useStaffPending\(scope, "requirements", preparation\.applicationId\)/u);
  assert.match(panel, /const anchorOpen = hash === `#\$\{id\}`;/u);
  assert.match(panel, /className=\{QUEUE_CONFIRM\} onClick=\{\(\) => void initialize\(\)\}/u, "the recovery confirm is dark, not a second red");
});
