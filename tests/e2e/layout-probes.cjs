"use strict";

/**
 * Измерения вёрстки, общие для стендов «Нового вида» (Chromium). Выполняются в странице: `page.evaluate(probe)`.
 * Они проверяют то, что не видно по классам и по снимкам глазами: куда на самом деле встал блок и сколько места занимает страница.
 */

/**
 * Шапки карточек (`[data-slot=card-header]` с заголовком и `[data-slot=card-action]`), в которых действие или бейдж ушли под заголовок,
 * хотя заголовок и действие целиком помещаются в одну строку: «короткие действия и бейджи остаются рядом» (DESIGN.md, `WidgetCard`).
 * Настоящая ширина заголовка и действия измеряется без сжатия и переноса, поэтому условие не зависит от того, на сколько рем
 * рассчитывал автор шапки. Перенос длинного действия под заголовок (когда вместе не помещаются) не нарушение.
 */
function headerWrapViolations() {
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const out = [];
  for (const header of document.querySelectorAll("[data-slot=card-header]")) {
    const action = header.querySelector(":scope > [data-slot=card-action]");
    const group = header.firstElementChild;
    if (!action || !group || group === action || !visible(header) || !visible(action) || !visible(group)) continue;
    const saved = [group.style.cssText, action.style.cssText];
    group.style.flex = "0 0 auto";
    action.style.flex = "0 0 auto";
    action.style.flexWrap = "nowrap";
    const natural = { title: group.getBoundingClientRect().width, action: action.getBoundingClientRect().width };
    [group.style.cssText, action.style.cssText] = saved;
    const style = getComputedStyle(header);
    const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 0;
    const wrapped = action.getBoundingClientRect().top >= group.getBoundingClientRect().bottom - 1;
    if (wrapped && natural.title + gap + natural.action <= room - 0.5) {
      out.push({ title: (group.textContent || "").trim().slice(0, 40), action: (action.textContent || "").trim().slice(0, 40), title_w: Math.round(natural.title), action_w: Math.round(natural.action), room: Math.round(room) });
    }
  }
  return out;
}

/**
 * Пустая полоса под страницей: высота документа больше нижнего края корня приложения (и окна). Её даёт абсолютно расположенный
 * потомок (`sr-only`), у которого нет позиционированного предка, — он считает опорой `body` и выпадает из области прокрутки таблицы.
 */
function blankBandBelowRoot(rootSelector) {
  const root = document.querySelector(rootSelector);
  const rootBottom = root ? Math.round(root.getBoundingClientRect().bottom + window.scrollY) : 0;
  const scrollHeight = document.scrollingElement.scrollHeight;
  const allowed = Math.max(rootBottom, window.innerHeight);
  return { scrollHeight, rootBottom, band: Math.max(0, scrollHeight - allowed), ok: scrollHeight <= allowed + 1 };
}

/**
 * Таблицы, которые на этой ширине режутся краем: таблица шире области прокрутки или карточки, в которой лежит (последний столбец виден не
 * весь), либо шире окна. Волна 2A нашла так «Суммы» и «Поступления и возвраты» на 360 и 320: столбец «Итого» уходил за край карточки без
 * подсказки о прокрутке. `scroll: true` — таблицу можно прокрутить в своей области (область с `role="region"` и `tabindex=0`), это тоже
 * учитывается: на 360 и 320 допустимо только то, что дизайн страницы задумал, а не то, что осталось от широкой раскладки.
 */
function clippedTables() {
  const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  const out = [];
  const viewport = document.documentElement.clientWidth;
  for (const table of document.querySelectorAll("main table")) {
    if (!visible(table)) continue;
    let hit = null;
    // Ближайшая область, которая прокручивает или обрезает содержимое: таблице в ней тесно, если область шире окна не стала, а таблица в неё не влезла.
    for (let holder = table.parentElement; holder && holder !== document.body; holder = holder.parentElement) {
      const overflow = getComputedStyle(holder).overflowX;
      if (overflow === "visible") continue;
      const over = Math.round(holder.scrollWidth - holder.clientWidth);
      if (over > 1) hit = { holder: `${holder.tagName.toLowerCase()}${holder.getAttribute("role") ? `[role=${holder.getAttribute("role")}]` : ""}`, over, scroll: /auto|scroll/u.test(overflow) };
      break;
    }
    // Области нет: таблица не должна выходить за окно.
    const right = table.getBoundingClientRect().right;
    if (!hit && right > viewport + 1) hit = { holder: "viewport", over: Math.round(right - viewport), scroll: false };
    if (hit) out.push({ ...hit, label: (table.closest("[aria-label]")?.getAttribute("aria-label") || table.querySelector("th")?.textContent || "").trim().slice(0, 40), columns: table.querySelectorAll("thead th").length });
  }
  return out;
}

module.exports = { headerWrapViolations, blankBandBelowRoot, clippedTables };
