"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

const { renderToStaticMarkup } = require("react-dom/server");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `renderToStaticMarkup` для дерева с ленивыми кусками (`next/dynamic` и `React.lazy`): модуль грузится асинхронно,
 * поэтому первый рендер либо бросает «suspended while responding to synchronous input» (ленивый корень без Suspense),
 * либо рисует заглушку (`HelpTip`, `FeedOverflow`). Рендерим, пока две отдачи подряд не совпадут: так разметка не
 * зависит от того, успела ли загрузиться ленивая часть.
 */
async function renderSettled(node, { attempts = 40, waitMs = 15 } = {}) {
  let previous = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let html = null;
    try {
      html = renderToStaticMarkup(node);
    } catch (error) {
      if (!/suspended while responding to synchronous input/u.test(String(error?.message))) throw error;
    }
    if (html !== null && html === previous) return html;
    previous = html;
    await pause(waitMs);
  }
  throw new Error("renderSettled: разметка не устоялась");
}

module.exports = { renderSettled };
