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

module.exports = { headerWrapViolations, blankBandBelowRoot };
