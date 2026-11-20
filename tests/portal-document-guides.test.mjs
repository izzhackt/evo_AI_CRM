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
  // Похожий, но чужой документ: справки нет — чужая хуже, чем никакой.
  for (const label of [
    "Паспорт родителя", "Копия паспорта матери", "Parent passport", "Ата-эненин паспорту", "Перевод паспорта",
    "Перевод аттестата", "Апостиль на аттестат", "Аттестаттын котормосу", "Диплом олимпиады", "Выписка оценок",
    "Фото паспорта", "Фото с паспортом", "Договор аренды", "Договор с вузом", "Медицинская страховка",
    "Медицинская справка родителей", "Заявление родителей", "Анкета на визу",
  ]) {
    assert.equal(documentGuideView({ requirementKey: null, label }, "ru"), null, label);
  }
  assert.equal(documentGuideView({ requirementKey: null, label: "Фото на паспорт" }, "ru")?.typeKey, "photo");
  assert.equal(documentGuideView({ requirementKey: null, label: "Выписка из банка" }, "ru")?.typeKey, "bank_statement");
  assert.equal(documentGuideView({ requirementKey: null, label: "Bank statement" }, "ru")?.typeKey, "bank_statement");
  assert.equal(documentGuideView({ requirementKey: "other", label: "Прочее" }, "ru"), null);
  assert.equal(renderGuide({
    label: "Военный билет",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
  }), "");
});

test("the visible «Образец и советы» button names the document and the drawer is an accessible dialog", () => {
  const html = renderGuide({
    label: "TOEFL",
    requirementKey: null,
    locale: "ru",
    statusLabel: "Не загружен",
    statusTone: "neutral",
    upload: { documentSlotId: SLOT, documentVersionId: null, originalFilename: null },
  });
  // Видимая подпись входит в доступное имя (WCAG 2.5.3), подсказка-тултип больше не нужна.
  assert.match(html, /aria-label="Образец и советы: TOEFL"/u);
  assert.match(html, /<span class="pt-doc-guide-btn-label">Образец и советы<\/span>/u);
  assert.doesNotMatch(html, /data-tooltip=/u);
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
  // Без страны дела — общая справка: блока страны нет, «Как сфотографировать» есть.
  assert.doesNotMatch(html, /pt-doc-guide-country/u);
  assert.match(html, />Как сфотографировать</u);
  assert.match(html, /Лист целиком, видны все четыре угла/u);
});

test("a China case adds the curator guide requirements; other countries keep the general guide", () => {
  const cn = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ru", country: "CN" });
  assert.match(cn, />Для Китая</u);
  assert.match(cn, /Foreigner Physical Examination Form/u);
  assert.ok(cn.indexOf("Для Китая") < cn.indexOf("Где взять"), "country requirements come before the general steps");
  const cnKy = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ky", country: "cn" });
  assert.match(cnKy, />Кытай үчүн</u);
  const my = renderGuide({ label: "Медицинская справка", requirementKey: null, locale: "ru", country: "MY" });
  assert.doesNotMatch(my, /Для Китая|Foreigner Physical/u);
  // Для самого фото и договора с EVO советов «как сфотографировать документ» нет.
  const photo = renderGuide({ label: "Фото", requirementKey: null, locale: "ru", country: "CN" });
  assert.doesNotMatch(photo, /Как сфотографировать/u);
  assert.match(photo, /33×48 мм/u);
});

test("every China note has RU and KY in step, at most four short lines, and no year", () => {
  for (const type of DOCUMENT_GUIDE_TYPES) {
    const ru = documentGuideView({ requirementKey: type, label: "" }, "ru", "CN");
    const ky = documentGuideView({ requirementKey: type, label: "" }, "ky", "CN");
    assert.equal(Boolean(ru.countryNotes), Boolean(ky.countryNotes), type);
    if (!ru.countryNotes) continue;
    assert.equal(ru.countryNotes.items.length, ky.countryNotes.items.length, type);
    assert.ok(ru.countryNotes.items.length <= 4, type);
    for (const line of [...ru.countryNotes.items, ...ky.countryNotes.items]) {
      assert.doesNotMatch(line, /20\d\d/u, `${type}: years live in the country timeline`);
      assert.ok(line.length <= 140, `${type}: ${line}`);
    }
  }
  assert.equal(documentGuideView({ requirementKey: "passport", label: "" }, "ru").countryNotes, null);
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
  // Принятый документ не заменяется ни в строке, ни в панели — даже без файла версии.
  assert.match(view, /upload=\{document\.status === "approved" \? null : \{/u);
  assert.match(view, /allowUpload=\{document\.status !== "approved"\}/u);
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
  assert.match(html, /aria-label="Образец и советы: Паспорт"/u);
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
  assert.match(ky, /aria-label="Үлгү жана кеңештер: Келишим"/u);
  assert.doesNotMatch(ky, /Кантип сүрөткө тартуу/u);
  assert.match(ky, />Кайдан алуу</u);
  assert.match(ky, />Куратордон суроо</u);
  assert.match(ky, /class="pt-btn pt-doc-guide-download"/u);
  assert.doesNotMatch(ky, /type="file"/u);
});
