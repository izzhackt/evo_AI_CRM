// «Новый вид» (решение владельца 27.10.2026), поток «карточка»: карточка лида (`/v3/profile?id=…`) и дела студента
// (`/v3/profile?case=…`) из набора виджетов. Разметка — настоящей сборкой страницы на синтетических данных тех же
// сценариев, что у прежнего вида (tests/e2e/card-next-static-render.cjs --json, отдельный node-процесс); границы
// включения «нового вида» и размеры файлов — по исходникам. Это не живая проверка данных: чтения, права и серверные
// действия страницы те же, их проверяют прежние тесты. Снимки, фокус, 44 px и доступность — тот же harness с
// --screenshots; прежний вид байт в байт — прогон `--json` прежних harness до и после (в отчёте потока).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const pages = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/card-next-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const page = (name) => pages.get(name) ?? assert.fail(`нет сценария ${name}`);
const CASES = [...pages.keys()].filter((name) => name.startsWith("case-"));
const LEADS = [...pages.keys()].filter((name) => name.startsWith("lead-"));
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");

/** Первый блок `KeyFacts` страницы — сводка карточки: сколько в нём данных. */
function summaryFacts(html) {
  const start = html.indexOf('data-slot="key-facts"');
  assert.ok(start > 0, "в сводке есть блок ключевых данных");
  const block = html.slice(start, html.indexOf("</dl>", start));
  return [...block.matchAll(/<dt /gu)].length;
}

test("сценарии собираются: девять дел, семь лидов и три исхода «Интересует»", () => {
  assert.equal(CASES.length, 9);
  assert.equal(LEADS.length, 7);
  assert.equal([...pages.keys()].filter((name) => name.startsWith("widget-interest-")).length, 3);
});

test("каждая карточка — рамка нового вида, сводка, ряд вкладок-ссылок и виджеты без вложенных карточек", () => {
  for (const name of [...CASES, ...LEADS]) {
    const html = page(name);
    assert.match(html, /<main class="mx-auto w-full max-w-\[1240px\] px-4 pb-8 pt-4 sm:px-6" data-testid="v3-profile-next">/u, name);
    assert.equal([...html.matchAll(/<h1 /gu)].length, 1, `${name}: один h1`);
    assert.match(html, /data-testid="v3-(case|lead)-summary"/u, `${name}: сводка`);
    // Вкладки — настоящие ссылки `?tab=` с `aria-current`, а не вкладки на месте; прежнего ряда `v3-profile-tabs` нет.
    assert.match(html, /<nav aria-label="Разделы профиля"[^>]*>[\s\S]*?<a [^>]*aria-current="page"[^>]*>Обзор<\/a>/u, `${name}: вкладки-ссылки`);
    assert.doesNotMatch(html, /data-testid="v3-profile-tabs"/u, `${name}: прежнего ряда вкладок нет`);
    // Ряд принимает фокус сам (на него возвращается фокус после ответа на передачу), рамка вкладки внутри (`data-tab-strip`).
    assert.match(html, /<nav aria-label="Разделы профиля" tabindex="0" data-tab-strip=""/u, `${name}: ряд вкладок принимает фокус`);
    assert.ok([...html.matchAll(/data-slot="card"/gu)].length >= 4, `${name}: страница — набор карточек`);
    assert.doesNotMatch(html, /<aside/u, `${name}: «Сведения» — карточка, а не боковая колонка прежнего вида`);
  }
});

test("сводка несёт не больше четырёх данных, чем нет в данных — того нет на экране", () => {
  for (const name of [...CASES, ...LEADS]) assert.ok(summaryFacts(page(name)) <= 4, `${name}: ≤ 4 данных в строке`);
  // Дело без доступа к финансам: «Оплаты» в сводке нет (а не «0%» и не прочерк).
  assert.doesNotMatch(text(page("case-direct-case")), /Оплата/u);
  assert.match(text(page("case-admin")), /Оплата 40% оплачено/u);
  // Лид без телефона и почты: ни одной выдуманной строки (фикстура лида даёт телефон и почту — они есть).
  assert.match(page("lead-potential"), /href="tel:\+996000000002"/u);
  assert.match(page("lead-potential"), /href="mailto:lead@example\.invalid"/u);
});

