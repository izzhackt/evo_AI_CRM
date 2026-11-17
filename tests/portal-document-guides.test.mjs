import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  documentGuideSamples,
  documentGuideView,
  DOCUMENT_GUIDE_TYPES,
} from "../src/lib/portal/document-guides.ts";
import { PORTAL_DICTIONARIES } from "../src/lib/portal/i18n.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const { AppRouterContext } = require("next/dist/shared/lib/app-router-context.shared-runtime.js");

const cache = new Map();

function resolveSource(base) {
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function loadModule(file) {
  const existing = cache.get(file);
  if (existing) return existing.exports;
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/")) {
      const resolved = resolveSource(path.join(root, "src", specifier.slice(2)));
      if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
      return loadModule(resolved);
    }
    if (specifier.startsWith(".")) {
      const resolved = resolveSource(path.resolve(path.dirname(file), specifier));
      if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${file}`);
      return loadModule(resolved);
    }
    return require(specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
  return mod.exports;
}

const { DocumentGuideSlot } = loadModule(path.join(root, "src/components/portal/admission/DocumentGuide.tsx"));

const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function renderGuide(props) {
  return renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(DocumentGuideSlot, props),
  ));
}

const SLOT = "10000000-0000-4000-8000-000000000001";

test("every guide has the same RU and KY shape, a fake sample, and at most three lines", () => {
  assert.equal(DOCUMENT_GUIDE_TYPES.length, documentGuideSamples().length);
  const ruKeys = Object.keys(PORTAL_DICTIONARIES.admission.ru).filter((key) => key.startsWith("guide"));
  const kyKeys = Object.keys(PORTAL_DICTIONARIES.admission.ky).filter((key) => key.startsWith("guide"));
  assert.deepEqual(ruKeys, kyKeys);
  for (const key of ruKeys) {
    assert.notEqual(PORTAL_DICTIONARIES.admission.ky[key], PORTAL_DICTIONARIES.admission.ru[key], key);
  }
  for (const sample of documentGuideSamples()) {
    const ru = documentGuideView({ requirementKey: sample.typeKey, label: "" }, "ru");
    const ky = documentGuideView({ requirementKey: sample.typeKey, label: "" }, "ky");
    assert.ok(ru);
    assert.ok(ky);
    assert.equal(ru.typeKey, sample.typeKey);
    assert.equal(ky.where.length, ru.where.length);
    assert.ok(ru.where.length >= 1 && ru.where.length <= 3);
    assert.ok(ru.pins.length >= 1 && ru.pins.length <= 3);
    assert.deepEqual(ru.pins.map((pin) => pin.n), ky.pins.map((pin) => pin.n));
    assert.notEqual(ky.description, ru.description);
    assert.equal(ru.sampleSrc, sample.sampleSrc);
    const file = path.join(root, "public", sample.sampleSrc);
    const svg = readFileSync(file, "utf8");
    assert.match(svg, /ОБРАЗЕЦ/u);
    assert.match(svg, /Sample only|Invented|invented|Diagram only/u);
    assert.doesNotMatch(svg, /@gmail\.com|@mail\.ru/u);
  }
});

test("known checklist labels and requirement keys open a guide, unknown labels do not", () => {
  const labels = [
    ["Загранпаспорт", "passport"],
    ["Паспорт", "passport"],
    ["Фото", "photo"],
    ["Фото на паспорт", "photo"],
    ["Аттестат или транскрипт", "attestat"],
    ["Аттестат / диплом", "attestat"],
    ["Сертификат по языку (IELTS, TOEFL), если есть", "language_certificate"],
    ["TOEFL", "language_certificate"],
    ["Анкета / заявление", "application_form"],
    ["Чек об оплате", "payment_receipt"],
    ["Келишим", "contract"],
    ["Справка с места учёбы", "study_certificate"],
    ["Справка о несудимости", "police_certificate"],
    ["Медицинская справка", "medical"],
    ["Справка из банка", "bank_statement"],
    ["Мотивационное письмо", "motivation_letter"],
    ["Рекомендательные письма", "recommendation_letter"],
    ["Свидетельство о рождении", "birth_certificate"],
  ];
  for (const [label, typeKey] of labels) {
    assert.equal(documentGuideView({ requirementKey: null, label }, "ru")?.typeKey, typeKey, label);
  }
  assert.equal(documentGuideView({ requirementKey: "evo.passport.v1", label: "Другое" }, "ky")?.typeKey, "passport");
  assert.equal(documentGuideView({ requirementKey: "transcript", label: "Что-то" }, "ru")?.typeKey, "attestat");
  assert.equal(documentGuideView({ requirementKey: "p4.custom", label: "Паспорт" }, "ru")?.typeKey, "passport");
  assert.equal(documentGuideView({ requirementKey: null, label: "Военный билет" }, "ru"), null);
  assert.equal(documentGuideView({ requirementKey: "other", label: "Прочее" }, "ru"), null);
  assert.equal(renderGuide({
    label: "Военный билет",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
  }), "");
});

test("the info button names the document and the drawer is an accessible dialog", () => {
  const html = renderGuide({
    label: "TOEFL",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
    upload: { documentSlotId: SLOT, documentVersionId: null, originalFilename: null },
  });
  assert.match(html, /aria-label="Что это за документ\? TOEFL"/u);
  assert.match(html, /data-tooltip="Что это за документ\?"/u);
  assert.match(html, /aria-haspopup="dialog"/u);
  assert.match(html, /aria-expanded="false"/u);
  const controls = html.match(/aria-controls="([^"]+)"/u);
  assert.ok(controls);
  assert.match(html, new RegExp(`id="${controls[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "u"));
  assert.match(html, /<dialog[^>]*aria-labelledby="/u);
  assert.match(html, /role="region"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(html, />Где взять</u);
  assert.match(html, /aria-label="Открыть образец целиком"/u);
  assert.match(html, /href="\/portal\/messages\?view=chat"/u);
  assert.match(html, /href="\/portal\?view=programs#list"/u);
  assert.match(html, />Спросить куратора</u);
  assert.match(html, /Требования конкретного вуза/u);
  assert.match(html, /type="file"/u);
  assert.match(html, />Загрузить/u);
  assert.doesNotMatch(html, /pt-doc-guide-download/u);
  assert.doesNotMatch(html, /Принятый документ доступен только для скачивания/u);
  assert.match(html, /\/portal\/document-samples\/language-score\.svg/u);
  assert.match(html, /class="pt-doc-guide-pin"/u);
});

test("the documents page wires the guide and drops the repeated locked subtitle", () => {
  const view = readFileSync(path.join(root, "src/components/portal/admission/DocumentsView.tsx"), "utf8");
  const files = readFileSync(path.join(root, "src/components/portal/admission/CaseFilesCard.tsx"), "utf8");
  const controls = readFileSync(path.join(root, "src/components/portal/admission/PortalDocumentControls.tsx"), "utf8");
  assert.match(view, /DocumentGuideSlot/);
  assert.match(view, /acceptedDownload/);
  assert.match(files, /DocumentGuideSlot/);
  assert.doesNotMatch(controls, /pt-doc-locked/);
  assert.doesNotMatch(view, /uploadLocked/);
});

test("an accepted document offers download in the drawer and does not open a second upload", () => {
  const html = renderGuide({
    label: "Паспорт",
    requirementKey: "passport",
    locale: "ru",
    statusLabel: "Принят",
    statusTone: "ok",
    download: {
      href: "/api/portal/document-versions/20000000-0000-4000-8000-000000000002/download",
      filename: "passport-sample.jpg",
    },
  });
  assert.match(html, /aria-label="Что это за документ\? Паспорт"/u);
  assert.match(html, /class="pt-btn pt-doc-guide-download"/u);
  assert.match(html, /href="\/api\/portal\/document-versions\/20000000-0000-4000-8000-000000000002\/download"/u);
  assert.match(html, /aria-label="Скачать passport-sample\.jpg"/u);
  assert.match(html, />Принят</u);
  assert.doesNotMatch(html, /type="file"/u);
  assert.doesNotMatch(html, /Принятый документ доступен только для скачивания/u);

  const ky = renderGuide({
    label: "Келишим",
    requirementKey: "contract",
    locale: "ky",
    download: { href: "/api/portal/case-files/contract/file/download", filename: "contract.pdf" },
  });
  assert.match(ky, /aria-label="Бул кандай документ\? Келишим"/u);
  assert.match(ky, />Кайдан алуу</u);
  assert.match(ky, />Куратордон суроо</u);
  assert.match(ky, /class="pt-btn pt-doc-guide-download"/u);
  assert.doesNotMatch(ky, /type="file"/u);
});
