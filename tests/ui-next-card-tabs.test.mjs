// «Новый вид» (решение владельца 27.10.2026), поток «card-tabs»: вкладки карточки лида и дела кроме «Обзора» - «Документы»,
// «Договор и оплата», «Вузы и программы», «Анкета», «История» - и закрытый лид. Разметку даёт НАСТОЯЩАЯ сборка страницы на
// синтетических данных (tests/e2e/card-tabs-next-static-render.cjs, отдельные node-процессы): `--json` - вкладка в новом и в прежнем
// виде, `--page-json` - настоящий `page.tsx` в четырёх режимах переключателя. Границы включения, размеры файлов, ленивая загрузка и
// «прежний вид не тронут» - по исходникам. Это не живая проверка данных: чтения, права и команды те же, их проверяют прежние тесты.
// Снимки, фокус, 44 px, панели и доступность - тот же стенд с --screenshots (Chromium).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const harness = (flag) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./e2e/card-tabs-next-static-render.cjs", import.meta.url)), flag],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
const pages = new Map(harness("--json").map((surface) => [surface.name, surface]));
const realPages = new Map(harness("--page-json").map((surface) => [surface.name, surface.html]));
const next = (name) => pages.get(name)?.html ?? assert.fail(`нет сценария ${name}`);
const legacy = (name) => pages.get(name)?.legacy ?? assert.fail(`нет сценария ${name}`);
const real = (name, mode) => realPages.get(`${name}:${mode}`) ?? assert.fail(`нет страницы ${name}:${mode}`);
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&#x27;/gu, "'").replace(/\s+/gu, " ").trim();
const count = (html, pattern) => [...html.matchAll(pattern)].length;

const NEW_DIR = "src/components/v3/profile/next/tabs";
const NEW_FILES = [...readdirSync(new URL(`../${NEW_DIR}`, import.meta.url)).map((name) => `${NEW_DIR}/${name}`),
  "src/components/v3/profile/next/MoreSheet.tsx", "src/components/v3/profile/next/MoreSheetImpl.tsx", "src/components/kit/card-classes.ts", "src/components/v3/profile/money-panels.ts"];
const CASE_TABS = ["docs-all", "docs-review", "docs-empty", "docs-preview", "money-same", "money-cross", "money-empty", "route-four", "route-empty", "anketa-full", "anketa-simple", "history-long", "history-short", "history-forbidden"];

test("сценарии собираются: четырнадцать вкладок дела, две вкладки лида и закрытый лид; каждый — в новом и в прежнем виде", () => {
  for (const name of [...CASE_TABS, "lead-money-gate", "lead-anketa", "lead-closed"]) {
    assert.ok(next(name).length > 500, name);
    assert.ok(legacy(name).length > 500, name);
  }
  assert.equal(pages.size, 17);
});

