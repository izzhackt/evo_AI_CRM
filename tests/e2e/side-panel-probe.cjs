"use strict";

/**
 * Замеры одной боковой панели (Э7, `SidePanel`) в Chromium — один набор для
 * всех экранов: «Задачи», «Быстрый просмотр» и «Нагрузка кураторов»
 * «Студентов», «Заявки», «Отчёт продаж», панель лида «Воронки продаж».
 * Его зовёт режим `--f1` статических рендеров этих экранов
 * (tests/e2e/*-static-render.cjs); снимки — `.impeccable/review/f1-*.png`
 * (не коммитятся), замеры — JSON-строки в stdout.
 *
 * Что меряется на открытой панели: облик страницы (`data-look`), ширина и
 * положение (`--side-panel-width`), режим (рядом со списком — `show()`, уже
 * 1280 px — модальный `showModal()`), фокус на заголовке записи после
 * открытия, роль заголовка `t-record-title`, закрытие (от 768 px — крестик в
 * углу шапки, на телефоне — «← К …»), выбранная строка (`aria-current`,
 * подложка) и то, что она видна рядом с панелью, верх панели вровень с верхом
 * списка, переполнение вбок, текст мельче 12 px и сплошной красный внутри
 * панели. Путь в гидратированном дереве (`journey`): шапка не уезжает, когда
 * прокручено тело (от 768 px; на телефоне — полоса «← К …»); Esc закрывает
 * панель и возвращает фокус на строку; открытие строкой — снова фокус на
 * заголовке; в поле панели первая Esc только выводит из поля (введённое
 * цело), вторая закрывает; Esc в окне поверх панели («Закрыть лид»,
 * «Завершить дело») закрывает только окно — панель, адрес и введённое
 * остаются; закрытие ссылкой «Закрыть» / «← К …» — фокус снова
 * на строке; у модального листа фон инертен, а на планшете затемнение
 * закрывает лист, щелчок по самому листу — нет. Нарушение — исключение с
 * фактами.
 */

const PANEL = "dialog[data-side-panel]";