test("лента: пять последних строк на странице, остальное — панелью «Ещё N»; короткая лента без панели", () => {
  const admin = page("case-admin");
  const list = admin.slice(admin.indexOf('data-testid="v3-case-feed-items"'));
  assert.equal([...list.slice(0, list.indexOf("</ol>")).matchAll(/<li /gu)].length, 5);
  assert.match(admin, /<button[^>]*data-testid="v3-feed-overflow"[^>]*>Ещё 14<\/button>/u);
  assert.match(admin, /aria-label="Ещё 14 в ленте"/u);
  const many = page("lead-many");
  assert.match(many, /data-testid="v3-feed-overflow"[^>]*>Ещё 2<\/button>/u);
  assert.equal([...many.slice(many.indexOf('data-testid="v3-lead-feed-items"'), many.indexOf("</ol>", many.indexOf('data-testid="v3-lead-feed-items"'))).matchAll(/<li /gu)].length, 5);
  assert.doesNotMatch(page("lead-early"), /v3-feed-overflow/u);
  assert.doesNotMatch(page("case-fresh"), /v3-feed-overflow/u);
  // Строки панели — те же `FeedRow`, что в прежней ленте; сама панель закрыта, её строк в разметке нет.
  assert.doesNotMatch(admin, /v3-feed-overflow-items/u);
});

test("предупреждения об ошибках и рисках остаются на виду", () => {
  assert.match(text(page("case-needs-curator")), /нужен куратор/u);
  assert.match(text(page("case-needs-curator")), /Назначить куратора/u);
  const unread = page("case-unread");
  assert.match(unread, /<p role="alert" class="t-body-compact text-danger">Не удалось загрузить задачи\. Обновите страницу, чтобы повторить\.<\/p>/u);
  assert.match(unread, /data-testid="v3-case-feed-unread">События журнала дела сейчас не прочитаны/u);
  assert.match(text(page("case-assign-only")), /Нет доступа к задачам этого дела\./u);
  assert.match(text(page("case-assign-only")), /Нет доступа к журналу этого дела\./u);
  assert.match(text(page("case-closed-outcome")), /Вернуть в работу/u);
  const calls = page("lead-early-calls-unavailable");
  assert.match(calls, /role="status"[^>]*data-testid="v3-calls-unavailable"/u);
  assert.match(text(calls), /Звонки не загрузились\./u);
  assert.match(text(page("lead-handed")), /Продажа в отчёте в архиве/u);
  // Пока ничего не подтверждено — слово состояния, и действие рядом кнопкой, а не молчание.
  const early = page("lead-early");
  assert.match(early, /data-testid="v3-handoff-empty">договор и первый платёж не подтверждены/u);
});

test("действия карточки те же, что у прежнего вида: главное одно, остальные нейтральные", () => {
  const accept = page("case-curator-accept");
  assert.match(accept, /data-testid="v3-case-actions"/u);
  assert.match(text(accept), /Принять дело/u);
  assert.match(text(accept), /Написать/u);
  assert.match(text(accept), /Задача по делу/u);
  const potential = page("lead-potential");
  assert.match(potential, /data-testid="v3-lead-actions"/u);
  assert.match(potential, /data-testid="v3-lead-primary"[^>]*>Оформить продажу</u);
  assert.match(text(potential), /Задача по лиду/u);
  // Красная заливка (`bg-primary` у кнопки) — только у главного действия страницы.
  assert.equal([...potential.matchAll(/data-variant="default"/gu)].length, 0, "кнопок набора с красной заливкой нет: красная — прежняя кнопка действия");
});

test("якоря и цели фокуса прежнего вида на месте: на них ссылаются события ленты и панели ответа", () => {
  const admin = page("case-admin");
  for (const id of ["case-header", "case-facts", "case-tasks", "case-feed", "portal-access", "sales-data"]) assert.match(admin, new RegExp(`id="${id}"`, "u"), id);
  // Фокус после ответа на передачу и после «Повторить» у звонков.
  assert.match(admin, /<h2[^>]*id="case-tasks-title"[^>]*tabindex="-1"/u);
  const lead = page("lead-early-calls-unavailable");
  assert.match(lead, /<h2[^>]*id="lead-feed-title"[^>]*tabindex="-1"/u);
  assert.match(lead, /id="sale-conditions"/u);
  assert.match(lead, /data-testid="v3-lead-header"/u);
});

test("пояснения ушли за «?»: на экране нет подсказки набора номера и ссылок-дублей вкладок", () => {
  const dial = page("lead-early-dial");
  assert.doesNotMatch(dial, /v3-dial-hint/u);
  assert.match(dial, /<button[^>]*aria-label="Пояснение: Позвонить"/u);
  for (const name of CASES) {
    const visible = text(page(name));
    for (const word of ["Открыть документы", "Открыть вузы и программы", "Открыть переписку", "Открыть договор и оплату"]) {
      assert.ok(!visible.includes(word), `${name}: нет «${word}»`);
    }
  }
});

