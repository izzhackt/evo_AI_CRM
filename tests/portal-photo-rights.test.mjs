import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * Кнопка «©» на фото (план 4.4, контракт 2.5; review S3 веба F13 и N3): у
 * фото мест автор, источник и лицензия, источник всегда ссылкой на страницу
 * файла; у официальных медиа вуза «Фото: <вуз>, официальный сайт». Панель
 * закрывается Escape и нажатием вне неё, открыта одна на странице.
 */

const ROOT = new URL("../", import.meta.url);
const sourcePath = new URL("src/components/portal/universities/PhotoRights.tsx", ROOT);
const source = readFileSync(sourcePath, "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const componentModule = { exports: {} };
new Function("require", "module", "exports", code)(createRequire(sourcePath), componentModule, componentModule.exports);
const { PhotoRights } = componentModule.exports;

const strings = {
  photoRights: "Автор и лицензия фото",
  photoCredit: "Фото: {author}, {license}",
  photoCreditSource: "Фото: {author}, {source}, {license}",
  photoCreditOfficial: "Фото: {university}, официальный сайт",
  newTab: "(в новой вкладке)",
};
const render = (props) => renderToStaticMarkup(createElement(PhotoRights, { strings, placement: "top", ...props }));
const visible = (html) => html.replace(/<span class="pt-sr-only">[^<]*<\/span>/gu, "").replace(/<[^>]+>/gu, "");

test("a place photo with an author page links author, source and licence", () => {
  const html = render({ credit: {
    kind: "author", author: "Devymex", authorUrl: "https://commons.wikimedia.org/wiki/User:Devymex",
    license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/File:Example.jpg" },
  } });
  assert.equal(visible(html).replace("©", "").trim(), "Фото: Devymex, Wikimedia Commons, CC BY-SA 3.0");
  for (const href of ["https://commons.wikimedia.org/wiki/User:Devymex", "https://commons.wikimedia.org/wiki/File:Example.jpg",
    "https://creativecommons.org/licenses/by-sa/3.0/"]) {
    assert.ok(html.includes(`href="${href}" target="_blank" rel="noopener noreferrer"`), href);
  }
  assert.match(html, /<details class="pt-photo-rights pt-photo-rights-top">/u);
  assert.match(html, /<summary class="pt-photo-rights-btn" aria-label="Автор и лицензия фото"/u);
});

test("a place photo without an author page still links its source", () => {
  const html = render({ credit: {
    kind: "author", author: "Otis w", authorUrl: null, license: "Unsplash License", licenseUrl: "https://unsplash.com/license",
    source: { name: "Unsplash", url: "https://unsplash.com/photos/village-and-church-in-mountain-valley-ZtAt11BAV6I" },
  } });
  assert.equal(visible(html).replace("©", "").trim(), "Фото: Otis w, Unsplash, Unsplash License");
  assert.ok(html.includes('href="https://unsplash.com/photos/village-and-church-in-mountain-valley-ZtAt11BAV6I"'));
  assert.equal((html.match(/<a /gu) ?? []).length, 2, "source and licence only");
});

test("university photos keep their wording", () => {
  assert.equal(visible(render({ credit: { kind: "official", sourceUrl: "https://gbs.ac.ae/campuses/dubai" }, universityName: "GBS Dubai" }))
    .replace("©", "").trim(), "Фото: GBS Dubai, официальный сайт");
  assert.equal(visible(render({ credit: { kind: "author", author: "Devymex", authorUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    license: "CC BY-SA 3.0", licenseUrl: null, source: null } })).replace("©", "").trim(), "Фото: Devymex, CC BY-SA 3.0");
});

test("place cards pass the photo source; the panel closes on Escape and outside, one at a time", () => {
  const tiles = readFileSync(new URL("src/lib/portal/university-tiles.ts", ROOT), "utf8");
  assert.match(tiles, /source: \{ name: photo\.sourceName, url: photo\.sourceUrl \}/u);
  assert.match(tiles, /authorUrl: photo\.authorUrl,/u);
  assert.match(source, /^"use client";/u);
  assert.match(source, /event\.key !== "Escape"/u);
  assert.match(source, /document\.addEventListener\("pointerdown", \(event\) => \{/u);
  assert.match(source, /if \(details !== opened\) details\.open = false;/u);
  const i18n = readFileSync(new URL("src/lib/portal/i18n.ts", ROOT), "utf8");
  assert.match(i18n, /photoCreditSource: "Фото: \{author\}, \{source\}, \{license\}"/u);
  assert.match(i18n, /photoCreditSource: "Сүрөт: \{author\}, \{source\}, \{license\}"/u);
});