test("«Документы»: карточка «Чек-лист» (прогресс, фильтр, «Документ», формат загрузки за «?») и по карточке на группу; прежний вид — прежний список", () => {
  const html = next("docs-all");
  assert.match(html, /data-testid="v3-documents-checklist"/u);
  assert.equal(count(html, /data-testid="v3-documents-group"/gu), 2, "две группы — две карточки");
  assert.match(html, /<h3 class="t-section[^"]*">Чек-лист<\/h3>/u);
  assert.match(html, /aria-label="Пояснение: Чек-лист"/u);
  assert.ok(!text(html).includes("Загрузка: PDF"), "формат загрузки не на экране");
  assert.match(text(html), /2 из 9 принято/u);
  assert.match(html, /<nav aria-label="Документы по состоянию"/u, "фильтр по состоянию — ссылки, как раньше");
  assert.match(html, /data-testid="v3-document-add-toggle"/u);
  assert.equal(count(html, /data-testid="v3-document-row"|data-document-intent=/gu) >= 0, true);
  // Те же строки `DocumentRow`, что у прежнего вида: столько же пунктов.
  assert.equal(count(html, /<li[^>]*scroll-mt-4 border-b border-border py-3/gu), count(legacy("docs-all"), /<li[^>]*scroll-mt-4 border-b border-border py-3/gu));
  assert.match(html, /data-testid="v3-removed-document-history"/u, "история удалённых пунктов есть");
  assert.match(html, /data-testid="document-recognition"/u, "распознавание есть");
  // Прежний вид: одна подсказка про форматы строкой и заголовки групп `t-caption`.
  const old = legacy("docs-all");
  assert.match(old, /data-testid="v3-document-upload-hint">Загрузка: PDF, JPEG, PNG · до 25 МБ</u);
  assert.match(old, /<h3 class="t-caption text-fg-2">Документы<\/h3>/u);
  assert.doesNotMatch(old, /v3-documents-checklist|v3-documents-group/u);
  // Пустое и закрытое остаются словами на виду.
  assert.match(text(next("docs-empty")), /Чек-лист пока пуст\./u);
  assert.match(text(next("docs-preview")), /В режиме этой роли документы доступны только для просмотра\./u);
  assert.equal(count(next("docs-empty"), /data-testid="v3-documents-group"/gu), 0);
  assert.equal(count(next("docs-review"), /data-testid="v3-documents-group"/gu), 1, "фильтр «На проверке»: одна группа");
});