test("«Интересует»: значение, сбой словами, и нет строки, когда направление не выбрано", () => {
  assert.match(page("widget-interest-value"), /data-testid="v3-lead-interest">Малайзия</u);
  assert.match(page("widget-interest-error"), /role="alert"[^>]*>не прочитано</u);
  assert.doesNotMatch(text(page("widget-interest-none")), /Интересует/u);
  for (const name of ["widget-interest-value", "widget-interest-error", "widget-interest-none"]) assert.match(text(page(name)), /Сведения/u);
});

test("«Новый вид» страницы включается только через isNextUi, данные и права не меняются", () => {
  const source = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(source, /import \{ isNextUi \} from "@\/lib\/ui-next";/u);
  assert.match(source, /const nextUi = await isNextUi\(actor\);/u);
  // Части прежнего вида строятся одним и тем же вызовом, признак в них не передаётся.
  assert.match(source, /caseWorkParts\(\{\s*actor,/u);
  assert.doesNotMatch(source, /nextUi[^;\n]*caseWorkParts|caseWorkParts\([^)]*nextUi/u);
  // «Новый вид» — только то, что вернул `isNextUi`: без cookie и для не-администратора `nextParts` пуст.
  assert.match(source, /const nextParts = nextUi\s*\? caseParts\?\.next \? caseNextParts\(caseParts\.next, caseParts\.actions\) : leadParts \? leadNextParts\(leadParts\.next\) : null\s*: null;/u);
  assert.match(source, /nextUi=\{nextParts !== null\}/u);
  // Прежняя рамка остаётся единственной при выключенном виде.
  // «Новый вид» рисует рамку и у закрытого лида и «не найден» (поток «card-tabs»); без переключателя `nextCard` пуст и рамка прежняя.
  assert.match(source, /const nextCard = nextParts !== null \|\| \(nextUi && \(closedLead !== null \|\| invalidIdentityShape \|\| missing\)\);/u);
  assert.match(source, /return nextCard \? \(\s*<ProfileNextShell[^>]*>\{content\}<\/ProfileNextShell>\s*\) : \(\s*<PartShell title=\{title\}/u);
  assert.match(source, /caseHeader=\{nextParts\?\.header \?\? caseParts\?\.header \?\? leadParts\?\.header \?\? undefined\}/u);
  // Данные страницы читаются теми же вызовами: в странице не добавилось ни одного чтения.
  const reads = [...source.matchAll(/\b(read[A-Z]\w+|loadV3ProfileRoute|loadStudentsCoverage|listStudentPortalActiveCurators)\(/gu)].map((match) => match[1]);
  assert.ok(!reads.some((name) => /Next|Interest/u.test(name)), "чтений нового вида в странице нет");
});

test("новый вид не читает и не пишет сам: в виджетах нет серверных действий, источников и Supabase", () => {
  const dir = "src/components/v3/profile/next";
  for (const file of readdirSync(new URL(`../${dir}`, import.meta.url)).filter((name) => name.endsWith(".tsx"))) {
    const source = read(`${dir}/${file}`);
    const imports = [...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);
    for (const path of imports) {
      // «Обращения студента» — то же чтение и то же действие, что у прежнего `CaseHelpWorkspace` / `CaseHelpPanel`; свои файлы карточки
      // нового вида нужны, чтобы общий с кабинетом студента `CaseHelpPanel` не тянул в кабинет карточку набора (+33 КБ gzip).
      if ((file === "CaseHelpCardImpl.tsx" && path === "@/lib/platform-admissions-support-actions") || (file === "CaseHelpCardWorkspace.tsx" && path === "@/lib/v3/case-operations-source")) continue;
      assert.doesNotMatch(path, /supabase|-actions$|\/server\/|repository|platform-guards/u, `${file}: ${path}`);
      // Единственное чтение — «Интересует», прежним читателем прежней строки.
      if (/-source$|LeadInterestFact$/u.test(path)) assert.ok(file === "LeadSideFacts.tsx" && path === "../LeadInterestFact", `${file}: ${path}`);
    }
    assert.doesNotMatch(source, /"use server"/u, file);
    // Файл UI — до 150 строк (CLAUDE.md, «Интерфейс CRM: правила архитектуры», п. 4).
    assert.ok(source.split("\n").length <= 150, `${file}: ${source.split("\n").length} строк`);
  }
});

test("«Обращения студента»: общий с кабинетом студента CaseHelpPanel не знает про новый вид; карточка — свои файлы и тот же читатель", () => {
  for (const file of ["src/components/v3/profile/CaseHelpPanel.tsx", "src/components/v3/profile/CaseHelpWorkspace.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /NamedCard|\bcard\s*=\s*false|\bcard\?:|\bcard=\{|from "\.\/next\//u, `${file}: ни NamedCard, ни свойства card, ни импортов из next/`);
  }
  const workspace = read("src/components/v3/profile/next/CaseHelpCardWorkspace.tsx");
  assert.match(workspace, /readCaseHelp\(actor, caseId\)\.catch\(\(\) => null\)/u, "то же чтение, что у CaseHelpWorkspace");
  assert.match(read("src/components/v3/profile/CaseHelpWorkspace.tsx"), /readCaseHelp\(actor, caseId\)\.catch\(\(\) => null\)/u);
  assert.match(read("src/components/v3/profile/next/CaseHelpCardImpl.tsx"), /loadCaseHelpAction\(page\.caseId, page\.nextCursor, false\)/u, "то же действие «Более ранние обращения», как у сотрудника в CaseHelpPanel");
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /\{nextUi\s*\? <CaseHelpCardWorkspace actor=\{actor\} caseId=\{caseTarget\.studentCaseId\} \/>\s*: <CaseHelpWorkspace actor=\{actor\} caseId=\{caseTarget\.studentCaseId\} \/>\}/u);
  const card = read("src/components/v3/profile/next/CaseHelpCard.tsx");
  assert.match(card, /lazy\(\(\) => import\("\.\/CaseHelpCardImpl"\)/u, "карточка подгружается лениво: её склейка классов и Radix не идут в первую загрузку профиля");
  assert.doesNotMatch(card, /NamedCard|@\/lib\/utils/u);
});

test("прежний вид не тронут признаком: вкладки профиля, шапка дела и «Лента» лида без `nextUi` рисуются как раньше", () => {
  const profile = read("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /<QueueTabStrip label="Разделы профиля" focusable testId="v3-profile-tabs">/u);
  assert.match(profile, /nextUi = false,/u);
  assert.match(profile, /tabs\.length > 1 && nextUi \? \(\s*<SectionTabs/u);
  // Пояснение «Подтверждение вручную» — абзацем в прежнем виде и за «?» в новом.
  // В «Новом виде» (поток «card-tabs») это карточка набора с пояснением за «?»; прежний раздел - тот же текст, что был.
  assert.match(profile, /<section id=\{LEAD_GATE_ANCHOR\} aria-labelledby=\{`\$\{LEAD_GATE_ANCHOR\}-title`\} className="max-w-3xl scroll-mt-4" data-testid="v3-lead-gate">\s*<h2 id=\{`\$\{LEAD_GATE_ANCHOR\}-title`\} className="t-section text-fg">Подтверждение вручную<\/h2>\s*<p className="mt-1 t-body-compact text-fg-2">/u);
  assert.match(profile, /<NamedCard title="Подтверждение вручную" id=\{LEAD_GATE_ANCHOR\} testId="v3-lead-gate"\s*help="Для передачи в поступление/u);
  // Шапка дела: без `bare` линии сверху и снизу ряда прежние.
  assert.match(read("src/components/v3/profile/CaseHeader.tsx"), /input\.bare \? "grid grid-cols-1 sm:flex sm:flex-wrap" : "grid grid-cols-1 border-y border-border sm:flex sm:flex-wrap"/u);
});

test("замечания ревью: «Передача» считает колонки по своей карточке, обращения - карточка с заголовком, шапка без второй линии", () => {
  // «Передача» в боковой колонке (22 rem): своя `@container`, иначе полоса из пяти колонок считается по ширине страницы.
  for (const name of ["lead-handed", "lead-potential"]) {
    assert.match(page(name), /class="[^"]*@container"[^>]*id="lead-handoff"/u, `${name}: «Передача» - своя @container`);
  }
  // «Обращения студента»: заголовок карточки (как у «Задач»), счёт у заголовка и «ждут ответа» справа; без прежней рамки-раскрытия.
  const help = page("case-admin-help");
  assert.match(help, /<h2 data-slot="card-title"[^>]*>Обращения студента<span[^>]*>2<\/span><\/h2>/u);
  assert.match(help, /data-testid="v3-case-help"[\s\S]*?ждут ответа: 1/u);
  assert.doesNotMatch(help, /<details[^>]*>\s*<summary[^>]*>\s*<span[^>]*>\s*<span[^>]*>Обращения студента/u);
  // Заголовок обращения - h3 сразу под заголовком карточки (h2), без пропуска уровня.
  assert.match(help, /<h3 class="break-words font-semibold text-fg">Не загружается скан паспорта<\/h3>/u);
  // Читатель «Ждут куратора» без права на дело: то же имя карточки и честное «нет доступа».
  assert.match(page("case-assign-only"), /<h2 data-slot="card-title"[^>]*>Обращения студента<\/h2>[\s\S]*?Нет доступа к обращениям этого дела\./u);
  assert.match(page("case-assign-only"), /data-testid="v3-case-help-forbidden"/u);
  assert.doesNotMatch(page("case-admin"), /Обращения студента/u, "чтения обращений нет - карточки нет");
  // «Назначить куратора» внутри сводки: своей нижней линии у обёртки нет (линия карточки одна); вне сводки - прежняя.
  const needs = page("case-needs-curator");
  const header = needs.slice(needs.indexOf('data-testid="v3-case-header"'), needs.indexOf("Назначить куратора"));
  assert.doesNotMatch(header, /border-b border-border pb-3/u);
  assert.match(read("src/components/v3/profile/CaseHeader.tsx"), /className=\{input\.bare \? undefined : "border-b border-border pb-3"\}/u);
  // 44 px цели телефона и «Сменить» выходят за строку (`-my-3`), только в новом виде; прежняя строка «Направление» не тронута.
  assert.match(page("lead-potential"), /<a href="tel:\+996000000002" class="-my-3 flex min-h-11/u);
  assert.match(read("src/components/v3/profile/next/CaseNext.tsx"), /caseFactValues\(source\.overview, \{ links: false, flush: true \}\)/u);
  assert.match(read("src/components/v3/profile/CaseDirection.tsx"), /className=\{flush \? `\$\{FACT_ACTION\} -my-3` : FACT_ACTION\}/u);
  assert.match(read("src/components/v3/profile/CaseOverview.tsx"), /requestId=\{input\.directionAction\.requestId\} flush=\{options\.flush\}/u);
});

test("«Ещё N»: ссылка строки на место страницы закрывает панель и не возвращает фокус на кнопку; вкладки профиля берут `focusable`", () => {
  // «Ещё N» подгружается лениво: `FeedOverflow` — заглушка с той же кнопкой, настоящая панель — в `FeedOverflowImpl`.
  const facade = read("src/components/v3/profile/next/FeedOverflow.tsx");
  assert.match(facade, /lazy\(\(\) => import\("\.\/FeedOverflowImpl"\)/u);
  assert.match(facade, /aria-label=\{`Ещё \$\{count\} в ленте`\} data-testid="v3-feed-overflow"/u, "заглушка называется и находится так же, как настоящая кнопка");
  assert.doesNotMatch(facade, /DetailSheet|ui\/button/u, "панель и Radix Dialog не импортируются статически");
  const overflow = read("src/components/v3/profile/next/FeedOverflowImpl.tsx");
  assert.match(overflow, /open=\{open\}/u);
  assert.match(overflow, /closest\('a\[href\^="#"\]'\)/u);
  assert.match(overflow, /onCloseAutoFocus=\{\(event\) => \{\s*if \(!toAnchor\.current\) return;/u);
  // Возврат фокуса остался прежним для Esc и крестика: `DetailSheet` зовёт чужой обработчик первым и уважает `preventDefault`.
  assert.match(read("src/components/kit/DetailSheet.tsx"), /onCloseAutoFocus\?\.\(event\);[\s\S]*?if \(event\.defaultPrevented\) return;/u);
  assert.match(read("src/components/v3/profile/Profile.tsx"), /<SectionTabs\s+label="Разделы профиля"\s+focusable\s+value=\{current\}/u);
  assert.match(read("src/components/kit/SectionTabs.tsx"), /<QueueViewTabs\s+label=\{label\}\s+focusable=\{focusable\}/u);
  assert.match(read("src/components/v3/queue/QueueViewTabs.tsx"), /<QueueTabStrip id=\{id\} label=\{label\} focusable=\{focusable\}>/u);
});
