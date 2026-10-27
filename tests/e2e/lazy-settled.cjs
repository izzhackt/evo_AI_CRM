"use strict";

/**
 * В клиентских стендах (createRoot без SSR) ленивые куски нового вида (`HelpTip`, `FeedOverflow`, `CaseHelpCard`) сначала
 * рисуют заглушку — ту же кнопку без обработчиков, — и лишь потом настоящую (Radix). Нажатие по заглушке ничего не открывает, а
 * в сборке с SSR React доигрывает такое нажатие после гидрации. Стенд ждёт, пока заглушек на странице не останется:
 * у настоящей кнопки есть `data-slot` (`popover-trigger`, `button`), у заглушки нет.
 */
const PLACEHOLDERS = '[aria-label^="Пояснение"]:not([data-slot]), [data-testid="v3-feed-overflow"]:not([data-slot])';

async function lazySettled(page) {
  await page.waitForFunction((selector) => !document.querySelector(selector), PLACEHOLDERS, { timeout: 15_000 });
}

module.exports = { lazySettled };
