"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Проверки в Chromium для tests/e2e/chats-next-static-render.cjs --screenshots: страницы «WhatsApp», «Переписка» и рамка
 * переписки по делу в «Новом виде» на 1440, 1280, 390 (и 360, 320 для боковой прокрутки). Движок чатов настоящий; серверные
 * действия и опрос отвечают синтетикой этого файла, ничего не отправляется.
 */
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { lazySettled } = require("./lazy-settled.cjs");

const READ_ONLY_LINE = "Только чтение: отвечайте в amoCRM или Wazzup.";

async function run({ VIEWPORTS, NARROW, FIXTURE_ID, compileCss, buildBundle, pageFixtures, fx }) {
  const ROOT = resolve(__dirname, "../..");
  const args = process.argv.slice(2);
  const next = args[args.indexOf("--screenshots") + 1];
  const outDir = resolve(next && !next.startsWith("--") ? next : join(ROOT, ".impeccable/review"));
  mkdirSync(outDir, { recursive: true });
  await buildBundle(join(outDir, "chats-next-bundle.js"));
  const css = await compileCss();
  const fixtures = await pageFixtures();
  const pages = {};
  for (const [name, fixture] of Object.entries(fixtures)) {
    const path = join(outDir, `${name}.html`);
    writeFileSync(path, `<!DOCTYPE html><html lang="ru" data-theme="light" class="h-full antialiased"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><title>${fixture.title}, новый вид (синтетические данные)</title><style>${css}</style></head><body class="min-h-full"><div id="root"></div><script type="application/json" id="${FIXTURE_ID}">${JSON.stringify({ ...fixture, actor: fx.ACTORS.admin }).replaceAll("<", "\\u003c")}</script><script src="chats-next-bundle.js"></script></body></html>`);
    pages[name] = path;
  }

  const { chromium } = require("playwright");
  const AxeBuilder = require("@axe-core/playwright").default;
  const browser = await chromium.launch();
  let failed = false;
  const report = (check, ok, detail) => {
    if (!ok) failed = true;
    console.log(JSON.stringify({ check, ok, detail }));
  };
  async function open(name, key, viewports = VIEWPORTS) {
    const context = await browser.newContext({ ...viewports[key], reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error" && !/notifications\/state|127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to load resource/u.test(message.text())) errors.push(message.text()); });
    await page.goto(pathToFileURL(pages[name]).href, { waitUntil: "load" });
    await page.waitForSelector("html[data-ready=true]", { state: "attached", timeout: 15_000 });
    await lazySettled(page);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    return { context, page, errors };
  }
  const shot = (page, name, options = {}) => page.screenshot({ path: join(outDir, `${name}.png`), ...options });
  const harness = (page) => page.evaluate(() => window.__harness);
  /** Radix возвращает фокус чуть позже, чем окно уходит из дерева: ждём, а не читаем сразу. */
  const focusReturned = async (locator) => {
    const handle = await locator.elementHandle();
    return handle.evaluate((element) => new Promise((done) => {
      const start = Date.now();
      const poll = () => (document.activeElement === element ? done(true) : Date.now() - start > 2000 ? done(false) : setTimeout(poll, 25));
      poll();
    }));
  };

  /** Общие замеры: боковая прокрутка, один h1, цели ≥ 44 px, текст ≥ 12 px, красные кнопки, правило шапки оболочки. */
  const metrics = (page) => page.evaluate(() => {
    const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none"; };
    const main = document.querySelector("main");
    const h1s = [...document.querySelectorAll("h1")];
    const targets = [...main.querySelectorAll("a, button, input:not([type=hidden]), textarea, select, [role=combobox]")]
      .filter((element) => visible(element) && !element.closest("[popover]") && !element.matches("[aria-label^=Пояснение]"))
      .filter((element) => element.getBoundingClientRect().height < 43.5 && element.tagName !== "TEXTAREA")
      .map((element) => (element.getAttribute("aria-label") ?? element.textContent.trim()).slice(0, 30) + `:${Math.round(element.getBoundingClientRect().height)}`);
    const texts = [...main.querySelectorAll("*")].filter((element) => visible(element) && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()));
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      h1: h1s.map((element) => element.textContent.trim()),
      h1Shown: h1s.some((element) => element.parentElement.parentElement.getBoundingClientRect().height > 1),
      small: targets,
      under12: texts.filter((element) => parseFloat(getComputedStyle(element).fontSize) < 12).map((element) => element.textContent.trim().slice(0, 20)),
      red: [...main.querySelectorAll("a, button")].filter((element) => visible(element) && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").map((element) => element.textContent.trim().slice(0, 20)),
      headerRule: main.matches(":has(> div:first-child > div:first-child > h1.t-page-title)"),
      world: Boolean(main.closest('.v3-world[data-ui="next"]')),
      textareas: [...document.querySelectorAll("main textarea")].filter(visible).length,
      mainHeight: Math.round(main.getBoundingClientRect().height),
    };
  });
  const axeCheck = async (page) => (await new AxeBuilder({ page }).include("main").analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);

  // 1. Все сцены на трёх ширинах: боковая прокрутка, h1, цели, текст, красный, шапка, мир, axe, консоль.
  const SCENES = Object.keys(pages);
  for (const key of Object.keys(VIEWPORTS)) {
    for (const name of SCENES) {
      const { context, page, errors } = await open(name, key);
      const m = await metrics(page);
      await shot(page, `${name}-${key}`);
      const label = `${name} ${key}`;
      const title = fixtures[name].title;
      const phoneOpen = key === "m390" && (name.startsWith("inbox-") ? Boolean(fixtures[name].props.view?.selected) : fixtures[name].props.selectedCaseId);
      report(`${label}: no horizontal scroll`, m.overflowX <= 0, m.overflowX);
      report(`${label}: one h1 «${title}»`, m.h1.length === 1 && m.h1[0].startsWith(title), m.h1);
      report(`${label}: h1 ${phoneOpen ? "only for the reader" : "shown"}`, m.h1Shown === !phoneOpen, m.h1Shown);
      report(`${label}: header matches shell rules, inside the new-view world`, m.headerRule && m.world, [m.headerRule, m.world]);
      report(`${label}: targets >= 44px`, m.small.length === 0, m.small);
      report(`${label}: text >= 12px`, m.under12.length === 0, m.under12);
      report(`${label}: no solid red button on the page`, m.red.length === 0, m.red);
      const violations = await axeCheck(page);
      report(`${label}: axe`, violations.length === 0, violations);
      const state = await harness(page);
      report(`${label}: console clean, no unexpected server actions`, errors.length === 0 && state.errors.length === 0, [...errors, ...state.errors]);
      await context.close();
    }
  }
  // 1б. 360 и 320: боковой прокрутки нет (длинное имя в списке и в шапке).
  for (const key of Object.keys(NARROW)) {
    for (const name of ["inbox-chat-long-name", "inbox-list", "inbox-wazzup-read-only", "messages-cabinet", "messages-thread-long-name", "inbox-not-connected"]) {
      const { context, page } = await open(name, key, NARROW);
      const m = await metrics(page);
      report(`${name} ${key}: no horizontal scroll, targets >= 44px`, m.overflowX <= 0 && m.small.length === 0, [m.overflowX, m.small]);
      if (name === "inbox-chat-long-name") {
        await shot(page, `${name}-${key}`);
        const header = await page.locator("[data-testid=v3-inbox-thread] header").boundingBox();
        report(`${name} ${key}: a long name does not blow up the thread header`, header.height <= 190, header);
      }
      if (name === "messages-thread-long-name") {
        const header = await page.locator("[data-testid=case-chat-thread-header]").boundingBox();
        report(`${name} ${key}: a long name does not blow up the conversation header`, header.height <= 230, header);
      }
      await context.close();
    }
  }

  // 2. «WhatsApp»: список, строки, «Сортировка», «?», поиск; строка открывает диалог.
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open("inbox-list", key);
    const rows = await page.locator("[data-testid=v3-inbox-row]").count();
    report(`inbox list ${key}: rows = conversations`, rows === fx.WA_ROWS.length, rows);
    const facts = await page.locator("[data-testid=v3-inbox-row]").first().innerText();
    report(`inbox list ${key}: first row = name, time, number, waiting (4 facts)`, /Аружан Примерова[\s\S]*06\.10 13:40[\s\S]*\+996[\s\S]*Ждёт ответа · 20 мин/u.test(facts), facts);
    const form = await page.evaluate(() => { const f = document.querySelector("form[role=search]"); return { action: f.getAttribute("action"), method: f.getAttribute("method"), input: f.querySelector("input[name=q]")?.getAttribute("placeholder"), button: f.querySelector("button[type=submit]")?.getAttribute("aria-label") }; });
    report(`inbox list ${key}: search is the same GET form`, form.action === "/v3/inbox" && form.method === "get" && form.input === "Имя, телефон или тема" && form.button === "Найти", form);
    // Строка — ссылка на диалог: мышь и клавиатура.
    await page.locator("[data-testid=v3-inbox-row] a").nth(2).click();
    report(`inbox list ${key}: a row opens its conversation`, (await harness(page)).pushes.at(-1) === `/v3/inbox?conversation=${fx.waId(3)}`, (await harness(page)).pushes);
    await page.locator("[data-testid=v3-inbox-row] a").nth(1).focus();
    await page.keyboard.press("Enter");
    report(`inbox list ${key}: Enter on a focused row opens it`, (await harness(page)).pushes.at(-1) === `/v3/inbox?conversation=${fx.waId(2)}`, (await harness(page)).pushes);
    const ring = await page.locator("[data-testid=v3-inbox-row] a").nth(1).evaluate((element) => { const style = getComputedStyle(element); return { style: style.outlineStyle, width: style.outlineWidth }; });
    report(`inbox list ${key}: focus ring is visible on a row`, ring.style !== "none" && parseFloat(ring.width) > 0, ring);
    // «Сортировка»: меню внутри корня нового вида, Esc возвращает фокус на кнопку, пункты — ссылки.
    const trigger = page.getByRole("button", { name: /Сортировка/u });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu").waitFor();
    const menu = await page.evaluate(() => { const element = document.querySelector("[data-slot=dropdown-menu-content]"); const background = getComputedStyle(element).backgroundColor; return { inside: Boolean(element.closest('.v3-world[data-ui="next"]')), opaque: !/rgba\(0, 0, 0, 0\)|transparent/u.test(background), items: [...element.querySelectorAll("a")].map((a) => `${a.textContent.trim()}=${a.getAttribute("href")}${a.getAttribute("aria-current") ? "*" : ""}`) }; });
    report(`inbox list ${key}: sort menu inside the world, opaque, two links, current marked`, menu.inside && menu.opaque && menu.items.join("|") === "Сначала новые=/v3/inbox*|Неотвеченные=/v3/inbox?sort=unanswered", menu);
    if (key === "d1280") await shot(page, `inbox-list-sort-menu-${key}`);
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    report(`inbox list ${key}: Esc closes the sort menu and returns focus to its button`, await focusReturned(trigger), null);
    // «?» шапки: пояснение уходит за значок, Esc закрывает и возвращает фокус.
    const help = page.getByRole("button", { name: "Пояснение: WhatsApp" });
    await help.click();
    const popover = page.locator("[data-slot=popover-content]");
    await popover.waitFor();
    report(`inbox list ${key}: «?» opens the explanation`, /Неотвеченные/u.test(await popover.innerText()), await popover.innerText());
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });
    report(`inbox list ${key}: Esc closes «?» and returns focus`, await focusReturned(help), null);
    await context.close();
  }

  // 3. «WhatsApp»: «Неотвеченные», пустые состояния, «не подключён», беда канала на виду.
  {
    const { context, page } = await open("inbox-list-unanswered", "d1280");
    const value = await page.getByRole("button", { name: /Сортировка/u }).innerText();
    report("unanswered: sort button names the current order", /неотвеченные/u.test(value), value);
    report("unanswered: hidden sort field in the search form", await page.locator("form[role=search] input[name=sort][value=unanswered]").count() === 1, null);
    await context.close();
  }
  for (const [name, expected, absent] of [["inbox-empty-filtered", "По выбранным условиям диалогов нет", false], ["inbox-empty-paged", "На этой странице диалогов нет", true]]) {
    for (const key of ["d1280", "m390"]) {
      const { context, page } = await open(name, key);
      const text = await page.locator("[data-testid=v3-inbox-empty]").innerText();
      report(`${name} ${key}: empty list says why`, text.includes(expected), text);
      const clear = await page.locator("[data-testid=v3-inbox-clear-filters]").count();
      report(`${name} ${key}: «Сбросить фильтры» only for a search`, absent ? clear === 0 : clear === 1, clear);
      if (absent) report(`${name} ${key}: «← К новым» is a link`, await page.locator("[data-testid=v3-inbox-queue-newest]").count() === 1, null);
      await context.close();
    }
  }
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open("inbox-not-connected", key);
    const text = await page.locator("[data-testid=v3-inbox-not-connected]").innerText();
    report(`not connected ${key}: honest state and the settings link for the administrator`, /WhatsApp не подключён к CRM — подключает Администратор/u.test(text) && await page.locator("[data-testid=v3-inbox-settings]").getAttribute("href") === "/v3/settings?section=integrations", text);
    report(`not connected ${key}: no count in the title`, !/\d/u.test(await page.locator("h1").innerText()), await page.locator("h1").innerText());
    await context.close();
  }
  {
    const { context, page } = await open("inbox-list-attention", "d1280");
    const band = page.locator("[data-testid=v3-inbox-channel-status]");
    report("channel attention: the warning band is visible above the list", await band.isVisible() && /WhatsApp требует проверки/u.test(await band.innerText()), await band.innerText());
    await context.close();
    for (const name of ["inbox-chat-attention", "inbox-wazzup-attention"]) {
      const session = await open(name, "d1280");
      const line = session.page.locator("[data-testid=v3-inbox-thread-channel]");
      report(`${name}: the warning is visible in the thread header`, await line.isVisible() && /WhatsApp требует проверки/u.test(await line.innerText()), await line.innerText());
      await session.context.close();
    }
  }

  // 4. Диалог: шапка, «Назад» на телефоне, прежний движок чата (лента и поле), «Позвонить» и «Карточка лида».
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open("inbox-chat", key);
    const header = await page.locator("[data-testid=v3-inbox-thread] header").innerText();
    report(`chat ${key}: header = name, stage, waiting, number`, /Аружан Примерова[\s\S]*Квалифицирован[\s\S]*Ждёт ответа · 20 мин[\s\S]*\+996/u.test(header), header);
    const profile = await page.locator("[data-testid=v3-inbox-profile-link]").evaluate((a) => ({ href: a.getAttribute("href") ?? "", text: a.textContent.trim() }));
    report(`chat ${key}: profile link kept`, profile.text.length > 0, profile);
    const profileBox = await page.locator("[data-testid=v3-inbox-profile-link]").boundingBox();
    report(`chat ${key}: the profile link is a labelled icon on a phone and a labelled button on a desktop`, key === "m390" ? profileBox.width <= 46 && await page.locator("[data-testid=v3-inbox-profile-link]").getAttribute("title") === profile.text : profileBox.width > 90, profileBox);
    report(`chat ${key}: the engine renders the feed and the reply field`, await page.locator("[data-testid=v3-inbox-chat] [role=log]").count() === 1 && await page.locator("[data-testid=v3-inbox-chat] textarea").count() === 1, null);
    const back = page.getByRole("link", { name: "Назад к списку диалогов" });
    report(`chat ${key}: «Назад» only on the phone`, (await back.isVisible()) === (key === "m390"), null);
    if (key === "m390") {
      await back.click();
      report("chat m390: «Назад» goes to the list address", (await harness(page)).pushes.at(-1) === "/v3/inbox", (await harness(page)).pushes);
    }
    const composerIn = await page.evaluate(() => { const box = document.querySelector("[data-testid=v3-inbox-chat] textarea").getBoundingClientRect(); return box.bottom <= window.innerHeight; });
    report(`chat ${key}: the reply field is inside the window`, composerIn, null);
    await context.close();
  }
  // Длинное имя: и в списке, и в шапке не раздвигает страницу (боковая прокрутка меряется выше); шапка называет номер.
  {
    const { context, page } = await open("inbox-chat-long-name", "m390");
    const h2 = await page.locator("[data-testid=v3-inbox-thread] h2").boundingBox();
    report("long name m390: the name fits the header", h2 !== null && h2.x + h2.width <= 390, h2);
    await context.close();
  }

  // 5. Wazzup: только чтение. Нет поля ответа, нет «Отправить», нет окна ИИ; одна строка; подпись ответа продавца;
  //    рамка не вызывает отправку и не обращается к WAHA/Wazzup.
  for (const key of ["d1280", "m390"]) {
    for (const name of ["inbox-wazzup-read-only", "inbox-wazzup-attention"]) {
      const { context, page } = await open(name, key);
      const line = page.locator("[data-testid=v3-inbox-reply-unavailable]");
      report(`${name} ${key}: the read-only line replaces the field`, await line.isVisible() && (await line.innerText()).trim() === READ_ONLY_LINE && await line.getAttribute("data-reason") === "receive_only", await line.innerText());
      const send = await page.evaluate(() => ({
        textareas: document.querySelectorAll("main textarea").length,
        sendButtons: [...document.querySelectorAll("main button, main a")].filter((element) => /^(Отправить|Отправить сообщение|Шаблон)$/u.test(element.textContent.trim()) || /Отправить/u.test(element.getAttribute("aria-label") ?? "")).length,
        assistant: document.querySelectorAll("[data-testid^=v3-inbox-ai], [data-ai-space]").length,
        echo: [...document.querySelectorAll('[data-testid="v3-inbox-message"][data-origin="wazzup"] p.t-meta > span')].map((element) => element.textContent.trim()),
        origins: [...document.querySelectorAll('[data-testid="v3-inbox-message"]')].map((element) => element.dataset.origin),
      }));
      report(`${name} ${key}: no field, no send button, no AI window`, send.textareas === 0 && send.sendButtons === 0 && send.assistant === 0, send);
      report(`${name} ${key}: the seller's reply is signed «отправлено в amoCRM/Wazzup»`, send.echo.length === 1 && /amoCRM\/Wazzup/u.test(send.echo[0]) && send.origins.join() === "client,wazzup,client", send);
      await page.waitForTimeout(250);
      const state = await harness(page);
      report(`${name} ${key}: nothing was sent, checked or written`, state.actions.length === 0 && state.errors.length === 0, state.actions);
      if (name === "inbox-wazzup-read-only") await shot(page, `${name}-full-${key}`);
      await context.close();
    }
  }
  report("the new frame imports nothing of WAHA, Wazzup, the connect route or the send actions", await (async () => {
    const { readFileSync, readdirSync } = require("node:fs");
    const dirs = ["inbox-next", "case-chat-next", "chats-next"].map((dir) => join(ROOT, "src/components/v3", dir));
    const imports = dirs.flatMap((dir) => readdirSync(dir).map((file) => readFileSync(join(dir, file), "utf8"))).flatMap((source) => source.match(/^import [^;]*from "[^"]+";$/gmu) ?? []);
    return imports.length > 20 && imports.every((line) => !/waha|wazzup|whatsapp-connect|provider-actions|platform-whatsapp/iu.test(line));
  })(), null);

  // 6. «Переписка»: очереди, поиск, строка открывает переписку, шапка, состояние переписки, пустая правая часть, сбой.
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open("messages-cabinet", key);
    const queues = await page.locator("[data-testid=case-chat-queues] button").evaluateAll((buttons) => buttons.map((b) => `${b.textContent.trim()}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`));
    report(`cabinet ${key}: queues with counts, current marked`, queues.join("|") === "Нужен ответ3*|Ждём студента2|Все", queues);
    const tops = await page.locator("[data-testid=case-chat-queues] button").evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    report(`cabinet ${key}: the three queues stand in one row`, new Set(tops).size === 1, tops);
    const rows = await page.locator("[data-case-chat-row] .t-item").allInnerTexts();
    report(`cabinet ${key}: rows come in the order of the read (oldest waiting first)`, rows.join("|") === "Нурай Образцова|Лейла Тестовая|Данияр Макетов", rows);
    const first = await page.locator("[data-case-chat-row]").first().innerText();
    report(`cabinet ${key}: row = name, time, last phrase and marks`, /Нурай Образцова[\s\S]*Добрый день! Какие документы нужны для визы\?/u.test(first), first);
    if (key === "d1280") report("cabinet d1280: the right side names the next conversation", /Следующий: Нурай Образцова — ждёт 2 дн/u.test(await page.locator("[data-testid=case-chat-next]").innerText()), await page.locator("[data-testid=case-chat-next]").innerText());
    await page.locator("[data-case-chat-row]").nth(1).click();
    report(`cabinet ${key}: a row opens its conversation`, (await harness(page)).pushes.at(-1) === `/v3/messages?queue=needs_reply&case=${fx.caseId(4)}` || (await harness(page)).pushes.at(-1)?.includes(`case=${fx.caseId(4)}`), (await harness(page)).pushes);
    // Очередь: прежний движок перечитывает список (адрес — состояние), число и выбранное обновляются.
    await page.getByRole("button", { name: /Ждём студента/u }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="case-chat-queues"] button[aria-pressed="true"]')?.textContent.startsWith("Ждём студента"));
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    const after = await harness(page);
    const rowsAfter = await page.locator("[data-case-chat-row] .t-item").allInnerTexts();
    report(`cabinet ${key}: the queue switch re-reads the list by the engine`, after.actions.some((action) => action.startsWith("load:awaiting_student")) && after.urls.some((url) => url.includes("queue=awaiting_student")) && rowsAfter.includes("Алина Условная"), [after.actions, after.urls, rowsAfter]);
    // Поиск: через 250 мс движок читает список по запросу.
    await page.getByRole("searchbox", { name: "Поиск по студенту" }).fill("Алина");
    await page.waitForFunction(() => window.__harness.actions.some((action) => action.endsWith(":Алина")), null, { timeout: 5_000 });
    report(`cabinet ${key}: search goes through the engine`, (await harness(page)).urls.some((url) => url.includes("q=")), (await harness(page)).urls);
    await context.close();
  }
  for (const key of ["d1280", "m390"]) {
    const { context, page } = await open("messages-thread", key);
    const facts = await page.locator("[data-testid=case-chat-case-facts]").innerText();
    report(`thread ${key}: direction and stage`, facts.replace(/\s+/gu, " ").trim() === "Китай · Документы", facts);
    const awaitControl = await page.locator("[data-testid=case-chat-await-control] button").evaluateAll((buttons) => buttons.map((b) => `${b.textContent.trim()}${b.getAttribute("aria-pressed") === "true" ? "*" : ""}`));
    report(`thread ${key}: the await control has three states, «Нужен ответ» pressed`, awaitControl.join("|") === "Нужен ответ*|Ждём студента|Не требуется", awaitControl);
    const tone = await page.locator("[data-testid=case-chat-await-control] button[aria-pressed=true]").getAttribute("data-tone");
    report(`thread ${key}: the pressed state is a warning tone, not red`, tone === "warn", tone);
    const back = page.getByRole("link", { name: "К списку" });
    report(`thread ${key}: «К списку» only on the narrow screen`, (await back.isVisible()) === (key === "m390"), null);
    report(`thread ${key}: «Открыть дело» keeps its address`, await page.getByRole("link", { name: "Открыть дело" }).getAttribute("href") === `/v3/profile?case=${fx.caseId(1)}`, null);
    report(`thread ${key}: the engine renders the reply field and the feed`, await page.locator('form[aria-label="Новое сообщение"] textarea').count() === 1 && await page.locator('[aria-label="История переписки"]').count() === 1, null);
    report(`thread ${key}: the page itself does not scroll`, (await metrics(page)).overflowY <= 0, null);
    // Переключатель состояния — прежняя команда `set_await`, список перечитывается: 3·2 → 2·3.
    await page.evaluate(() => { window.__harness.actions.length = 0; });
    await page.locator("[data-testid=case-chat-await-control] button", { hasText: "Ждём студента" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="case-chat-await-control"] button[aria-pressed="true"]')?.textContent === "Ждём студента");
    if (key === "d1280") await page.waitForFunction(() => document.querySelector('[data-queue-count="needs_reply"]')?.textContent === "2", null, { timeout: 5_000 }).catch(() => {});
    const done = await harness(page);
    report(`thread ${key}: the await control calls the previous command and the list is re-read`, done.actions[0] === `await:awaiting_student:${fx.caseId(1)}` && done.actions.some((action) => action.startsWith("load:")), done.actions);
    if (key === "d1280") report("thread d1280: counts after the change are 2·3", (await page.locator("[data-testid=case-chat-queues] button").allInnerTexts()).map((text) => text.replace(/\s+/gu, " ")).slice(0, 2).join("|") === "Нужен ответ 2|Ждём студента 3", await page.locator("[data-testid=case-chat-queues] button").allInnerTexts());
    await shot(page, `messages-thread-await-${key}`);
    await context.close();
  }
  for (const name of ["messages-failure", "messages-forbidden"]) {
    const { context, page } = await open(name, "d1280");
    const alert = page.locator("[data-testid=case-chat-error]");
    const text = await alert.innerText();
    report(`${name}: the alert says what happened and offers to reload`, await alert.getAttribute("role") === "alert" && (name === "messages-forbidden" ? /Доступ к перепискам изменился/u.test(text) : /Не удалось загрузить переписки/u.test(text)) && /Обновить страницу/u.test(text), text);
    report(`${name}: the reload link keeps the address`, await alert.getByRole("link", { name: "Обновить страницу" }).getAttribute("href") === "/v3/messages", await alert.getByRole("link").getAttribute("href"));
    await context.close();
  }
  {
    const { context, page } = await open("messages-answered", "d1280");
    report("answered d1280: the empty queue and the right side say it once each", /Нет переписок, ждущих ответа\./u.test(await page.locator("nav[aria-label='Переписки кабинета студента']").innerText()) && (await page.locator("[data-testid=case-chat-next]").innerText()).trim() === "Все ответы даны", null);
    await context.close();
  }

  await browser.close();
  if (failed) { console.error("chats-next checks failed"); process.exit(1); }
}

module.exports = { run };
