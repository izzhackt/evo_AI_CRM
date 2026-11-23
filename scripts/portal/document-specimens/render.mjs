#!/usr/bin/env node
// Нарисованные образцы документов для справки «Образец и советы» (23.11.2026): HTML этой папки -> JPG в
// public/portal/document-samples (<имя>-1.jpg до 1300 px и миниатюра <имя>-1-t.jpg 240 px, без метаданных).
// Данные вымышленные, логотипов, гербов, печатей и подписей нет: официальные образцы брать нельзя
// (docs/design/v3/references/2026-11-23-document-specimens.md). Правка образца — правка HTML и повторный запуск:
//   node scripts/portal/document-specimens/render.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../../public/portal/document-samples");
const NAMES = ["bank-statement", "ielts", "hsk", "csca", "birth-certificate"];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  for (const name of NAMES) {
    await page.goto(pathToFileURL(path.join(here, `${name}.html`)).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const sheet = document.querySelector(".sheet");
      return sheet ? sheet.scrollHeight > sheet.clientHeight + 1 : true;
    });
    if (overflow) throw new Error(`${name}: the content does not fit the A4 sheet`);
    const png = await page.locator(".sheet").screenshot();
    const full = path.join(out, `${name}-1.jpg`);
    const thumb = path.join(out, `${name}-1-t.jpg`);
    await sharp(png).resize({ width: 1300, height: 1300, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 64 }).toFile(full);
    await sharp(png).resize({ width: 240, height: 240, fit: "inside" }).jpeg({ quality: 60 }).toFile(thumb);
    console.log(`${name}-1.jpg и миниатюра записаны`);
  }
} finally {
  await browser.close();
}