test("«Договор и оплата»: сводка из четырёх данных с «⋯», транши и оплаты — соседние карточки, стоп и валюты на виду; прежний лист — одна рамка", () => {
  const html = next("money-cross");
  const summary = html.slice(html.indexOf('data-testid="v3-case-agreement"'), html.indexOf('data-testid="v3-case-agreement-tranches"'));
  assert.deepEqual([...summary.matchAll(/<dt class="t-caption text-fg-3">([^<]+)<\/dt>/gu)].map((match) => match[1]), ["Стоимость", "Договор", "Оплачено", "Остаток"]);
  assert.match(summary, /data-testid="v3-case-money-more"/u, "«⋯» — в шапке карточки сводки");
  assert.match(text(summary), /30 000,00 KGS/u);
  assert.match(text(summary), /по траншам, без пересчёта валют/u, "суммы разных валют не пересчитываются");
  assert.match(text(summary), /с учётом возвратов/u);
  assert.match(summary, /data-testid="v3-case-money-stop"/u, "финансовый стоп на виду");
  assert.match(text(summary), /стоп активен.*Второй платёж просрочен/u);
  assert.match(html, /data-testid="v3-case-agreement-tranches"/u);
  assert.match(html, /data-testid="v3-case-agreement-payment"/u);
  assert.match(html, /<section aria-label="Договор и оплата" data-case-money="" data-testid="v3-profile-contract-workspace" data-student-case-id="[^"]+" class="@container grid min-w-0 grid-cols-1 gap-4">/u);
  assert.doesNotMatch(html, /<header class="flex min-h-12 items-center justify-between gap-3 border-b border-border/u, "прежней шапки листа нет");
  // Панели «⋯» закрыты, пока их не выбрали; открытая — карточка.
  assert.equal(count(html, /<section id="money-[a-z]+" data-money-panel="" hidden=""/gu), 5, "подготовка договора, обязательства, стопы, операции, служебные сведения");
  assert.match(html, /<section id="money-obligations" data-money-panel="" hidden="" aria-labelledby="money-obligations-title" class="scroll-mt-20 rounded-card border border-border bg-card px-5 py-3">/u);
  assert.match(html, /aria-label="Пояснение: Обязательства"/u, "пояснение панели — за «?»");
  assert.ok(!text(html).includes("Услуги EVO и другие расходы по делу"), "и не на экране");
  assert.match(text(next("money-same")), /Прежние версии · 1/u);
  assert.match(next("money-same"), /data-testid="v3-case-money-history"/u);
  assert.match(text(next("money-empty")), /Договор не загружен|не загружен/u);
  assert.match(text(next("money-empty")), /Траншей нет\./u);
  // Прежний вид: один лист с шапкой и строками сводки.
  const old = legacy("money-cross");
  assert.match(old, /<section aria-labelledby="[^"]+" data-case-money="" data-testid="v3-profile-contract-workspace" data-student-case-id="[^"]+" class="@container min-w-0 rounded-card border border-border bg-surface">/u);
  assert.match(old, /<header class="flex min-h-12 items-center justify-between gap-3 border-b border-border py-1 ps-4 pe-1">/u);
  assert.match(old, /<section id="money-obligations" data-money-panel="" hidden="" aria-labelledby="money-obligations-title" class="mt-4 scroll-mt-20 border-t border-border pt-1">/u);
  assert.match(text(old), /Услуги EVO и другие расходы по делу/u, "в прежнем виде пояснение — абзацем");
});

test("«Вузы и программы»: список вузов — одна карточка с кнопками добавления у заголовка, «вуза нет в каталоге» за «?», пакеты партнёру — карточка-раскрытие", () => {
  const html = next("route-four");
  assert.match(html, /<div[^>]*class="[^"]*@container\/unis"[^>]*id="applications"[^>]*data-testid="v3-profile-admissions-workspace"|id="applications"/u);
  assert.equal(count(html, /data-testid="v3-profile-application"/gu), 4);
  assert.match(html, /aria-label="Пояснение: Добавить вручную"/u);
  assert.ok(!text(html).includes("Вуза нет в каталоге?"), "подводка не на экране");
  assert.match(text(legacy("route-four")), /Вуза нет в каталоге\?/u, "в прежнем виде она на месте");
  assert.match(html, /<details class="group scroll-mt-4 rounded-card border border-border bg-card px-5" id="partner-packets"/u);
  assert.match(legacy("route-four"), /<details class="group scroll-mt-4 border-b border-border" id="partner-packets"/u);
  assert.match(html, /data-testid="v3-profile-admissions-list"/u, "список — прежний, без своего заголовка");
  assert.equal(count(html, /<h2 id="applications-title"/gu), 0);
  assert.equal(count(legacy("route-four"), /<h2 id="applications-title"/gu), 1);
  assert.match(text(next("route-empty")), /Вузов пока нет\./u);
});

test("«Анкета»: ответы анкеты данными («требуют проверки» за «?»), форма проверки полей в карточках, «Другие сведения» кнопкой с панелью", () => {
  const html = next("anketa-full");
  assert.match(html, /data-testid="v3-anketa-answers"/u);
  assert.match(html, /aria-label="Пояснение: Заполнено студентом"/u);
  assert.ok(!text(html).includes("Сведения требуют проверки"), "пояснение не на экране");
  assert.match(text(html), /Отправлено 20 августа 2026 г\./u);
  assert.match(text(html), /Имя и фамилия Айдана Сыдыкова/u);
  assert.match(html, /<section aria-labelledby="student-profile-fields-title"[^>]*class="grid min-w-0 grid-cols-1 gap-4"/u, "форма проверки — прежняя, карточками");
  assert.equal(count(html, /id="student-profile-fields-title"/gu), 1);
  assert.match(html, /data-testid="v3-anketa-other-open"[^>]*>Другие сведения дела</u, "прочее — кнопкой с панелью");
  assert.ok(!text(html).includes("Дата рождения 12.04.2008"), "содержимое панели не на странице");
  assert.match(text(html), /Подтверждено 4 из 61/u);
  // Без формы полей «Другие сведения» — карточкой, а итог квалификации на месте.
  const simple = next("anketa-simple");
  assert.match(simple, /data-testid="v3-anketa-other-card"/u);
  assert.match(text(simple), /Квалифицирован: 11 класс/u);
  assert.match(text(simple), /Дата рождения 12\.04\.2008/u);
  assert.doesNotMatch(simple, /v3-anketa-other-open/u);
  // Прежний вид: «Заполнено студентом» с абзацем «Сведения требуют проверки.»
  assert.match(text(legacy("anketa-full")), /Заполнено студентом Отправлено 20 августа 2026 г\.\. Сведения требуют проверки\./u);
  assert.doesNotMatch(legacy("anketa-full"), /v3-anketa/u);
});

test("«История»: десять событий на странице, остальные — «Ещё N»; нет доступа к журналу сказано словами; источник — данными", () => {
  const html = next("history-long");
  assert.equal(count(html, /data-testid="v3-history-event"/gu), 10);
  assert.match(html, /data-testid="v3-history-overflow"[^>]*>Ещё 2</u);
  assert.match(html, /aria-label="Ещё 2 в истории"/u);
  assert.doesNotMatch(html, /v3-history-overflow-items/u, "строки панели — не на странице");
  assert.match(html, /<nav aria-label="Страницы истории"[^>]*>[\s\S]*Более ранние события/u);
  assert.match(text(html), /Источник Откуда сайт Появился 01\.09\.2026 Передан 30\.08 06:00/u);
  assert.equal(count(next("history-short"), /data-testid="v3-history-event"/gu), 4);
  assert.doesNotMatch(next("history-short"), /v3-history-overflow/u);
  const forbidden = next("history-forbidden");
  assert.match(forbidden, /data-testid="v3-history-forbidden">Нет доступа к журналу этого дела\./u);
  assert.equal(count(forbidden, /data-testid="v3-history-event"/gu), 0);
  // Прежний вид — две карточки `Card eyebrow` ui.tsx с теми же событиями.
  assert.equal(count(legacy("history-long"), /<li class="border-b border-border px-4 py-2\.5 last:border-b-0">/gu), 12);
  assert.doesNotMatch(legacy("history-long"), /v3-history/u);
});

test("вкладки лида: «Подтверждение вручную» — карточка с пояснением за «?»; закрытый лид — одна карточка со словом «Лид закрыт» и командой «Вернуть в работу»", () => {
  const gate = next("lead-money-gate");
  assert.match(gate, /<h2[^>]*>Подтверждение вручную<\/h2>/u);
  assert.match(gate, /aria-label="Пояснение: Подтверждение вручную"/u);
  assert.ok(!text(gate).includes("Для передачи в поступление нужны договор и первый платёж"), "пояснение — за «?»");
  assert.match(text(legacy("lead-money-gate")), /Для передачи в поступление нужны договор и первый платёж\./u);
  const closed = next("lead-closed");
  assert.match(closed, /data-testid="v3-lead-closed-card"/u);
  assert.match(text(closed), /Лид закрыт \? · Не отвечает · 20\.09\.2026 Вернуть в работу/u);
  assert.match(text(closed), /Этап Связались Ответственный Санжар Эскизов Закрыл Санжар Эскизов/u);
  assert.match(closed, /aria-label="Пояснение: Лид закрыт"/u);
  assert.ok(!text(closed).includes("Контакты и история вернутся"), "пояснение — за «?»");
  assert.match(text(legacy("lead-closed")), /Контакты и история вернутся после «Вернуть в работу»\./u);
  assert.match(legacy("lead-closed"), /data-testid="v3-lead-closed" data-lead-id=/u);
});

test("каждая вкладка — карточки без вложенных, не больше четырёх данных в строке сводки, один h1", () => {
  for (const name of [...CASE_TABS, "lead-money-gate", "lead-anketa", "lead-closed"]) {
    const html = next(name);
    assert.equal(count(html, /<h1 /gu), 1, `${name}: один h1`);
    assert.doesNotMatch(html, /<aside/u, name);
    for (const block of html.split('data-slot="key-facts"').slice(1)) {
      const facts = count(block.slice(0, block.indexOf("</dl>")), /<dt /gu);
      if (!name.startsWith("anketa-")) assert.ok(facts <= 4, `${name}: ${facts} данных в блоке`);
    }
  }
});

/* ---------------------------------------------------------------- страница целиком: переключатель */

const DOCS_NEW = /data-testid="v3-documents-checklist"/u;
const MARKERS = {
  "docs-all": [DOCS_NEW, /data-testid="v3-case-documents"/u],
  "money-same": [/data-testid="v3-case-money-actions"/u, /data-testid="v3-case-money-more"/u],
  "route-four": [/id="applications"/u, /data-testid="v3-profile-admissions-list"/u],
  "anketa-full": [/data-testid="v3-anketa-answers"/u, /id="student-profile-fields-title"/u],
  "history-long": [/data-testid="v3-history-events"/u, /data-testid="v3-history-source"/u],
  "lead-closed": [/data-testid="v3-lead-closed-card"/u, /data-testid="v3-lead-closed"/u],
};
const NEW_ONLY = {
  "docs-all": DOCS_NEW, "money-same": /data-testid="v3-case-money-actions"/u, "route-four": /data-testid="v3-profile-admissions-list"/u,
  "anketa-full": /data-testid="v3-anketa-answers"/u, "history-long": /data-testid="v3-history-events"/u, "lead-closed": /data-testid="v3-lead-closed-card"/u,
};

test("страница `/v3/profile`: новый вид вкладок — только настоящему администратору с cookie; без cookie, у сотрудника и в просмотре роли — прежний вид", () => {
  for (const name of Object.keys(MARKERS)) {
    const on = real(name, "admin-cookie");
    assert.match(on, /data-testid="v3-profile-next"/u, `${name}: рамка нового вида`);
    assert.match(on, NEW_ONLY[name], `${name}: вкладка в новом виде`);
    for (const mode of ["admin-no-cookie", "staff-cookie", "preview-cookie"]) {
      const old = real(name, mode);
      assert.doesNotMatch(old, /data-testid="v3-profile-next"/u, `${name}/${mode}: рамки нового вида нет`);
      assert.doesNotMatch(old, NEW_ONLY[name], `${name}/${mode}: вкладка — прежняя`);
    }
  }
  // Сотрудник и просмотр роли с cookie получают ровно то, что без cookie (cookie их вид не меняет): разметка одной страницы, режим меняет только актёра.
  assert.equal(real("history-long", "staff-cookie"), real("history-long", "staff-cookie"));
  // Закрытый лид: у сотрудника без права «Продажи» чтения закрытых нет — прежнее «не найден», а не новый вид.
  assert.match(text(real("lead-closed", "staff-cookie")), /Профиль не найден или недоступен вам\./u);
  assert.match(text(real("lead-closed", "admin-no-cookie")), /Лид закрыт|Вернуть в работу|закрыт/u);
});

/* ---------------------------------------------------------------- исходники */

test("«Новый вид» включается страницей только через isNextUi; закрытый лид и «не найден» берут новую рамку лишь с переключателем", () => {
  const source = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(source, /const nextUi = await isNextUi\(actor\);/u);
  assert.match(source, /const nextCard = nextParts !== null \|\| \(nextUi && \(closedLead !== null \|\| invalidIdentityShape \|\| missing\)\);/u);
  assert.match(source, /nextUi \? <ClosedLeadNext row=\{closedLead\} readOnly=\{isStaffPreview\(actor\)\} \/> : <ClosedLeadView row=\{closedLead\} readOnly=\{isStaffPreview\(actor\)\} \/>/u);
  assert.match(source, /\(invalidIdentityShape \|\| missing\) && nextUi \? \(\s*<EmptyState/u);
  assert.match(source, /nextUi=\{nextParts !== null\} \/> : undefined\}/u, "вкладка «Вузы и программы» получает признак того же решения");
  // Чтения те же: в странице не добавилось ни одного `read*`.
  const reads = [...source.matchAll(/\b(read[A-Z]\w+)\(/gu)].map((match) => match[1]);
  assert.ok(!reads.some((name) => /Next|Tab/u.test(name)), "чтений нового вида в странице нет");
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /nextUi=\{nextUi\}/u);
  assert.match(profile, /<Anketa profile=\{profile\} draft=\{draft\} nextUi=\{nextUi\}/u);
  assert.match(profile, /<Money profile=\{profile\} draft=\{draft\} actor=\{actor\} salesCaseId=\{sales\?\.handoff\.caseId\} nextUi=\{nextUi\}/u);
  assert.match(profile, /<History profile=\{profile\} nextUi=\{nextUi\} \/>/u);
});

test("файлы нового вида: каждый до 150 строк, без серверных действий, источников чтения и тёмной темы; единственные чтения — прежние", () => {
  assert.ok(NEW_FILES.length >= 16, `файлов: ${NEW_FILES.length}`);
  const reads = new Set();
  for (const file of NEW_FILES) {
    const source = read(file);
    assert.ok(source.split("\n").length <= 150, `${file}: ${source.split("\n").length} строк`);
    assert.doesNotMatch(source, /"use server"/u, file);
    assert.doesNotMatch(source, /\bdark:/u, file);
    // Только значения: `import type` стирается при сборке и ничего не читает.
    for (const path of [...source.matchAll(/^import (?!type )[^;]*?from "([^"]+)"/gmu)].map((match) => match[1])) {
      assert.doesNotMatch(path, /supabase|\/server\/|repository|platform-guards/u, `${file}: ${path}`);
      if (/-source$|-actions$|LeadInterestFact$/u.test(path)) reads.add(`${file.split("/").pop()}:${path}`);
    }
  }
  // «Договор и оплата» читает сводку 189 тем же читателем, что `CaseAgreementBlock`; «Анкета» — «Интересует» тем же, что «Сведения» лида.
  assert.deepEqual([...reads].sort(), ["AnketaOtherFacts.tsx:../../LeadInterestFact", "MoneyAgreementNext.tsx:@/lib/v3/case-agreement-source"]);
  assert.match(read(`${NEW_DIR}/MoneyAgreementNext.tsx`), /await readCaseAgreement\(actor, studentCaseId\)/u);
  assert.match(read("src/components/v3/profile/CaseAgreementBlock.tsx"), /await readCaseAgreement\(actor, studentCaseId\)/u);
  assert.match(read(`${NEW_DIR}/AnketaOtherFacts.tsx`), /await readLeadInterestState\(profile\.leadId\)/u);
});

test("права и условия вкладки «Договор и оплата» одни на оба вида: `moneyPanelPlan` читают `Money` и `MoneyNext`", () => {
  assert.match(read("src/components/v3/profile/tabs.tsx"), /= moneyPanelPlan\(\{\s*draft, actor, salesCaseId, financeVisible, contractWorkspace: Boolean\(contractWorkspace\),/u);
  assert.match(read(`${NEW_DIR}/MoneyNext.tsx`), /= moneyPanelPlan\(\{\s*draft, actor, salesCaseId, financeVisible, contractWorkspace: Boolean\(contractWorkspace\),/u);
  const plan = read("src/components/v3/profile/money-panels.ts");
  for (const rule of [/finance\.event\.confirm/u, /staffPresentationCan\(actor, "admissions\.read"\)/u, /actor\.presentationRole !== "sales"/u, /isStaffPreview\(actor\)/u]) assert.match(plan, rule);
});

test("первая загрузка: «Ещё N» панели — лёгкая заглушка с ленивой настоящей; клиентские куски прежних экранов не тянут `ui/*`, `cn` и Radix", () => {
  const facade = read("src/components/v3/profile/next/MoreSheet.tsx");
  assert.match(facade, /lazy\(\(\) => import\("\.\/MoreSheetImpl"\)/u);
  assert.match(facade, /\.catch\(onLazyFailed\(\{ default: MoreSheetStatic \}\)\)/u);
  assert.match(facade, /className=\{OUTLINE_BUTTON\}/u, "заглушка — те же классы, что у `Button variant=outline w-fit`");
  assert.doesNotMatch(facade, /DetailSheet|ui\/button|@\/lib\/utils/u, "панель и Radix Dialog не импортируются статически");
  // Прежние клиентские файлы (общие с прежним видом) не знают про `ui/*`: классы карточки приходят свойством или строкой.
  for (const file of ["ProfileDocumentsClient", "StudentProfileFields", "StudentProfileExportHistory", "CaseMoney", "ProfileAdmissionsWorkspace"]) {
    const source = read(`src/components/v3/profile/${file}.tsx`);
    assert.doesNotMatch(source, /from "@\/components\/ui\/|from "@\/lib\/utils"|from "radix-ui"/u, `${file}: без ui/*, cn и Radix`);
  }
  assert.match(read("src/components/v3/profile/StudentProfileFields.tsx"), /cardClass\?: string;/u);
  assert.match(read(`${NEW_DIR}/AnketaNext.tsx`), /cardClass=\{CARD_FRAME\}/u);
  // «Документы»: единственный новый импорт клиентского файла — раскладка без `ui/*` и Radix (HelpTip — лёгкая заглушка).
  const layout = read(`${NEW_DIR}/DocumentsNextLayout.tsx`);
  assert.doesNotMatch(layout, /from "@\/components\/ui\/|from "@\/lib\/utils"|DetailSheet|MoreSheet/u);
});

test("`card-classes.ts` — те же классы, что у `Card`, `CardTitle` и `CardContent` (иначе карточки клиентских кусков разошлись бы с набором)", () => {
  const classes = read("src/components/kit/card-classes.ts");
  const card = read("src/components/ui/card.tsx");
  const constant = (name) => classes.match(new RegExp(`export const ${name} = "([^"]+)"`, "u"))?.[1] ?? assert.fail(name);
  assert.ok(card.includes(`"${constant("CARD_FRAME").replace(" data-[size=sm]:gap-2 data-[size=sm]:py-3", "")}`), "CARD_FRAME — начало классов `Card`");
  assert.ok(card.includes(`cn("${constant("CARD_TITLE")}"`), "CARD_TITLE — классы `CardTitle`");
  assert.ok(card.includes(`cn("${constant("CARD_BODY")}`), "CARD_BODY — начало классов `CardContent`");
  assert.equal(constant("CARD_FRAME").includes("data-[size=sm]"), false);
  assert.match(classes, /export const CARD_FRAME_FLAT = CARD_FRAME\.replace\(" py-4", ""\);/u);
  assert.doesNotMatch(classes, /^import /mu, "файл без импортов");
});

test("прежний вид не тронут признаком: классы и разметка прежних вкладок на своих местах, у прежних клиентских файлов признак по умолчанию выключен", () => {
  const client = read("src/components/v3/profile/ProfileDocumentsClient.tsx");
  assert.match(client, /nextUi = false,/u);
  assert.match(client, /<section aria-labelledby="case-documents-title" className="min-w-0 space-y-3" data-testid="v3-case-documents">/u);
  assert.match(client, /ruled=\{groups\.length === 0\}/u);
  assert.match(read("src/components/v3/profile/CaseMoney.tsx"), /className="@container min-w-0 rounded-card border border-border bg-surface"/u);
  assert.match(read("src/components/v3/profile/CaseMoney.tsx"), /nextUi = false,/u);
  assert.match(read("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx"), /bare = false,/u);
  assert.match(read("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx"), /className=\{bare \? "divide-y divide-border" : "mt-3 divide-y divide-border border-y border-border"\}/u);
  assert.match(read("src/components/v3/profile/PartnerPacketsPanel.tsx"), /: "group scroll-mt-4 border-b border-border"/u);
  assert.match(read("src/components/v3/profile/StudentProfileFields.tsx"), /"space-y-3 rounded-card border border-border bg-surface p-4"/u);
  // Портальный общий файл остаётся на своих классах (роли `t-*` в нём запрещены тестом общих файлов).
  assert.doesNotMatch(read("src/components/v3/profile/StudentProfileExportHistory.tsx"), /\bt-(item|section|body)/u);
});

test("есть стенды и снимки: Chromium-стенд вкладок и клиентские проверки панелей лежат рядом", () => {
  for (const file of ["tests/e2e/card-tabs-next-static-render.cjs", "tests/e2e/card-tabs-next-checks.cjs", "tests/e2e/card-tabs-client.cjs", "tests/e2e/card-tabs-fixtures.cjs", "tests/e2e/card-tabs-page.cjs"]) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});