/** Выполняется в странице: снимок открытой панели и списка рядом. */
function measure(selectedSelector) {
  const dialog = document.querySelector("dialog[data-side-panel]");
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  if (!dialog) return { panel: null, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  const style = getComputedStyle(dialog);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const token = style.getPropertyValue("--side-panel-width").trim();
  const heading = dialog.querySelector("[data-queue-heading]");
  const close = dialog.querySelector('[data-testid="queue-detail-close"]');
  const open = dialog.querySelector("[data-side-panel-open]");
  const selected = selectedSelector ? document.querySelector(selectedSelector) : null;
  const panelBox = box(dialog);
  const selectedBox = box(selected);
  const small = [...dialog.querySelectorAll("*")].filter((element) => {
    if (![...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())) return false;
    return visible(element) && parseFloat(getComputedStyle(element).fontSize) < 12;
  }).length;
  return {
    viewport: window.innerWidth,
    look: document.querySelector(".v3-world")?.getAttribute("data-look") ?? "current",
    modal: dialog.matches(":modal"),
    position: style.position,
    panel: panelBox,
    token,
    tokenPx: token.endsWith("rem") ? parseFloat(token) * rem : null,
    headingFocused: document.activeElement === heading,
    headingRole: heading ? [...heading.classList].find((name) => name.startsWith("t-")) ?? null : null,
    headingSize: heading ? getComputedStyle(heading).fontSize : null,
    close: close ? { name: (close.innerText.trim() || close.getAttribute("aria-label") || "").replace(/\s+/gu, " "), box: box(close) } : null,
    openLink: open ? open.textContent.trim() : null,
    selected: selected ? {
      ariaCurrent: selected.matches('[aria-current="true"]') || Boolean(selected.querySelector('[aria-current="true"]')),
      background: getComputedStyle(selected).backgroundColor,
      box: selectedBox,
    } : null,
    // Рядом со списком выбранная строка не уходит под панель.
    selectedBeside: selectedBox && !dialog.matches(":modal") ? selectedBox.right <= panelBox.left : null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    textUnder12: small,
    solidRedInPanel: [...dialog.querySelectorAll("a, button")].filter((element) => visible(element)
      && getComputedStyle(element).backgroundColor === "rgb(215, 2, 23)").length,
  };
}

/**
 * Выполняется в странице: верх панели рядом со списком относительно верха
 * первой колонки той же сетки (список, доска). Панель липнет к окну
 * (`sticky`), поэтому мерить — при прокрутке в начало; прокрутка
 * возвращается.
 */
function columnTopDelta() {
  const dialog = document.querySelector("dialog[data-side-panel]");
  if (!dialog || dialog.matches(":modal")) return null;
  // Обёртка `display: contents` (стенд «Отчёта») не участвует в сетке: соседи — у её родителя.
  let item = dialog;
  while (item.parentElement && getComputedStyle(item.parentElement).display === "contents") item = item.parentElement;
  const grid = item.parentElement;
  const column = grid ? [...grid.children].find((child) => child !== item && child.getClientRects().length > 0) : null;
  if (!column) return null;
  const scrolled = [];
  for (let node = grid; node; node = node.parentElement) {
    if (node.scrollTop > 0) { scrolled.push([node, node.scrollTop]); node.scrollTop = 0; }
  }
  const root = document.scrollingElement;
  const rootTop = root ? root.scrollTop : 0;
  if (root) root.scrollTop = 0;
  const delta = Math.round(dialog.getBoundingClientRect().top - column.getBoundingClientRect().top);
  if (root) root.scrollTop = rootTop;
  for (const [node, top] of scrolled) node.scrollTop = top;
  return delta;
}

/** Выполняется в странице: что сейчас в фокусе. */
function focusFacts(returnSelector) {
  const active = document.activeElement;
  const target = returnSelector ? document.querySelector(returnSelector) : null;
  return {
    onReturnTarget: Boolean(target) && active === target,
    tag: active?.tagName ?? null,
    text: (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim().replace(/\s+/gu, " ").slice(0, 60),
    inPanel: Boolean(active?.closest("dialog[data-side-panel]")),
    panelOpen: Boolean(document.querySelector("dialog[data-side-panel]")),
  };
}

/**
 * Выполняется в странице: шапка не уезжает, когда тело панели прокручено до
 * конца. От 768 px прокручивается тело (`data-side-panel-body`), и заголовок
 * с крестиком стоят на месте; на телефоне прокручивается весь лист, и на месте
 * стоит полоса «← К …». Прокрутку в начало возвращает `resetScroll`.
 */
async function scrollBody() {
  const dialog = document.querySelector("dialog[data-side-panel]");
  const body = dialog?.querySelector("[data-side-panel-body]");
  if (!dialog || !body) return null;
  const phone = window.innerWidth < 768;
  const scroller = phone ? dialog : body;
  const heading = dialog.querySelector("[data-queue-heading]");
  const close = dialog.querySelector('[data-testid="queue-detail-close"]');
  const top = (element) => Math.round(element.getBoundingClientRect().top);
  const inView = (element) => {
    const rect = element.getBoundingClientRect();
    const panel = dialog.getBoundingClientRect();
    return rect.height > 0 && rect.top >= Math.max(0, panel.top) - 1 && rect.bottom <= Math.min(window.innerHeight, panel.bottom) + 1;
  };
  const scrollable = scroller.scrollHeight - scroller.clientHeight > 8;
  const before = { heading: top(heading), close: top(close) };
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = { heading: top(heading), close: top(close), headingInView: inView(heading), closeInView: inView(close), scrollTop: Math.round(scroller.scrollTop) };
  return { phone, scrollable, before, after, dialogScrolls: dialog.scrollHeight - dialog.clientHeight > 8 };
}

/** Выполняется в странице: прокрутка листа и тела панели — в начало. */
function resetScroll() {
  const dialog = document.querySelector("dialog[data-side-panel]");
  const body = dialog?.querySelector("[data-side-panel-body]");
  if (dialog) dialog.scrollTop = 0;
  if (body) body.scrollTop = 0;
}

/** Выполняется в странице: у модального листа элемент за ним не получает фокус. */
function backgroundInert() {
  const dialog = document.querySelector("dialog[data-side-panel]");
  if (!dialog || !dialog.matches(":modal")) return null;
  const outside = [...document.querySelectorAll("a[href], button")].find((element) => !dialog.contains(element) && element.getClientRects().length > 0);
  if (!outside) return null;
  const before = document.activeElement;
  outside.focus();
  const blocked = document.activeElement !== outside;
  if (before instanceof HTMLElement) before.focus();
  return blocked;
}

const waitClosed = (page) => page.waitForSelector(PANEL, { state: "detached", timeout: 10_000 });
const waitOpen = (page) => page.waitForSelector(PANEL, { state: "attached", timeout: 10_000 });

/** Поле ввода панели, в котором можно печатать: первое видимое и доступное. */
const FIELD = `${PANEL} :is(textarea, input[type="text"], input[type="search"], input:not([type])):not([disabled]):not([readonly])`;

/** Выполняется в странице: адрес стенда — `location` и переходы `router.push` (`__staticPushes`). */
function addressFacts() {
  return { href: location.href, pushes: (globalThis.__staticPushes || []).length };
}

/** Выполняется в странице: окно поверх панели — открыто ли и модально ли. */
function overlayFacts(selector) {
  const dialog = document.querySelector(selector);
  return { present: Boolean(dialog), open: Boolean(dialog?.open), modal: Boolean(dialog?.matches(":modal")) };
}

/** Выполняется в странице: где фокус и что в поле после Esc. */
function fieldFacts(marker) {
  const dialog = document.querySelector("dialog[data-side-panel]");
  const field = document.querySelector("[data-f1-field]");
  return {
    panelOpen: Boolean(dialog?.open),
    headingFocused: Boolean(dialog) && document.activeElement === dialog.querySelector("[data-queue-heading]"),
    fieldFocused: document.activeElement === field,
    kept: Boolean(field) && field.value.includes(marker),
  };
}

/**
 * Путь по гидратированному экрану: открытая по адресу панель → шапка при
 * прокрутке → Esc → фокус на строке → открыть строку (`reopen`) → фокус на
 * заголовке → поле: Esc, Esc → строка → открыть → «Закрыть» (или «← К …» на
 * телефоне) → фокус на строке; на планшете — ещё щелчок по листу (открыт) и
 * по затемнению (закрыт, фокус на строке). `returnSelector` — строка (ссылка
 * «Открыть»), куда панель возвращает фокус; `look` — ожидаемый облик
 * («current» или «next»); `scrolledPath` — снимок с прокрученным телом;
 * `overlay` — окно поверх панели: `open()` открывает его из панели,
 * `dialog` — его селектор (поле → окно → Esc: закрыто только окно).
 */
async function journey(page, { selected, returnSelector, reopen, look, scrolledPath, overlay = null }) {
  const failures = [];
  const expect = (label, ok, facts) => { if (!ok) failures.push(`${label}: ${JSON.stringify(facts)}`); };
  const settleOpen = async () => { await waitOpen(page); await page.waitForTimeout(250); };
  const settleClosed = async () => { await waitClosed(page); await page.waitForTimeout(100); };
  await settleOpen();
  const opened = await page.evaluate(measure, selected);
  expect("the page renders the expected look", opened.look === look, { look: opened.look, expected: look });
  expect("the panel takes focus on its record heading when opened by the address", opened.headingFocused, opened);
  expect("the heading is the record title role", opened.headingRole === "t-record-title", opened);
  const wide = opened.viewport >= 1280;
  const phone = opened.viewport < 768;
  expect(wide ? "beside the list from 1280px: non-modal" : "below 1280px: a modal sheet", opened.modal === !wide, opened);
  expect("the panel is the token wide (or the whole phone)", phone
    ? opened.panel.width === opened.viewport
    : Math.abs(opened.panel.width - opened.tokenPx) <= 1, opened);
  if (!phone) {
    expect("from 768px the close control is the corner cross «Закрыть»", opened.close?.name === "Закрыть"
      && opened.close.box.right <= opened.panel.right && opened.close.box.right >= opened.panel.right - 16
      && opened.close.box.top - opened.panel.top <= 16, opened.close);
  } else {
    expect("on a phone the close control is «← К …»", /^К /u.test(opened.close?.name ?? ""), opened.close);
  }
  if (wide) {
    expect("the selected row stays visible beside the panel", opened.selected?.ariaCurrent && opened.selectedBeside, opened);
    opened.columnTopDelta = await page.evaluate(columnTopDelta);
    expect("the panel starts level with the list beside it", opened.columnTopDelta !== null && Math.abs(opened.columnTopDelta) <= 1, { columnTopDelta: opened.columnTopDelta });
  }
  if (!phone) expect("the sheet slides in from the right edge", opened.panel.right === opened.viewport || wide, opened.panel);
  expect("no sideways overflow", opened.overflowX <= 0, opened);
  expect("no text under 12px in the panel", opened.textUnder12 === 0, opened);
  expect("no solid red inside the panel: the page keeps one main action", opened.solidRedInPanel === 0, opened);
  const inert = await page.evaluate(backgroundInert);
  if (!wide) expect("the page behind the sheet is inert", inert === true, { inert });

  // Шапка при прокрутке тела: заголовок и крестик на месте (на телефоне — полоса «← К …»).
  const header = await page.evaluate(scrollBody);
  if (header?.scrollable && scrolledPath) await page.screenshot({ path: scrolledPath });
  await page.evaluate(resetScroll);
  if (header?.scrollable) {
    if (header.phone) {
      expect("on a phone the «← К …» bar stays on top while the sheet scrolls", header.after.closeInView && Math.abs(header.after.close - header.before.close) <= 1 && header.after.scrollTop > 0, header);
    } else {
      expect("from 768px the header stays put while the body scrolls", !header.dialogScrolls
        && Math.abs(header.after.heading - header.before.heading) <= 1 && Math.abs(header.after.close - header.before.close) <= 1
        && header.after.headingInView && header.after.closeInView && header.after.scrollTop > 0, header);
    }
  }
  await page.evaluate(() => document.querySelector("dialog[data-side-panel] [data-queue-heading]")?.focus({ preventScroll: true }));

  // Esc: с фокусом на заголовке (как после открытия).
  await page.keyboard.press("Escape");
  await settleClosed();
  const afterEsc = await page.evaluate(focusFacts, returnSelector);
  expect("Esc closes the panel and returns focus to the row", afterEsc.onReturnTarget, afterEsc);

  // Открыть снова строкой: фокус — на заголовке.
  await reopen();
  await settleOpen();
  const reopened = await page.evaluate(measure, selected);
  expect("opening from the row focuses the record heading", reopened.headingFocused, reopened);

  // Поле панели: первая Esc только выводит из поля, введённое цело; вторая закрывает.
  let typing = null;
  const field = page.locator(FIELD).filter({ visible: true }).first();
  if (await field.count()) {
    const marker = " Э7";
    await field.evaluate((element) => element.setAttribute("data-f1-field", ""));
    await field.click();
    await page.keyboard.type(marker);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const first = await page.evaluate(fieldFacts, marker);
    await page.keyboard.press("Escape");
    await settleClosed();
    const second = await page.evaluate(focusFacts, returnSelector);
    typing = { first, second };
    expect("the first Esc in a panel field keeps the panel open and the typed text", first.panelOpen && first.kept && !first.fieldFocused && first.headingFocused, first);
    expect("the second Esc closes the panel and returns focus to the row", second.onReturnTarget, second);
    await reopen();
    await settleOpen();
  }

  // Окно поверх панели: Esc закрывает только его — панель, её адрес и введённое остаются.
  let over = null;
  if (overlay) {
    const overField = page.locator(FIELD).filter({ visible: true }).first();
    const hasField = await overField.count() > 0;
    const marker = " Э7 окно";
    if (hasField) {
      await page.evaluate(() => document.querySelector("[data-f1-field]")?.removeAttribute("data-f1-field"));
      await overField.evaluate((element) => element.setAttribute("data-f1-field", ""));
      await overField.click();
      await page.keyboard.type(marker);
    }
    const address = await page.evaluate(addressFacts);
    await overlay.open();
    await page.waitForSelector(overlay.dialog, { state: "visible", timeout: 10_000 });
    const shown = await page.evaluate(overlayFacts, overlay.dialog);
    await page.keyboard.press("Escape");
    await page.waitForSelector(overlay.dialog, { state: "detached", timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    const after = {
      overlay: await page.evaluate(overlayFacts, overlay.dialog),
      field: hasField ? await page.evaluate(fieldFacts, marker) : null,
      panelOpen: await page.evaluate(() => Boolean(document.querySelector("dialog[data-side-panel]")?.open)),
      address: await page.evaluate(addressFacts),
      focus: await page.evaluate(focusFacts, returnSelector),
    };
    over = { hasField, address, shown, after };
    expect("the overlay step first types into a panel field", hasField, over);
    expect("the overlay opens as a modal dialog over the panel", shown.open && shown.modal, over);
    expect("Esc in a dialog over the panel closes only that dialog: the panel, its address and the typed text stay",
      !after.overlay.open && after.panelOpen && after.address.href === address.href && after.address.pushes === address.pushes
        && Boolean(after.field?.kept), over);
    // Нарушение уже записано: панель открывается снова, чтобы путь дошёл до конца.
    if (!after.panelOpen) { await reopen(); await settleOpen(); }
  }

  // «Закрыть» (от 768 px — крестик, на телефоне — «← К …»).
  await page.locator(`${PANEL} [data-testid="queue-detail-close"]`).click();
  await settleClosed();
  const afterClose = await page.evaluate(focusFacts, returnSelector);
  expect("the close link returns focus to the row", afterClose.onReturnTarget, afterClose);

  // Планшет: щелчок по самому листу его не закрывает, по затемнению — закрывает.
  let backdrop = null;
  if (!wide && !phone) {
    await reopen();
    await settleOpen();
    const panel = await page.evaluate(() => {
      const header = document.querySelector("dialog[data-side-panel] [data-side-panel-header]").getBoundingClientRect();
      return { left: header.left, bottom: header.bottom };
    });
    await page.mouse.click(panel.left + 4, panel.bottom - 4);
    await page.waitForTimeout(150);
    const stays = await page.evaluate(() => Boolean(document.querySelector("dialog[data-side-panel]")?.open));
    await page.mouse.click(24, Math.round(opened.panel.height / 2));
    await settleClosed();
    const afterBackdrop = await page.evaluate(focusFacts, returnSelector);
    backdrop = { stays, afterBackdrop };
    expect("a click on the sheet itself keeps it open", stays, backdrop);
    expect("a click on the dimmed page closes the sheet and returns focus to the row", afterBackdrop.onReturnTarget, afterBackdrop);
  }
  return { opened, inert, header, afterEsc, reopened: { headingFocused: reopened.headingFocused, modal: reopened.modal }, typing, overlay: over, afterClose, backdrop, failures };
}

/**
 * Тонкая замена `next/link` для браузерных сборок `--f1` (тот же приём, что
 * у boards-static-render.cjs): та же разметка `<a>`, обычный щелчок идёт в
 * `router.push` из контекста — стенд меняет адрес и перерисовывает экран, как
 * сервер. `onClick` компонента с `preventDefault()` (доска) оставляет всё ему.
 */
const LINK_SHIM = `
const React = require("react");
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime");
const ONLY = new Set(["prefetch", "scroll", "replace", "shallow", "locale", "passHref", "legacyBehavior", "onNavigate", "as", "unstable_dynamicOnHover"]);
function Link(props) {
  const router = React.useContext(AppRouterContext);
  const rest = {};
  for (const [key, value] of Object.entries(props)) if (!ONLY.has(key) && key !== "href" && key !== "onClick") rest[key] = value;
  const href = String(props.href);
  return React.createElement("a", { ...rest, href, onClick(event) {
    if (props.onClick) props.onClick(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    router.push(href);
  } });
}
module.exports = Link;
module.exports.default = Link;
module.exports.__esModule = true;
`;

/** Плагин esbuild: `next/link` → `LINK_SHIM` (`root` — где искать react). */
function linkShim(root) {
  return {
    name: "side-panel-link-shim",
    setup(build) {
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "side-panel-link" }));
      build.onLoad({ filter: /.*/, namespace: "side-panel-link" }, () => ({ contents: LINK_SHIM, resolveDir: root, loader: "js" }));
    },
  };
}

/** Ширины снимков F1: широкий ноутбук, ноутбук, планшет (лист справа) и телефон. */
const F1_WIDTHS = [
  ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  ["1024", { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 }],
  ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];


/** Строка отчёта F1 и сбор нарушений по всем снимкам. */
function report(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

module.exports = { PANEL, measure, focusFacts, backgroundInert, journey, LINK_SHIM, linkShim, F1_WIDTHS, report };
