"use strict";

/**
 * Замеры одной боковой панели (Э7, `SidePanel`) в Chromium — один набор для
 * всех экранов: «Задачи», «Быстрый просмотр» и «Нагрузка кураторов»
 * «Студентов», «Заявки», «Отчёт продаж», панель лида «Воронки продаж».
 * Его зовёт режим `--f1` статических рендеров этих экранов
 * (tests/e2e/*-static-render.cjs); снимки — `.impeccable/review/f1-*.png`
 * (не коммитятся), замеры — JSON-строки в stdout.
 *
 * Что меряется на открытой панели: ширина и положение (`--side-panel-width`),
 * режим (рядом со списком — `show()`, уже 1280 px — модальный `showModal()`),
 * фокус на заголовке записи после открытия, роль заголовка `t-record-title`,
 * выбранная строка (`aria-current`, подложка) и то, что она видна рядом с
 * панелью, переполнение вбок, текст мельче 12 px и сплошной красный внутри
 * панели. Путь в гидратированном дереве (`journey`): Esc закрывает панель и
 * возвращает фокус на строку; открытие строкой — снова фокус на заголовке;
 * закрытие ссылкой «Закрыть» / «← К …» — фокус снова на строке; у модального
 * листа фон инертен. Нарушение — исключение с фактами.
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

/**
 * Путь по гидратированному экрану: открытая по адресу панель → Esc → фокус
 * на строке → открыть строку (`reopen`) → фокус на заголовке → «Закрыть»
 * (или «← К …» на листе) → фокус на строке. `returnSelector` — строка
 * (ссылка «Открыть»), куда панель возвращает фокус.
 */
async function journey(page, { selected, returnSelector, reopen }) {
  const failures = [];
  const expect = (label, ok, facts) => { if (!ok) failures.push(`${label}: ${JSON.stringify(facts)}`); };
  await waitOpen(page);
  await page.waitForTimeout(250);
  const opened = await page.evaluate(measure, selected);
  expect("the panel takes focus on its record heading when opened by the address", opened.headingFocused, opened);
  expect("the heading is the record title role", opened.headingRole === "t-record-title", opened);
  const wide = opened.viewport >= 1280;
  expect(wide ? "beside the list from 1280px: non-modal" : "below 1280px: a modal sheet", opened.modal === !wide, opened);
  expect("the panel is the token wide (or the whole phone)", opened.viewport < 768
    ? opened.panel.width === opened.viewport
    : Math.abs(opened.panel.width - opened.tokenPx) <= 1, opened);
  if (wide) expect("the selected row stays visible beside the panel", opened.selected?.ariaCurrent && opened.selectedBeside, opened);
  expect("no sideways overflow", opened.overflowX <= 0, opened);
  expect("no text under 12px in the panel", opened.textUnder12 === 0, opened);
  expect("no solid red inside the panel: the page keeps one main action", opened.solidRedInPanel === 0, opened);
  const inert = await page.evaluate(backgroundInert);
  if (!wide) expect("the page behind the sheet is inert", inert === true, { inert });

  // Esc: с фокусом на заголовке (как после открытия).
  await page.keyboard.press("Escape");
  await waitClosed(page);
  await page.waitForTimeout(100);
  const afterEsc = await page.evaluate(focusFacts, returnSelector);
  expect("Esc closes the panel and returns focus to the row", afterEsc.onReturnTarget, afterEsc);

  // Открыть снова строкой: фокус — на заголовке.
  await reopen();
  await waitOpen(page);
  await page.waitForTimeout(250);
  const reopened = await page.evaluate(measure, selected);
  expect("opening from the row focuses the record heading", reopened.headingFocused, reopened);

  // «Закрыть» (рядом со списком — крестик, на листе — «← К …»).
  await page.locator(`${PANEL} [data-testid="queue-detail-close"]`).click();
  await waitClosed(page);
  await page.waitForTimeout(100);
  const afterClose = await page.evaluate(focusFacts, returnSelector);
  expect("the close link returns focus to the row", afterClose.onReturnTarget, afterClose);
  return { opened, inert, afterEsc, reopened: { headingFocused: reopened.headingFocused, modal: reopened.modal }, afterClose, failures };
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

/** Ширины снимков F1: ноутбук, широкий ноутбук и телефон. */
const F1_WIDTHS = [
  ["1440", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ["1280", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  ["390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];

/** Строка отчёта F1 и сбор нарушений по всем снимкам. */
function report(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

module.exports = { PANEL, measure, focusFacts, backgroundInert, journey, LINK_SHIM, linkShim, F1_WIDTHS, report };
